import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import { UAParser } from 'ua-parser-js';

async function active(url) {
    if (!url) return false
    try {
        const response = await fetch(url);
        return response.ok
    } catch { return false }
}
function logFile(text) { fs.appendFile(`/home/jazhdo-backend-logs/main/log_${startTime}.txt`, `[${Date.now()}] ${text}`); }
function userDetails(req) { return [req.socket.remoteAddress, UAParser(req.headers['user-agent'])] }
function basicDetails(user) { return `IP: ${user[0]}\nBrowser: ${user[1].browser.name} version ${user[1].browser.version}\nDevice: ${user[1].device.vendor} ${user[1].device.model}\nOS: ${user[1].os.name} version ${user[1].os.version}` }

const startTime = Date.now();
const proxy = httpProxy.createProxyServer({ xfwd: true });
const targetMap = {
    '/camera': 'http://localhost:3001',
    '/proxy': 'http://localhost:3002'
};

const server = http.createServer(async (req, res) => {
    let target = null;
    let status = null;

    for (const path in targetMap) {
        if (req.url.startsWith(path)) {
            status = await active(targetMap[path]);
            target = targetMap[path];
            break;
        }
    }
    
    if (target && status) {
        console.log(`Request to ${req.url} directed to ${target}`);
        proxy.web(req, res, { target });
    } else {
        if (!target) {
            let user = userDetails(req);
            logFile(`Attempted request to access nonexistant ${req.url} failed.\n${basicDetails(user)}`);
            console.log(`Request to ${req.url} directed to Error 404`);
            res.statusCode = 404;
        } else if (!status) {
            logFile(`Attempted reguest to access offline ${target} through url ${req.url} failed.\n${basicDetails(user)}`);
            console.log(`Unable to send ${req.url} directed to Error 503 (${target} offline)`);
            res.statusCode = 503;
        } else { res.statusCode = 500; }
        res.end();
    }
});

server.listen(3000, '0.0.0.0', () => {
    logFile('Server started.');
    console.log('Starting server...');
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
});
