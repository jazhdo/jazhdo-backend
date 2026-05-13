import express from "express";
import fs from "fs";

const app = express();
let config = JSON.parse(fs.readFileSync('door-config.json', 'utf-8'));

function shutdown() {
    console.log('\nShutting down...');
    server.close();
    process.exit();
}

app.get("/", (req, res) => {
    res.status(200).send("Success");
});

app.get("/door-keypad/schedule/remove", (req, res) => {
    const number = Number(req.query.number);
    config.splice(number, 1);
    fs.writeFileSync('door-config.json', JSON.stringify(config, null, 4));
    res.status(200).send();
});

app.get("/door-keypad/schedule/add", (req, res) => {
    const parameters = JSON.parse(req.query.parameters);
    config.push(parameters);
    fs.writeFileSync('door-config.json', JSON.stringify(config, null, 4));
    res.status(200).send();
});

app.get("/door-keypad/schedule", (req, res) => {
    // Get current time (For comparing end times and start times for each "event" to decide which string to show (show first matching one))
    /* Format:
        [0] - Weekdays (Check if the string contains the weekday number (0-6))
        [1] - Start time (In the format of HH:MM as in hour, minute)
        [2] - End time (In the same format as the start time)
        [3] - Message (What is displayed (<= 16 characters long or it'll get cut off))
    */
    res.status(200).json(config);
});

const server = app.listen(3005, () => {
    console.log("Server is listening on port 3005.");
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);