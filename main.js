import http from 'http';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({});
const targetMap = {
    '/camera': 'http://localhost:3001',
    '/proxy': 'http://localhost:3002'
};

const server = http.createServer((req, res) => {
    let target = null;

    for (const path in targetMap) {
        if (req.url.startsWith(path)) {
            target = targetMap[path];
            break;
        }
    }

    if (target) {
        console.log(`Sending ${req.url} to ${target}`);
        proxy.web(req, res, { target });
    } else {
        console.log(`Unable to send ${req.url} to ${target}`);
        res.end('Error 404');
    }
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Starting server...');
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
});