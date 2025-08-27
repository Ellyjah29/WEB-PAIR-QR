import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { upload } from './mega.js';   // ✅ use same mega upload function

const router = express.Router();

// Helper to remove files
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

// Random Mega ID generator (same as first code)
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
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            let qrGenerated = false;
            let responseSent = false;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr);
                    if (!responseSent) {
                        responseSent = true;
                        await res.send({ qr: qrDataURL, message: 'QR Generated!' });
                    }
                } catch (qrError) {
                    console.error('Error generating QR:', qrError);
                }
            };

            let sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                if (qr && !qrGenerated) await handleQRCode(qr);

                if (connection === 'open') {
                    console.log('✅ Connected!');

                    try {
                        // Upload creds.json to Mega
                        const credsPath = `${dirs}/creds.json`;
                        const megaUrl = await upload(fs.createReadStream(credsPath), `${randomMegaId()}.json`);
                        const sessionIdFromMega = megaUrl.replace('https://mega.nz/file/', '');

                        const userJid = jidNormalizedUser(sock.user.id);

                        // Send only Mega ID + MESSAGE
                        const msg = await sock.sendMessage(userJid, { text: sessionIdFromMega });
                        await sock.sendMessage(userJid, { text: MESSAGE }, { quoted: msg });

                        console.log("📄 Mega ID sent successfully to", userJid);

                        // Cleanup
                        await delay(3000);
                        removeFile(dirs);

                    } catch (error) {
                        console.error("Error uploading to Mega:", error);
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('Error in session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
            removeFile(dirs);
        }
    }

    await initiateSession();
});

export default router;
