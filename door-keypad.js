import i2c from 'i2c-bus';
import LCD from 'lcd';
import gpiox from '@iiot2k/gpiox';
import { initializeApp } from 'firebase/app';
import { getFirestore, getDoc, doc } from 'firebase/firestore';

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

const i2cBus = i2c.openSync(1);
const lcd = new LCD({
    i2c: i2cBus,
    address: 0x27,
    cols: 16,
    rows: 2
});

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