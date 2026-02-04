import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { initializeApp } from 'firebase/app';
import { getFirestore, getDoc, doc, addDoc, collection } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyAHm5_zvReOaA6RpttJ1KlIhoONis99MKA",
    authDomain: "jazhdo-backend.firebaseapp.com",
    projectId: "jazhdo-backend",
    storageBucket: "jazhdo-backend.firebasestorage.app",
    messagingSenderId: "535780894340",
    appId: "1:535780894340:web:ca78bc82bbe1ff0a8204d1"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const app = express();
app.set('trust proxy', true);

// Middleware
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ message: 'Error token required' });
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(400).json({ message: 'Error token invalid' });
        req.user = user;
        next();
    });
}
function shutdown() {
    console.log('\nShutting down...');
    server.close();
    process.exit();
}

// Main.js online status
app.get('/', (req, res) => {
    res.status(200).send('Success');
})

app.get('/db/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign(
            { username },
            SECRET_KEY,
            { expiresIn: '2h' }
        );
        return res.status(201).json({ token });
    }
    res.status(401).json({ message: 'Error credentials incorrect' });
})

// Direct html-only forms to firebase
app.get('/db/firebase/send/:type', authenticateToken, (req, res) => {

})

// Start server
const server = app.listen(3003, () => {
    console.log(`Starting server...`);
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/db/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
});

// Program termination
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);