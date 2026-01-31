import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import { UAParser } from 'ua-parser-js';

async function active(url) {
    console.log('Checking if url', url, 'is online')
    if (!url) return false
    try {
        const response = await fetch(url);
        return response.ok
    } catch (e) {
        console.log('Error', e, 'in checking if port was active');
        return false 
    }
}
function logFile(text) {
    const now = new Date();
    fs.appendFile(`/home/raspberrypi/jazhdo-backend-logs/main/log_${startTime}.txt`, `[${now.toISOString()}] ${text}\n\n`, (err) => { if (err) { console.log('Error logging:', err)} });
}
function userDetails(req) { return [req.socket.remoteAddress, UAParser(req.headers['user-agent'])] }
function itemFalsy(list) { return list.some(e => !e); }
function basicDetails(user) {
    const a = user[1];
    let addOns = '';
    const items = [a.browser.name, a.browser.version, a.device.vendor, a.device.model, a.os.name, a.os.version];
    if (itemFalsy(items)) addOns = 'User Agent: ' + a.ua + '\n';
    return addOns + `IP: ${user[0]}\nBrowser: ${items[0]} version ${items[1]}\nDevice: ${items[2]} ${items[3]}\nOS: ${items[4]} version ${items[5]}`
}

const startTime = Date.now();
const proxy = httpProxy.createProxyServer({ xfwd: true });
const targetMap = {
    '/camera': '3001',
    '/proxy': '3002'
};

const server = http.createServer(async (req, res) => {
    let target = null;
    let status = null;

    for (const path in targetMap) {
        if (req.url.startsWith(path)) {
            status = await active('http://localhost:'+targetMap[path]);
            target = targetMap[path];
            break;
        }
    }
    
    if (target && status) {
        console.log(`Request to ${req.url} directed to port ${target}`);
        const toSend = `http://localhost:${target}`;
        proxy.web(req, res, { toSend });
    } else {
        if (!target) {
            logFile(`Request to "${req.url}" failed.\n${basicDetails(userDetails(req))}`);
            console.log(`Request to "${req.url}" directed to Error 404`);
            res.statusCode = 404;
        } else if (!status) {
            logFile(`Request to offline port ${target} through url "${req.url}" failed.\n${basicDetails(userDetails(req))}`);
            console.log(`Unable to send "${req.url}" directed to Error 503 (port ${target} offline)`);
            res.statusCode = 503;
        } else { res.statusCode = 500; }
        res.end();
    }
});

server.listen(3000, '0.0.0.0', () => {
    logFile('Server started.');
    console.log('Starting server...');
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
    console.log('Access logs at ~/jazhdo-backend-logs/main/log_' + startTime + '.txt');
});