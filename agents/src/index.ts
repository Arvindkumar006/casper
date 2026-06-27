import * as https from 'https';
import * as readline from 'readline';

const EVENT_STREAM_URL = 'https://node.testnet.casper.network/events';

console.log(`Connecting to Casper Testnet event stream: ${EVENT_STREAM_URL}...`);

function connectToEventStream() {
    https.get(EVENT_STREAM_URL, (res) => {
        if (res.statusCode !== 200) {
            console.error(`Failed to connect. Status code: ${res.statusCode}`);
            res.resume();
            return;
        }

        console.log('Connected to Casper event stream. Listening for events...');

        const rl = readline.createInterface({
            input: res,
            terminal: false
        });

        rl.on('line', (line) => {
            if (line.startsWith('data:')) {
                const rawJson = line.substring(5).trim();
                try {
                    const eventData = JSON.parse(rawJson);
                    console.log('Received Event:', JSON.stringify(eventData, null, 2));
                } catch (err) {
                    console.warn('Failed to parse event data:', rawJson, err);
                }
            }
        });

        rl.on('close', () => {
            console.warn('Event stream connection closed. Reconnecting in 5 seconds...');
            setTimeout(connectToEventStream, 5000);
        });
    }).on('error', (err) => {
        console.error('Connection error:', err.message);
        console.log('Attempting to reconnect in 5 seconds...');
        setTimeout(connectToEventStream, 5000);
    });
}

connectToEventStream();
