const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');

const router = express.Router();

const MESSAGE = process.env.MESSAGE || `
*SESSION GENERATED SUCCESSFULY* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
https://github.com/GuhailTechInfo/ULTRA-MD

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭
https://t.me/GlobalBotInc
https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07

*Yᴏᴜ-ᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄 
https://youtube.com/GlobalTechInfo

*ULTRA-MD--WHATTSAPP-BOT* 🥀
`;

// Clean auth folder when the app starts
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync(__dirname + '/auth_info_baileys');
}

// ---------------- MAIN ROUTE ----------------
router.get('/', async (req, res) => {
    let num = req.query.number;

    async function SUHAIL() {
        try {
            // Dynamically import Baileys (fix for ERR_REQUIRE_ESM)
            const baileys = await import('@whiskeysockets/baileys');
            const {
                default: makeWASocket,
                useMultiFileAuthState,
                delay,
                makeCacheableSignalKeyStore,
                Browsers,
                DisconnectReason
            } = baileys;

            const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_baileys`);
            const Smd = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            // Send pairing code
            if (!Smd.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Smd.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            // Save credentials
            Smd.ev.on('creds.update', saveCreds);

            // Handle connection updates
            Smd.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(10000);
                        if (fs.existsSync('./auth_info_baileys/creds.json')) {
                            const auth_path = './auth_info_baileys/';
                            const user = Smd.user.id;

                            // Generate random Mega file name
                            function randomMegaId(length = 6, numberLength = 4) {
                                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                                let result = '';
                                for (let i = 0; i < length; i++) {
                                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                                }
                                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                                return `${result}${number}`;
                            }

                            // Upload creds to Mega
                            const mega_url = await upload(
                                fs.createReadStream(auth_path + 'creds.json'),
                                `${randomMegaId()}.json`
                            );

                            const sessionId = mega_url.replace('https://mega.nz/file/', '');
                            const msg = await Smd.sendMessage(user, { text: sessionId });
                            await Smd.sendMessage(user, { text: MESSAGE }, { quoted: msg });
                            await delay(1000);
                            fs.emptyDirSync(__dirname + '/auth_info_baileys');
                        }
                    } catch (err) {
                        console.error("Error during upload or message:", err);
                    }
                    await delay(100);
                    fs.emptyDirSync(__dirname + '/auth_info_baileys');
                }

                // Handle disconnects
                if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    switch (reason) {
                        case DisconnectReason.connectionClosed:
                            console.log("Connection closed!");
                            break;
                        case DisconnectReason.connectionLost:
                            console.log("Connection lost from server!");
                            break;
                        case DisconnectReason.restartRequired:
                            console.log("Restart required, restarting...");
                            SUHAIL().catch(console.error);
                            break;
                        case DisconnectReason.timedOut:
                            console.log("Connection timed out!");
                            break;
                        default:
                            console.log("Connection closed with bot. Restarting...");
                            await delay(5000);
                            exec('pm2 restart qasim');
                    }
                }
            });

        } catch (err) {
            console.error("Error in SUHAIL():", err);
            exec('pm2 restart qasim');
            if (!res.headersSent) {
                await res.send({ code: "Try Again Later" });
            }
            fs.emptyDirSync(__dirname + '/auth_info_baileys');
        }
    }

    await SUHAIL();
});

module.exports = router;
