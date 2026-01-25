import i2c from 'i2c-bus';
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
        
        this.command(0x28);
        this.command(0x0C);
        this.command(0x06);
        this.clear();
    }
    
    clear() {
        this.command(0x01);
        this.delayMicroseconds(2000);
    }
    
    print(text, lineNumber) {
        if (!lineNumber) { lineNumber = 1 }
        if (lineNumber < 1 || lineNumber > this.rows) throw new Error(`Invalid line number. Must be 1-${this.rows}`);
        
        const rowOffsets = [0x00, 0x40];
        this.command(0x80 | rowOffsets[lineNumber - 1]);
        
        const truncated = text.slice(0, this.cols).padEnd(this.cols, ' ');
        for (let i = 0; i < truncated.length; i++) this.sendData(truncated.charCodeAt(i));
    }
    
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
        this.bus.sendByteSync(this.address, data);  // ? FIX: sendByteSync
        this.pulseEnable(data);
    }
    
    pulseEnable(data) {
        this.bus.sendByteSync(this.address, data | 0x04);  // ? FIX
        this.delayMicroseconds(1);
        this.bus.sendByteSync(this.address, data & ~0x04);  // ? FIX
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
const keys = [
    ['1', '2', '3', 'A'],
    ['4', '5', '6', 'B'],
    ['7', '8', '9', 'C'],
    ['*', '0', '#', 'D']
];
const letters = {
    2: ['a', 'b', 'c'],
    3: ['d', 'e', 'f'],
    4: ['g', 'h', 'i'],
    5: ['j', 'k', 'l'],
    6: ['m', 'n', 'o'],
    7: ['p', 'q', 'r', 's'],
    8: ['t', 'u', 'v'],
    9: ['w', 'x', 'y', 'z']
};

rows.forEach(pin => { gpiox.init_gpio(pin, gpiox.GPIO_MODE_INPUT_PULLDOWN, 0); });
cols.forEach(pin => { gpiox.init_gpio(pin, gpiox.GPIO_MODE_OUTPUT, 0); });

let value = '';
let last = null;
let textMode = false;
let textTime = null;
let textMessage = '';
let textLetterLength = 0;
let textLetter = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function getLetter(key, times) {
    if (!key || !times) return ''
    if (((key === 7 || key === 9) && times > 4)) { times = times%4; }
    else if ((key !== 7 && key !== 9) && times > 3) { times = times%3; }
    console.log('Adding', letters[key][times], 'to message.')
    return letters[key][times]
}

lcd.print('Initial Code Completed');
console.log('Init Code Done');
await sleep(1000);
lcd.clear();

process.on('SIGINT', () => {
    rows.forEach(pin => gpiox.deinit_gpio(pin));
    cols.forEach(pin => gpiox.deinit_gpio(pin));
    lcd.close();
    process.exit();
})

while (true) {
    let key = null;
    for (let ci = 0; ci < cols.length; ci++) {
        gpiox.set_gpio(cols[ci], 1);
        await sleep(1);
        
        for (let ri = 0; ri < rows.length; ri++) {
            const value = gpiox.get_gpio(rows[ri]);            
            if (value === true) {
                key = keys[ri][ci];
                break;
            }
        }
        
        gpiox.set_gpio(cols[ci], 0);
        if (key) break;
    }
    if ((!key || key == last) && textMode && Date.now() - textTime >= 1200) {
        textMessage += getLetter(textLetter, textLetterLength);
        textLetter = null;
        console.log('Adding letter because of timeout.')
    }
    if (key && key !== last) {
        if (textMode) {
            if (!isNaN(key) && Object.keys(letters).includes(key)) {
                if (key !== textLetter) {
                    textMessage += getLetter(textLetter, textLetterLength);
                    textTime = Date.now();
                    textLetterLength = 0;
                    textLetter = key
                    console.log('Next letter.');
                } else {
                    textLetterLength++;
                    console.log('Repeated press.')
                }
                console.log('textMessage Contents:', textMessage, 'Current letter #:', textLetterLength);
                lcd.clear();
                lcd.print('msg: '+textMessage)
            } else if (key === '*') {
                textMessage = textMessage.slice(0, -1);
                lcd.clear();
                lcd.print('msg: '+textMessage);
            } else if (key === '#') {
                console.log('Message sent:', textMessage)
                lcd.clear();
                textMessage = '';
                lcd.print('msg:');
            } else if (key === 'B') {
                textTime = null;
                textMessage = '';
                textLetterLength = 0;
                textLetter = '';
                lcd.clear();
                textMode = false;
                lcd.print('Texting mode off');
                await sleep(2000);
                lcd.clear();
                lcd.print('Passcode:');
            }
        } else {
            switch (key) {
                case '#':
                    const allowedRef = doc(db, 'passcodes', 'allowed');
                    const prohibitedRef = doc(db, 'passcodes', 'prohibited');
                    const allowedSnap = await getDoc(allowedRef) || {};
                    const prohibitedSnap = await getDoc(prohibitedRef) || {};
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
                    lcd.print('Passcode:', value);
                    break;
                case 'A':
                    lcd.clear();
                    lcd.print('Locking...');
                    await sleep(3000)
                    lcd.clear();
                    lcd.print('Passcode:', value);
                    break;
                case 'B':
                    value = '';
                    lcd.clear();
                    textMode = true;
                    lcd.print('Texting mode on.');
                    await sleep(2000);
                    lcd.clear();
                    lcd.print('msg:');
                    break;
                default:
                    if (!isNaN(key) && value.length < 6) {
                        value += key;
                        lcd.clear();
                        lcd.print('Passcode:', value);
                    }
                    break;
            }
        }
        let action = key + ' pressed';
        if (key == '#') action = 'Submitted.';
        if (key == '*') action = 'Deleted.';
        console.log('Action: '+String(action));
    }
    last = key;
    await sleep(50);
}