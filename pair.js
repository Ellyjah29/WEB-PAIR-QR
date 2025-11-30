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

// Ensure the auth directory is empty on startup
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync(__dirname + '/auth_info_baileys');
}

// ✅ Dynamic import for Baileys (v7 ESM)
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
        DisconnectReason
    } = await loadBaileys();

    async function SUHAIL() {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        try {
            const Smd = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!Smd.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Smd.requestPairingCode(num);
                if (!res.headersSent) res.send({ code });
            }

            Smd.ev.on('creds.update', saveCreds);

            Smd.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);

                        if (fs.existsSync('./auth_info_baileys/creds.json')) {
                            const auth_path = './auth_info_baileys/';
                            const phoneNumber = num.replace(/[^0-9]/g, '');
                            let userJid = null;

                            // ✅ Resolve user JID properly (supports LIDs)
                            try {
                                const lookup = await Smd.onWhatsApp(phoneNumber + "@s.whatsapp.net");
                                userJid = lookup?.[0]?.jid || null;
                            } catch (e) {
                                console.log("onWhatsApp lookup failed:", e);
                            }

                            if (!userJid) {
                                const lidStore = Smd.signalRepository.lidMapping;
                                userJid = await lidStore.getLIDForPN(phoneNumber + "@s.whatsapp.net");
                            }

                            if (!userJid) {
                                console.log("❌ Could not resolve JID for:", phoneNumber);
                                return;
                            }

                            // Generate random Mega ID
                            function randomMegaId(length = 6, numberLength = 4) {
                                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++) {
                                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                                }
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            // Upload credentials to Mega
                            const mega_url = await upload(
                                fs.createReadStream(auth_path + 'creds.json'),
                                `${randomMegaId()}.json`
                            );
                            const sessionId = mega_url.replace('https://mega.nz/file/', '');
                            console.log("✅ Session uploaded:", sessionId);

                            // Send only session ID first
                            const sentMsg = await Smd.sendMessage(userJid, { text: sessionId });

                            // Then send custom success message (quoted)
                            await Smd.sendMessage(userJid, { text: MESSAGE }, { quoted: sentMsg });

                            await delay(2000);
                            fs.emptyDirSync(__dirname + '/auth_info_baileys');
                        }
                    } catch (e) {
                        console.log("Error during file upload or message send: ", e);
                    }

                    await delay(100);
                    fs.emptyDirSync(__dirname + '/auth_info_baileys');
                }

                // Handle connection closures
                if (connection === "close") {
                    let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    if (reason === DisconnectReason.connectionClosed) {
                        console.log("Connection closed!");
                    } else if (reason === DisconnectReason.connectionLost) {
                        console.log("Connection Lost from Server!");
                    } else if (reason === DisconnectReason.restartRequired) {
                        console.log("Restart Required, Restarting...");
                        SUHAIL().catch(err => console.log(err));
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log("Connection TimedOut!");
                    } else {
                        console.log('Connection closed with bot. Restarting...');
                        exec('pm2 restart qasim');
                    }
                }
            });

        } catch (err) {
            console.log("Error in SUHAIL function: ", err);
            exec('pm2 restart qasim');
            fs.emptyDirSync(__dirname + '/auth_info_baileys');
            if (!res.headersSent) res.send({ code: "Try After Few Minutes" });
        }
    }

    await SUHAIL();
});

module.exports = router;