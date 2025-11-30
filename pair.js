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

// ⬇️ Baileys v7 requires dynamic import
async function loadBaileys() {
    return await import('@whiskeysockets/baileys');
}

// Clear auth folder on start
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync(__dirname + '/auth_info_baileys');
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
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!Smd.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Smd.requestPairingCode(num);

                if (!res.headersSent) {
                    return res.send({ code });
                }
            }

            Smd.ev.on('creds.update', saveCreds);

            Smd.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(8000);

                        if (fs.existsSync('./auth_info_baileys/creds.json')) {

                            // Resolve JID safely (supports LIDs)
                            const phoneNumber = num.replace(/[^0-9]/g, '');
                            let userJid = null;

                            try {
                                const lookup = await Smd.onWhatsApp(phoneNumber + "@s.whatsapp.net");
                                userJid = lookup?.[0]?.jid || null;
                            } catch (err) {
                                console.log("onWhatsApp failed:", err);
                            }

                            // Fallback using LID mapping (Baileys v7 feature)
                            if (!userJid) {
                                const lidStore = Smd.signalRepository.lidMapping;
                                userJid = await lidStore.getLIDForPN(phoneNumber + "@s.whatsapp.net");
                            }

                            if (!userJid) {
                                console.log("❌ Cannot resolve JID for:", phoneNumber);
                                return;
                            }

                            // Generate random Mega file name
                            function randomMegaId(length = 6, numberLength = 4) {
                                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++)
                                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            const mega_url = await upload(
                                fs.createReadStream('./auth_info_baileys/creds.json'),
                                `${randomMegaId()}.json`
                            );

                            const sessionId = mega_url.replace('https://mega.nz/file/', '');
                            console.log("✅ Session ID:", sessionId);

                            // Send session ID
                            const sentMsg = await Smd.sendMessage(userJid, { text: sessionId });

                            // Send full message
                            await Smd.sendMessage(userJid, { text: MESSAGE }, { quoted: sentMsg });

                            await delay(2000);
                            fs.emptyDirSync(__dirname + '/auth_info_baileys');
                        }

                    } catch (e) {
                        console.log("Upload/send error:", e);
                    }

                    await delay(100);
                    fs.emptyDirSync(__dirname + '/auth_info_baileys');
                }

                if (connection === "close") {
                    let reason = new Boom(lastDisconnect?.error)?.output.statusCode;

                    if (reason === DisconnectReason.restartRequired) {
                        console.log("Restart Required. Restarting...");
                        SUHAIL().catch(err => console.log(err));
                    } else if (reason === DisconnectReason.timedOut) {
                        console.log("Connection Timed Out!");
                    } else if (reason === DisconnectReason.connectionLost) {
                        console.log("Connection Lost!");
                    } else if (reason === DisconnectReason.connectionClosed) {
                        console.log("Connection Closed!");
                    } else {
                        console.log("Unexpected Close. Restarting...");
                        exec('pm2 restart qasim');
                    }
                }
            });

        } catch (err) {
            console.log("Error in SUHAIL:", err);
            exec('pm2 restart qasim');
            fs.emptyDirSync(__dirname + '/auth_info_baileys');
            if (!res.headersSent) res.send({ code: "Try After Few Minutes" });
        }
    }

    await SUHAIL();
});

module.exports = router;