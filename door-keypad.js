import i2c from 'i2c-bus';
// import LCD from 'lcd';
import gpiox from '@iiot2k/gpiox';
import { initializeApp } from 'firebase/app';
import { getFirestore, getDoc, doc } from 'firebase/firestore';

// Replacement LCD library written by claude
class LCD {
    constructor(bus = 1, address = 0x27, cols = 16, rows = 2) {
        this.bus = i2c.openSync(bus);
        this.address = address;
        this.cols = cols;
        this.rows = rows;
        this.backlight = 0x08;
    }
    
    init() {
        this.write4bits(0x03 << 4);
        this.delayMicroseconds(4500);
        this.write4bits(0x03 << 4);
        this.delayMicroseconds(4500);
        this.write4bits(0x03 << 4);
        this.delayMicroseconds(150);
        this.write4bits(0x02 << 4);
        
        this.command(0x28); // 4-bit, 2 line, 5x8
        this.command(0x0C); // Display on, cursor off
        this.command(0x06); // Entry mode
        this.clear();
    }
    
    clear() {
        this.command(0x01);
        this.delayMicroseconds(2000);
    }
    
    print(text, lineNumber) {
        if (!lineNumber) lineNumber = 1;
        if (lineNumber < 1 || lineNumber > this.rows) {
            throw new Error(`Invalid line number. Must be 1-${this.rows}`);
        }
        
        const rowOffsets = [0x00, 0x40];
        this.command(0x80 | rowOffsets[lineNumber - 1]);
        
        const truncated = text.slice(0, this.cols).padEnd(this.cols, ' ');
        for (let i = 0; i < truncated.length; i++) {
            this.sendData(truncated.charCodeAt(i));
        }
    }
    
    // Internal methods
    command(value) { this.send(value, 0) }
    
    sendData(value) { this.send(value, 1) }
    
    send(value, mode) {
        const highNibble = value & 0xF0;
        const lowNibble = (value << 4) & 0xF0;
        this.write4bits(highNibble | mode);
        this.write4bits(lowNibble | mode);
    }
    
    write4bits(value) {
        const data = value | this.backlight;
        this.bus.writeByteSync(this.address, data);
        this.pulseEnable(data);
    }
    
    pulseEnable(data) {
        this.bus.writeByteSync(this.address, data | 0x04);
        this.delayMicroseconds(1);
        this.bus.writeByteSync(this.address, data & ~0x04);
        this.delayMicroseconds(50);
    }
    
    delayMicroseconds(us) {
        const start = process.hrtime.bigint();
        while (Number(process.hrtime.bigint() - start) / 1000 < us) {}
    }
    
    close() {
        this.clear();
        this.bus.closeSync();
    }
}

const firebaseConfig = {
    apiKey: "AIzaSyAHm5_zvReOaA6RpttJ1KlIhoONis99MKA",
    authDomain: "jazhdo-backend.firebaseapp.com",
    projectId: "jazhdo-backend",
    storageBucket: "jazhdo-backend.firebasestorage.app",
    messagingSenderId: "535780894340",
    appId: "1:535780894340:web:ca78bc82bbe1ff0a8204d1"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const lcd = new LCD(1, 0x27, 16, 2);
lcd.init();

// Keypad config (GPIOs)
const rows = [17, 27, 22, 23];
const cols = [24, 25, 5, 6];
const keys = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']];

rows.forEach(pin => { gpiox.init_gpio(pin, gpiox.GPIO_MODE_INPUT_PULLDOWN); });
cols.forEach(pin => { gpiox.init_gpio(pin, gpiox.GPIO_MODE_OUTPUT, 0); });

let value = '';
let last = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

lcd.print('Initial Code Completed');
console.log('Initial Code Completed');
await sleep(1000);
lcd.clear();
// lcd.setCursor(0, 1) // column 0, row 1

process.on('SIGINT', () => {
    rows.forEach(pin => gpiox.deinit_gpio(pin));
    cols.forEach(pin => gpiox.deinit_gpio(pin));
    lcd.close();
    i2cBus.closeSync();
    process.exit();
})

while (true) {
    let key = null;
    for (let ci = 0; ci < cols.length; ci++) {
        gpiox.set_gpio(cols[ci], 1);
        await sleep(1);
        for (let ri = 0; ri < rows.length; ri++) { if (gpiox.get_gpio(rows[ri]) === 1) { key = keys[ri][ci]; break } }
        gpiox.set_gpio(cols[ci], 0);
        if (key) break
    }
    if (key && key !== last) {
        switch (key) {
            case '#':
                allowedRef = doc(db, 'passcodes', 'allowed');
                prohibitedRef = doc(db, 'passcodes', 'prohibited');

                allowedSnap = await getDoc(allowedRef) || {};
                prohibitedSnap = await getDoc(prohibitedRef) || {};

                lcd.clear();
                if (Object.values(prohibitedSnap.data()).includes(value)) {
                    lcd.print('Prohibited.');
                    console.log('Prohibited passcode', value, 'entered.');
                    await sleep(2000);
                } else if (Object.values(allowedSnap.data()).includes(value)) {
                    lcd.print('Unlocking...');
                    console.log('Door unlocked.');
                    await sleep(3000);
                } else {
                    if (value.length == 6) {
                        lcd.print('Incorrect.');
                        console.log('Incorrect passcode', value, 'entered.');
                        await sleep(2000);
                    } else {
                        lcd.print('6 digits only.');
                        console.log('Incomplete passcode entered.');
                        await sleep(3000);
                    }
                }
                lcd.clear();
                value = '';
                break;
            case '*':
                value = value.slice(0, -1);
                lcd.clear();
                lcd.print(value);
                break;
            case 'A':
                lcd.clear();
                lcd.print('Locking...');
                await sleep(3000)
                lcd.clear();
                break;
            default:
                if (!isNaN(key) && value.length < 6) {
                    value += keylcd.clear();
                    lcd.print(value);
                }
                break;
        }
        let action = key + ' pressed';
        if (key == '#') {
            action = 'Submitted.';
        } else if (key == '*') {
            action = 'Deleted.';
        }
        console.log('Action: '+String(action));
    }
    last = key;
    await sleep(50);
}