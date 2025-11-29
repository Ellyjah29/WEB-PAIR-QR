const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');

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

// ✅ Load Baileys dynamically (v7 is ESM-only)
async function loadBaileys() {
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        delay,
        makeCacheableSignalKeyStore,
        Browsers,
        DisconnectReason
    } = await import('@whiskeysockets/baileys');
    return { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, DisconnectReason };
}

// Clean auth dir on startup
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync('./auth_info_baileys');
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).send({ error: 'Please provide ?number=your_whatsapp_number' });
    }

    // Normalize number
    num = num.replace(/[^0-9]/g, '');
    if (num.length < 10) {
        return res.status(400).send({ error: 'Invalid phone number' });
    }

    const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, DisconnectReason } = await loadBaileys();

    async function startPairing() {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Safari"), // ✅ Valid v7 browser tuple
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });

            // Save creds on update
            sock.ev.on('creds.update', saveCreds);

            // Request pairing code immediately
            if (!sock.authState.creds.registered) {
                await delay(1000);
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            // Handle connection events
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

                if (connection === "open") {
                    console.log(`✅ Paired successfully with ${num}`);
                    await delay(8000); // Wait for full sync (including LID mapping)

                    const credsPath = './auth_info_baileys/creds.json';
                    if (fs.existsSync(credsPath)) {
                        // Generate random MEGA filename
                        const randomMegaId = (len = 8) => {
                            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            return Array.from({ length: len }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
                        };

                        try {
                            // Upload to MEGA
                            const megaUrl = await upload(
                                fs.createReadStream(credsPath),
                                `${randomMegaId()}.json`
                            );
                            const sessionId = megaUrl.replace('https://mega.nz/file/', '');

                            console.log("📤 Session uploaded to MEGA:", sessionId);
                            const userJid = `${num}@s.whatsapp.net`;

                            // Send session ID first
                            const sentMsg = await sock.sendMessage(userJid, { text: sessionId });

                            // Then send success message (quoted)
                            await sock.sendMessage(userJid, { text: MESSAGE }, { quoted: sentMsg });

                            // Cleanup
                            await delay(2000);
                            fs.emptyDirSync('./auth_info_baileys');
                            sock.ws?.close();
                        } catch (uploadErr) {
                            console.error("❌ MEGA upload failed:", uploadErr);
                            await sock.sendMessage(`${num}@s.whatsapp.net`, { text: "⚠️ Failed to upload session. Contact admin." });
                            fs.emptyDirSync('./auth_info_baileys');
                            sock.ws?.close();
                        }
                    } else {
                        console.error("❌ creds.json not found after pairing");
                        sock.ws?.close();
                    }
                }

                // Handle disconnects
                if (connection === "close") {
                    console.log(`🔌 Connection closed (code: ${statusCode})`);
                    fs.emptyDirSync('./auth_info_baileys');

                    if (statusCode === DisconnectReason.restartRequired) {
                        console.log("🔁 Restart required — retrying...");
                        startPairing().catch(console.error);
                    } else if (![DisconnectReason.loggedOut, DisconnectReason.badSession].includes(statusCode)) {
                        // Don’t restart on intentional logout
                        exec('pm2 restart qasim', (err) => {
                            if (err) console.error("PM2 restart failed:", err);
                        });
                    }

                    if (!res.headersSent) {
                        res.status(500).send({ error: "Pairing failed or disconnected" });
                    }
                }
            });
        } catch (err) {
            console.error("💥 Pairing failed:", err);
            fs.emptyDirSync('./auth_info_baileys');
            if (!res.headersSent) {
                res.status(500).send({ error: "Pairing failed. Try again later." });
            }
            exec('pm2 restart qasim');
        }
    }

    await startPairing();
});

module.exports = router;