import cors from 'cors';
import express from 'express';
const app = express();
app.set('trust proxy', true);
app.use(cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Success');
});

app.get('/user/ip', (req, res) => {
    console.log('Returning ip.')
    res.json({ ip: req.ip });
});

const server = app.listen(3004, () => {
    console.log(`Server is running on port 3004`);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit();
});