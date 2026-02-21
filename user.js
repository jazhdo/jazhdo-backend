import http from 'http';
import express from 'express';
const app = express();
const server = http.createServer({});

app.use(cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Success');
    res.end();
});

app.get('/user/ip', (req, res) => {
    res.json({ ip: req.ip });
    res.end();
});

server.listen(3004, () => {
    console.log(`Server is running on port 3004`);
});
