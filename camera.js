import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { UAParser } from 'ua-parser-js';
import dotenv from 'dotenv';

const app = express();
const RECORDINGS_DIR = './camera-recordings';
const CAMERA_CONFIG = {
    width: 1536,
    height: 864,
    framerate: 60,
    bitrate: 10000000
};

// Access config
dotenv.config({ path: './.env.local' });
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

const fsPromises = fs.promises;
fsPromises.mkdir(RECORDINGS_DIR, { recursive: true }).catch(console.error);

// Current file to record to
let currentRecordingFile = null;
let currentRecordingStream = null;

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ message: 'Error token required' });
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(400).json({ message: 'Error token invalid' });
        req.user = user;
        next();
    });
};

// Start recording to file
function startRecording() {
    const now = Date.now();
    currentRecordingFile = path.join(RECORDINGS_DIR, `recording_${now}.mjpeg`);
    return currentRecordingFile;
}

// Stop recording
function stopRecording(inputFPS) {
    const oldFile = currentRecordingFile;
    currentRecordingFile = null;
    if (currentRecordingStream) {
        currentRecordingStream.end()
        currentRecordingStream.once('close', () => {
            if (oldFile && fs.existsSync(oldFile) && inputFPS) {
                console.log('ffmpeg conversion to MP4 with FPS:', inputFPS, 'starting');
                const ffmpeg = spawn('ffmpeg', [
                    '-y',
                    '-f', 'mjpeg',
                    '-framerate', String(inputFPS),
                    '-i', oldFile,
                    '-vf', 'format=yuv420p', 
                    '-colorspace', 'bt709',
                    '-color_range', 'tv',
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-pix_fmt', 'yuv420p',
                    '-crf', '23',
                    '-r', String(inputFPS),
                    oldFile.replace('.mjpeg', '.mp4')
                ]);
                
                ffmpeg.stdout.on('data', () => {}); 
                ffmpeg.stderr.on('data', (data) => { console.log('ffmpeg says:\n', data.toString()) });
                
                ffmpeg.on('exit', (code) => {
                    if (code === 0) {
                        console.log('ffmpeg conversion successful:', oldFile.replace('.mjpeg', '.mp4'));
                        fs.unlink(oldFile, () => {});
                    } else if (code === 234) console.log('Invalid input, see logs (Code 234)')
                    else console.error('ffmpeg conversion failed (Code '+code+')');
                    // Destroy remaining processes to prevent Error 234
                    ffmpeg.stdin.destroy();
                    ffmpeg.stdout.destroy();
                    ffmpeg.stderr.destroy();
                });
            } else {
                let errorsMessage = '';
                let errorsList = [];
                if (!oldFile) errorsList.push(`input pathname doesn't exist: ${oldFile}`);
                if (!fs.existsSync(oldFile)) errorsList.push(`fs doesn't have a sync with file ${oldFile}`);
                if (!inputFPS) errorsList.push(`the input FPS was invalid: ${inputFPS}`);
                if (errorsList) errorsList.forEach((e) => {errorsMessage += `\n${e}`})
                else errorsMessage = '\nno errors';
                console.log('Conversion not done because of the errors:', errorsMessage);
            }
        });
        currentRecordingStream.destroy();
        currentRecordingStream = null;
    }
    console.log('Recording stopped:', oldFile);
    return oldFile;
}
// Access points

// Connection status
app.get('/camera/health', (req, res) => {
    const parser = new UAParser(req.headers['user-agent']);
    res.status(200).json({
        ip: req.ip.split(':').pop(),
        userAgent: parser.getResult(),
        timestamp: new Date().toISOString()
    });
});

// Camera info
app.get('/camera/info', authenticateToken, (req, res) => {
    res.status(200).json({
        resolution: [CAMERA_CONFIG.width, CAMERA_CONFIG.height],
        fps: CAMERA_CONFIG.framerate,
        recording: currentRecordingFile !== null,
        current_file: currentRecordingFile ? path.basename(currentRecordingFile) : null
    });
});

// Login
app.post('/camera/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign(
            { username },
            SECRET_KEY,
            { expiresIn: '24h' }
        );
        return res.status(201).json({ token });
    }
    res.status(401).json({ message: 'Error credentials incorrect' });
});

// Stream endpoint
app.get('/camera/stream', (req, res) => {
    // Accept token from header OR query parameter
    const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ message: `Error token required` });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(400).json({ message: 'Error token invalid' });
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=FRAME',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
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
            '-n',
            '-o', '-'
        ]);
        
        console.log(`Stream started: Width: ${String(CAMERA_CONFIG.width)}, Height: ${String(CAMERA_CONFIG.height)}, FPS: ${fpsToUse}`);

        let frameBuffer = Buffer.alloc(0);
        let recordingStream = null;

        stream.stderr.on('data', data => { console.log('rpicam-vid says on stderr:\n', data.toString()) });
        stream.on('close', code => { console.log('rpicam-vid stream closed (Code '+code+')') })
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
                
                res.write(`--FRAME\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
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

// Start recording
app.post('/camera/record/start', authenticateToken, (req, res) => {
    const filename = startRecording();
    res.status(201).json({
        message: 'Recording started.',
        filename: path.basename(filename)
    });
});

// Stop recording
app.post('/camera/record/stop', authenticateToken, (req, res) => {
    const headerFPS = String(req.headers['fps']);
    if (!headerFPS) console.log('Fps header not found so defaulting to 60 fps.');
    const filename = stopRecording(Number(headerFPS) || 60);
    
    if (filename) {
        res.status(201).json({
            message: 'Recording stopped.',
            fps: headerFPS || '60',
            filename: path.basename(filename)
        });
    } else { res.status(404).json({ message: 'Error stopping undefined recording' }); }
});

// List recordings
app.get('/camera/record/list', authenticateToken, (req, res) => {
    fs.readdir(RECORDINGS_DIR, (err, files) => {
        if (err) return res.status(500).json({ message: 'Error recording unreadable' });

        const recordings = files
            .filter(f => f.endsWith('.mp4'))
            .map(f => {
                const stats = fs.statSync(path.join(RECORDINGS_DIR, f)).size;
                
                return {
                    filename: f,
                    size: stats,
                    size_mb: (stats / (1024 * 1024)).toFixed(2),
                };
            })
            .sort((a, b) => {
                // Extract timestamp from filename (recording_1737295200000.mp4) with newest first
                return parseInt(b.filename.match(/\d+/)[0]) - parseInt(a.filename.match(/\d+/)[0]);
            });

        res.status(200).json({ recordings });
    });
});

// Download recording
app.get('/camera/record/get/:filename', authenticateToken, (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(RECORDINGS_DIR, filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ mee5ssage: 'Error file not found' });

    res.download(filePath);
});

// Start server
const server = app.listen(3001, () => {
    console.log(`Starting server...`);
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/camera/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit();
});