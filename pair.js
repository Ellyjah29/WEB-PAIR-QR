const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');
const NodeCache = require("node-cache");

let router = express.Router();

const MESSAGE = `
*SESSION GENERATED SUCCESSFULLY* ✅

*Join channel* 📢              
Follow the Septorch ™ channel on WhatsApp: https://whatsapp.com/channel/0029Vb1ydGk8qIzkvps0nZ04   

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭              
https://chat.whatsapp.com/GGBjhgrxiAS1Xf5shqiGXH?mode=wwt   

*Yᴏᴜᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄               
https://youtube.com/@septorch   

*SEPTORCH--WHATSAPP-BOT* 🤖
`;

// Helper: Zip folder to buffer
function zipFolder(folderPath) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const buffers = [];

        archive.on('data', (data) => buffers.push(data));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);

        archive.directory(folderPath, false);
        archive.finalize();
    });
}

// Ensure session dir is clean on startup
const SESSION_DIR = path.join(__dirname, 'auth_info_baileys');
if (fs.existsSync(SESSION_DIR)) {
    fs.emptyDirSync(SESSION_DIR);
}

// Dynamically import Baileys (ESM)
async function loadBaileys() {
    return await import('@whiskeysockets/baileys');
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.send({ error: 'Please provide ?number=your_whatsapp_number' });

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        delay,
        makeCacheableSignalKeyStore,
        Browsers,
        DisconnectReason,
        fetchLatestBaileysVersion,
    } = await loadBaileys();

    // ✅ Fetch latest WhatsApp protocol version
    const { version } = await fetchLatestBaileysVersion();

    async function SUHAIL() {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const msgRetryCounterCache = new NodeCache();

        try {
            const Smd = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                // ✅ Valid browser tuple (Android-like, but using supported format)
                browser: ['SEPTORCH', 'Chrome', '120.0.0'],
                msgRetryCounterCache,
                // ✅ Required in v7
                getMessage: async () => ({}),
            });

            // Set up timeout BEFORE connection logic
            let timeoutCleared = false;
            const clearTimeoutSafe = () => {
                if (!timeoutCleared) {
                    clearTimeout(pairingTimeout);
                    timeoutCleared = true;
                }
            };

            const pairingTimeout = setTimeout(async () => {
                if (!res.headersSent) {
                    res.status(408).send({ error: "Pairing timeout – please retry" });
                }
                if (Smd.ws?.readyState === Smd.ws.OPEN) {
                    await Smd.end(null).catch(() => {});
                }
                if (fs.existsSync(SESSION_DIR)) {
                    fs.emptyDirSync(SESSION_DIR);
                }
            }, 60000); // 60 seconds

            if (!Smd.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Smd.requestPairingCode(num);
                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            Smd.ev.on('creds.update', saveCreds);

            Smd.ev.on("connection.update", async (s) => {
                // ✅ Clear timeout on any terminal connection state
                if (s.connection === "open" || s.connection === "close") {
                    clearTimeoutSafe();
                }

                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
                            const phoneNumber = num.replace(/[^0-9]/g, '');
                            const userJid = `${phoneNumber}@s.whatsapp.net`;

                            function randomMegaId(length = 6, numberLength = 4) {
                                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++) {
                                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                                }
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            const zipBuffer = await zipFolder(SESSION_DIR);
                            const zipStream = require('stream').Readable.from(zipBuffer);
                            const mega_url = await upload(zipStream, `${randomMegaId()}.zip`);

                            console.log("✅ Session ZIP uploaded:", mega_url);

                            const megaId = mega_url.replace(/^https:\/\/mega\.nz\/file\//, '');

                            const sentMsg = await Smd.sendMessage(userJid, { text: megaId });
                            await Smd.sendMessage(userJid, { text: MESSAGE }, { quoted: sentMsg });

                            await delay(2000);
                        }
                    } catch (e) {
                        console.error("Error during session upload or message send:", e);
                    } finally {
                        if (fs.existsSync(SESSION_DIR)) {
                            fs.emptyDirSync(SESSION_DIR);
                        }
                    }
                }

                // Handle connection close
                if (connection === "close") {
                    let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    if (reason === DisconnectReason.connectionClosed) {
                        console.log("Connection closed!");
                    } else if (reason === DisconnectReason.connectionLost) {
                        console.log("Connection Lost from Server!");
                    } else if (reason === DisconnectReason.restartRequired) {
                        console.log("Restart Required, Restarting...");
                        SUHAIL().catch(console.error);
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log("Connection TimedOut!");
                    } else {
                        console.log('Unexpected disconnect. Restarting...');
                        exec('pm2 restart qasim');
                    }
                }
            });

        } catch (err) {
            console.error("Error in SUHAIL function:", err);
            exec('pm2 restart qasim');
            if (fs.existsSync(SESSION_DIR)) {
                fs.emptyDirSync(SESSION_DIR);
            }
            if (!res.headersSent) {
                res.status(500).send({ code: "Try After Few Minutes" });
            }
        }
    }

    await SUHAIL();
});

module.exports = router;
