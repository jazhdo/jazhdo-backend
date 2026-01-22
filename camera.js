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
const ADMIN_USERNAME = process.env.USERNAME;
const ADMIN_PASSWORD = process.env.PASSWORD;
const SECRET_KEY = process.env.KEY;
console.log(`Username: ${ADMIN_USERNAME}, Password: ${ADMIN_PASSWORD}, Token encryption key: ${SECRET_KEY}`);

// Middleware
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const fsPromises = require('fs').promises;
fsPromises.mkdir(RECORDINGS_DIR, { recursive: true }).catch(console.error);

// Current file to record to
let currentRecordingFile = null;
let currentRecordingStream = null;

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.query.token;

    if (!token) return res.status(401).json({ message: 'Token required' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Start recording to file
function startRecording() {
    const now = Date.now();
    currentRecordingFile = path.join(RECORDINGS_DIR, `recording_${now}.mjpeg`);
    console.log('Recording will save to:', currentRecordingFile);
    return currentRecordingFile;
}

// Stop recording
function stopRecording(inputFPS) {
    const oldFile = currentRecordingFile;
    currentRecordingFile = null;
    
    if (currentRecordingStream) {
        currentRecordingStream.end()
        currentRecordingStream.on('finish', () => {
            console.log('Recording file closed & finished');
            
            setTimeout(() => {
                if (oldFile && fs.existsSync(oldFile)) {
                    console.log('Converting to MP4 with FPS:', inputFPS);
                    const ffmpeg = spawn('ffmpeg', [
                        '-y',
                        '-f', 'image2pipe',
                        '-framerate', String(inputFPS),
                        '-i', oldFile,
                        '-c:v', 'libx264',
                        '-preset', 'ultrafast',
                        '-pix_fmt', 'yuv420p',
                        '-crf', '23',
                        '-r', String(inputFPS),
                        oldFile.replace('.mjpeg', '.mp4')
                    ]);
                    
                    ffmpeg.stdout.on('data', () => {}); 
                    ffmpeg.stderr.on('data', () => {});
                    // ffmpeg.stderr.on('data', (data) => { console.log('ffmpeg:', data.toString()); });
                    
                    ffmpeg.on('exit', (code) => {
                        if (code === 0) {
                            console.log('Converted to MP4:', oldFile.replace('.mjpeg', '.mp4'));
                            fs.unlink(oldFile, () => {});
                        } else console.error('ffmpeg failed with code:', code);
                    });
                }
            }, 2000);
        });
        currentRecordingStream = null;
    }
    
    console.log('Recording stopped:', oldFile);
    return oldFile;
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
    if (!token) return res.status(401).json({ message: `Token required (recieved: "${token}")` });

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

        const fpsToUse = String(req.query.fps || CAMERA_CONFIG.framerate);
        const stream = spawn('rpicam-vid', [
            '-t', '0',
            '--width', String(CAMERA_CONFIG.width),
            '--height', String(CAMERA_CONFIG.height),
            '--framerate', fpsToUse,
            '--codec', 'mjpeg',
            '--inline',
            '-o', '-'
        ]);
        
        console.log(`Stream started: Width: ${String(CAMERA_CONFIG.width)}, Height: ${String(CAMERA_CONFIG.height)}, FPS: ${fpsToUse}`);

        let frameBuffer = Buffer.alloc(0);
        let recordingStream = null;

        stream.on('error', (err) => {
            console.error('Stream error:', err);
            res.end();
            recordingStream?.end();
        });

        stream.stdout.on('data', (chunk) => {
            if (currentRecordingFile && !currentRecordingStream) {
                currentRecordingStream = fs.createWriteStream(currentRecordingFile);
                console.log('Recording to file:', currentRecordingFile);
            }
            currentRecordingStream?.write(chunk);
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
            
            // Clear buffer completely if it is higher than 256KB
            if (frameBuffer.length > 256 * 1024) frameBuffer = Buffer.alloc(0);
        });

        req.on('close', () => {
            stream.kill('SIGINT');
            console.log('Stream stopped.');
            if (recordingStream) {
                recordingStream.end();
                recordingStream = null;
                console.log('Recording stream closed');
            }
            
        });
    });
});

// Camera info
app.get('/api/camera/info', authenticateToken, (req, res) => {
    res.json({
        resolution: [CAMERA_CONFIG.width, CAMERA_CONFIG.height],
        fps: CAMERA_CONFIG.framerate,
        recording: currentRecordingFile !== null,
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
    const filename = stopRecording(req.query.fps || 60);
    
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
            .filter(f => f.endsWith('.mp4'))
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

// Start server
app.listen(3000, '0.0.0.0', () => {
    console.log(`Starting server...`);
    console.log(`Access at http://RPI_IP_ADDRESS:3000/api/[use]`);
    console.log('Uses:\n/api/health\n/api/login\n/api/stream/')
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit();
});

