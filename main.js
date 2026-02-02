import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import os from 'os';
import { UAParser } from 'ua-parser-js';

async function active(url) {
    if (!url) return false
    try {
        const response = await fetch(url);
        return response.ok
    } catch (e) { return false }
}
function logFile(text) {
    const now = new Date();
    fs.appendFile(`${home}/jazhdo-backend-logs/main/log_${startTime}.txt`, `[${now.toISOString()}] ${text}\n\n`, (err) => { if (err) { console.log('Error logging:', err)} });
}
function userDetails(req) { return [req.socket.remoteAddress, UAParser(req.headers['user-agent'])] }
function basicDetails(user) {
    const a = user[1];
    const items = [a.browser.name, a.browser.version, a.device.vendor, a.device.model, a.os.name, a.os.version];
    return `User Agent: ${a.ua}\nIP: ${user[0]}\nBrowser: ${items[0]} version ${items[1]}\nDevice: ${items[2]} ${items[3]}\nOS: ${items[4]} version ${items[5]}`
}

const startTime = Date.now();
const proxy = httpProxy.createProxyServer({ xfwd: true });
const targetMap = {
    '/camera': 'http://localhost:3001',
    '/proxy': 'http://localhost:3002'
};
const home = os.homedir();

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
        proxy.web(req, res, { target: target });
    } else if (!target) {
        logFile(`Request to "${req.url}" failed.\n${basicDetails(userDetails(req))}`);
        console.log(`Error 404: Request to "${req.url}"`);
        res.statusCode = 404;
    } else if (!status) {
        logFile(`Request to offline url ${target} through url "${req.url}" failed.\n${basicDetails(userDetails(req))}`);
        console.log(`Error 503: Request to "${req.url}" (port ${target} offline)`);
        res.statusCode = 503;
    }
    res.end();
});

server.listen(3000, '0.0.0.0', () => {
    logFile('Server started.');
    console.log('Starting server...');
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
    console.log('Access logs at '+home+'/jazhdo-backend-logs/main/log_' + startTime + '.txt');
});