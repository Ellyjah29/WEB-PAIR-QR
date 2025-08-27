import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { 
    makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore, 
    Browsers, 
    fetchLatestBaileysVersion, 
    delay 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { upload } from './mega.js';

const router = express.Router();

// Random Mega ID generator
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

const MESSAGE = process.env.MESSAGE || `
*SESSION GENERATED SUCCESSFULY* ✅

*🌟 Join the official channel for more courage, updates, and support!* 🌟
https://whatsapp.com/channel/0029Vb1ydGk8qIzkvps0nZ04

*Ask me any question Here* 
ngl.link/septorch

Instagram: instagram.com/septorch29
TikTok: tiktok.com/@septorch

I will answer your question on the channel 
https://whatsapp.com/channel/0029Vb1ydGk8qIzkvps0nZ04

*SEPTORCH--WHATTSAPP-BOT*
`;

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Please provide ?number= with phone number" });

    async function startSession() {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');

        try {
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                logger: pino({ level: 'fatal' }),
                browser: Browsers.macOS("Safari"),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false
            });

            if (!sock.authState.creds.registered) {
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code }); // ✅ send pairing code back to client
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    try {
                        await delay(10000);

                        // Upload creds.json to Mega
                        const megaUrl = await upload(fs.createReadStream('./auth_info_baileys/creds.json'), `${randomMegaId()}.json`);
                        const sessionId = megaUrl.replace('https://mega.nz/file/', '');

                        // Send Mega ID + MESSAGE to user
                        const userJid = sock.user.id;
                        const msg = await sock.sendMessage(userJid, { text: sessionId });
                        await sock.sendMessage(userJid, { text: MESSAGE }, { quoted: msg });

                        console.log("✅ Mega ID sent to", userJid);

                        // Cleanup
                        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
                    } catch (e) {
                        console.error("Error uploading creds:", e);
                    }
                }

                if (connection === "close") {
                    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                    console.log("Connection closed:", reason);
                }
            });

        } catch (err) {
            console.error("Error starting session:", err);
            if (!res.headersSent) {
                res.send({ code: "Try again later" });
            }
            fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
        }
    }

    await startSession();
});

export default router;
