import http from 'http';
import express from 'express';
const app = express();
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
});
app.get('/', (req, res) => {
    res.status(200).send('Success');
});

app.get('/user/ip', (req, res) => {
    res.json({ ip: req.ip });
});

server.listen(3004, () => {
    console.log(`Server is running on port 3004`);
});
