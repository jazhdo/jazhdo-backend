const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const RECORDINGS_DIR = '/home/raspberrypi/jazhdo_backend';
const CAMERA_CONFIG = {
    width: 1536,
    height: 864,
    framerate: 60,
    bitrate: 10000000
};

// Access config
require('dotenv').config({ path: './.env.local' });
const ADMIN_USERNAME = process.env.username;
const ADMIN_PASSWORD = process.env.password;
const SECRET_KEY = process.env.secret_key;
console.log(`Username: ${ADMIN_USERNAME}, Password: ${ADMIN_PASSWORD}, Token encryption key: ${SECRET_KEY}`);

// Middleware
app.use(cors());
app.use(express.json());

const fsPromises = require('fs').promises;
fsPromises.mkdir(RECORDINGS_DIR, { recursive: true }).catch(console.error);

// Camera process and recording state
let recordingProcess = null;
let currentRecordingFile = null;

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Token required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Start recording to file
function startRecording() {
    if (recordingProcess) stopRecording();

    const timestamp = Date.now();
    currentRecordingFile = path.join(RECORDINGS_DIR, `recording_${timestamp}.h264`);

    // rpicam-vid for recording at 60fps
    recordingProcess = spawn('rpicam-vid', [
        '-t', '0',
        '--width', String(CAMERA_CONFIG.width),
        '--height', String(CAMERA_CONFIG.height),
        '--framerate', String(CAMERA_CONFIG.framerate),
        '--codec', 'h264',
        '-b', String(CAMERA_CONFIG.bitrate),
        '-o', currentRecordingFile
    ]);

    recordingProcess.on('error', (err) => {
        console.error('Recording error:', err);
        currentRecordingFile = null;
    });

    recordingProcess.on('exit', (code) => {
        if (code !== 0) console.log('Recording process exited with code:', code);
    });

    console.log('Recording started:', currentRecordingFile);
    return currentRecordingFile;
}

// Stop recording
function stopRecording() {
    if (recordingProcess) {
        recordingProcess.kill('SIGINT');
        recordingProcess = null;
        const oldFile = currentRecordingFile;
        currentRecordingFile = null;
        console.log('Recording stopped:', oldFile);
        return oldFile;
    }
    return null;
}

// Access points

// Device status
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString()
    });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign(
            { username },
            SECRET_KEY,
            { expiresIn: '24h' }
        );

        return res.json({ token });
    }

    res.status(401).json({ message: 'Invalid credentials' });
});

// Stream endpoint
app.get('/api/stream', (req, res) => {
    // Accept token from header OR query parameter
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.query.token;

    if (!token) return res.status(401).json({ message: 'Token required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=FRAME',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
	    'Pragma': 'no-cache',
	    'Expires': '0',
            'Connection': 'close',
	    'X-Accel-Buffering': 'no'
        });

        const stream = spawn('rpicam-vid', [
            '-t', '0',
            '--width', String(CAMERA_CONFIG.width),
            '--height', String(CAMERA_CONFIG.height),
            '--framerate', String(CAMERA_CONFIG.framerate),
            '--codec', 'mjpeg',
            '--inline',
            '--flush',
            '--nopreview',
            '-o', '-'
        ]);

        let frameBuffer = Buffer.alloc(0);

        stream.on('error', (err) => {
            console.error('Stream error:', err);
            res.end();
        });

        stream.stdout.on('data', (chunk) => {
            frameBuffer = Buffer.concat([frameBuffer, chunk]);

            let startIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
            let endIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));

            while (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                const frame = frameBuffer.slice(startIdx, endIdx + 2);
                
                res.write('--FRAME\r\n');
                res.write('Content-Type: image/jpeg\r\n');
                res.write(`Content-Length: ${frame.length}\r\n\r\n`);
                res.write(frame);
                res.write('\r\n');

                frameBuffer = frameBuffer.slice(endIdx + 2);
                startIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
                endIdx = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));
            }
        });

        req.on('close', () => { stream.kill('SIGINT'); });
    });
});

// Camera info
app.get('/api/camera/info', authenticateToken, (req, res) => {
    res.json({
        resolution: [CAMERA_CONFIG.width, CAMERA_CONFIG.height],
        fps: CAMERA_CONFIG.framerate,
        recording: recordingProcess !== null,
        current_file: currentRecordingFile ? path.basename(currentRecordingFile) : null
    });
});

// Start recording
app.post('/api/camera/start-recording', authenticateToken, (req, res) => {
    const filename = startRecording();
    res.json({
        message: 'Recording started',
        filename: path.basename(filename)
    });
});

// Stop recording
app.post('/api/camera/stop-recording', authenticateToken, (req, res) => {
    const filename = stopRecording();
    
    if (filename) {
        res.json({
            message: 'Recording stopped',
            filename: path.basename(filename)
        });
    } else { res.status(400).json({ message: 'No active recording' }); }
});

// List recordings
app.get('/api/recordings', authenticateToken, (req, res) => {
    fs.readdir(RECORDINGS_DIR, (err, files) => {
        if (err) return res.status(500).json({ message: 'Error reading recordings' });

        const recordings = files
            .filter(f => f.endsWith('.h264'))
            .map(f => {
                const filePath = path.join(RECORDINGS_DIR, f);
                const stats = fs.statSync(filePath);
                
                return {
                    filename: f,
                    size: stats.size,
                    size_mb: (stats.size / (1024 * 1024)).toFixed(2),
                    download_url: `/api/recordings/${f}`
                };
            })
            .sort((a, b) => {
                // Extract timestamp from filename (recording_1737295200000.h264)
                const timeA = parseInt(a.filename.match(/\d+/)[0]);
                const timeB = parseInt(b.filename.match(/\d+/)[0]);
                return timeB - timeA; // Newest first
            });

        res.json({ recordings });
    });
});

// Download recording
app.get('/api/recordings/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(RECORDINGS_DIR, filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

    res.download(filePath);
});

// Delete recording
app.delete('/api/recordings/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(RECORDINGS_DIR, filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

    fs.unlink(filePath, (e) => {
        if (e) return res.status(500).json({ message: 'Error deleting file' });
        res.json({ message: 'Recording deleted successfully' });
    });
});

// Start server
app.listen(3000, '0.0.0.0', () => {
    console.log(`Camera API server running on port 3000`);
    console.log(`Access at http://localhost:3000`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    if (recordingProcess) recordingProcess.kill('SIGINT');
    process.exit();
});

