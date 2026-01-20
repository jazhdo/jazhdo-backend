const http = require('http');
const express = require('express');
const app = express();
const port = 3000
const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
});
app.get('/', (req, res) => {
    res.send('<h1>Hello, Express.js Server!</h1>');
});

app.get('/send', (req, res) => {
    res.send({test: 'test success'});
});

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
