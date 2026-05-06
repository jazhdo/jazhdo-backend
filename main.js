const startTime = Date.now();
import http from "http";
import httpProxy from "http-proxy";
import fs from "fs";
import os from "os";
import { exec } from "node:child_process";
import { UAParser } from "ua-parser-js";

// Help message to display when the flag -h or --help is used
const helpMessage = `Usage: "node main.js [options]

Options:
    -h or --help: Brings up this help menu
    -r or --redirect: Configures server to redirect to a ip given after the command
    -p or --port: Changes what port the server listens on
    --path: Changes the path that the log file is stored at
`;
// Parse options to get them into format
const options = [];
process.argv.slice(2).forEach(e => {
    if (e.startsWith("-")) options.push([e]);
    else {
        if (!options[options.length - 1][1]) options[options.length - 1].push([e]);
        else options[options.length - 1][1].push(e);
    }
});
// Define variables before checking if to change them through options
let targetMap = {
    "/camera": "http://localhost:3001",
    "/proxy": "http://localhost:3002",
    "/db": "http://localhost:3003",
    "/user": "http://localhost:3004"
};
let port = 3000;
let home = os.homedir();
function info(msg, process = "Server") {
    const now = new Date();
    console.log(`[${now.toISOString()}] [${process}]: ${msg}`);
}
function error(msg, process = "Server") {
    const now = new Date();
    console.error(`[${now.toISOString()}] [${process} Error]: ${msg}`);
}
// Check for flags and act accordingly
options.forEach(([command, terms]) => {
    switch (command) {
        case "-r" || "--redirect":
            targetMap = { "/": terms[0] };
            info("Redirecting all requests to " + terms[0], "Options");
            break;
        case "-h" || "--help":
            console.log(helpMessage);
            process.exit(0);
            break;
        case "-p" || "--port":
            info("Switching from port " + port + " to port " + terms[0], "Options");
            port = terms[0];
            break;
        case "--path":
            info("Switching from path " + home + "/jazhdo-backend-logs/main/ to path " + terms[0] + "/jazhdo-backend-logs/main/", "Options");
            home = terms[0];
            break;
        default:
            error("Option "+ command + " is not a valid option.", "Options");
            break;
    }
});

/**
 * Checks whether or not the specified URL is active
 *
 * @param {String} url - URL to check activity of
 * @returns true or false
 * @throws ReferenceError if the url parameter is omitted
 */
async function active(url) {
    if (!url) throw ReferenceError;
    try {
        const response = await fetch(url);
        return response.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Logs text to the log file defined by the starting time.
 *
 * @param {String} text - What to log
 * @param {Boolean} error - Whether or not to format the line as a error
 * @throws Error message if there was an error writing to the logfile
 */
function logFile(text, error) {
    const now = new Date();
    fs.appendFile(`${home}/jazhdo-backend-logs/main/log_${startTime}.txt`, `[${now.toISOString()}${error ? " Error" : ""}]: ${text}\n`, err => {
        if (err) throw err;
    });
}
function userDetails(req) {
    return [req.socket.remoteAddress, UAParser(req.headers["user-agent"])];
}
function basicDetails(user) {
    const a = user[1];
    const items = [a.browser.name, a.browser.version, a.device.vendor, a.device.model, a.os.name, a.os.version];
    return `User Agent: ${a.ua}\nIP: ${user[0]}\nBrowser: ${items[0]} version ${items[1]}\nDevice: ${items[2]} ${items[3]}\nOS: ${items[4]} version ${items[5]}`;
}
function shutdown() {
    proxy.close();
    server.close();
    process.exit();
}
function bold(text) {
    return "\x1b[1m" + text + "\x1b[0m";
}

const proxy = httpProxy.createProxyServer({ xfwd: true });
const server = http.createServer(async (req, res) => {
    let target;
    let status;

    for (const path in targetMap) {
        if (req.url.startsWith(path)) {
            status = await active(targetMap[path]);
            target = targetMap[path];
            break;
        }
    }

    if (target && status) {
        logFile(`${req.url} --> ${target}`);
        info(`\x1b[32mSuccess\x1b[0m: Request to ${bold(req.url)} directed to ${bold(target)}`);
        proxy.web(req, res, { target: target });
    } else if (!target) {
        logFile(`${req.url} --> Error 404\n${basicDetails(userDetails(req))}`);
        error(`\x1b[33mError 404\x1b[0m: Request to ${bold(`"${req.url}"`)}`);
        res.statusCode = 404;
    } else if (!status) {
        logFile(`${req.url} --> Error 503 (${target} offline).\n${basicDetails(userDetails(req))}`);
        error(`\x1b[31mError 503\x1b[0m: Request to ${bold(`"${req.url}"`)} (${bold(`${target} offline`)})`);
        res.statusCode = 503;
    }
    res.end();
});

server.listen(port, "0.0.0.0", () => {
    logFile("Server started.");
    info("Starting server...");
    info("Now listening at http://[RPI_IP_ADDRESS]:" + port + "/.");
    info("Help: https://github.com/jazhdo/jazhdo-backend/wiki");
    info(`Access logs at ${home}/jazhdo-backend-logs/main/log_${startTime}.txt`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
