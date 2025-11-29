// session-router.js
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega'); // your existing mega upload helper

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

// Ensure the auth folder is empty at startup (optional)
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
try {
  if (fs.existsSync(AUTH_DIR)) {
    fs.emptyDirSync(AUTH_DIR);
  } else {
    fs.ensureDirSync(AUTH_DIR);
  }
} catch (err) {
  console.error("Failed to prepare auth directory:", err);
}

// Dynamic import for ESM Baileys (v7)
async function loadBaileys() {
  return await import('@whiskeysockets/baileys');
}

// Utility: patch creds JSON so v7 has required keys
async function ensureV7Creds(authPath) {
  const credsFile = path.join(authPath, 'creds.json');
  if (!fs.existsSync(credsFile)) return false;

  try {
    const raw = await fs.readFile(credsFile, 'utf8');
    const creds = JSON.parse(raw);

    let modified = false;

    // ensure lid-mapping exists
    if (!('lid-mapping' in creds)) {
      creds['lid-mapping'] = {};
      modified = true;
    }

    // ensure device-list exists
    if (!('device-list' in creds)) {
      // v7 may store devices in an object/map, not always an array — use empty object as safe default
      creds['device-list'] = {};
      modified = true;
    }

    // ensure tctoken exists
    if (!('tctoken' in creds)) {
      creds['tctoken'] = ''; // token is string; empty works as placeholder
      modified = true;
    }

    // Some sessions store keys under "account" or "keys"; no changes needed there.
    if (modified) {
      await fs.writeFile(credsFile, JSON.stringify(creds, null, 2), 'utf8');
      console.log("🔧 Patched creds.json with v7 defaults (lid-mapping, device-list, tctoken).");
    } else {
      console.log("ℹ️ creds.json already has v7 keys.");
    }
    return true;
  } catch (err) {
    console.error("❌ Failed to read/patch creds.json:", err);
    return false;
  }
}

// Main route: create session and upload
router.get('/', async (req, res) => {
  let num = req.query.number;
  if (!num) return res.send({ error: 'Please provide ?number=your_whatsapp_number' });

  // clean number (digits only)
  num = ('' + num).replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Invalid number' });

  let baileys;
  try {
    baileys = await loadBaileys();
  } catch (err) {
    console.error("❌ Failed to import Baileys:", err);
    return res.status(500).send({ error: 'Server Baileys import failed' });
  }

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
  } = baileys;

  // Local async pairing routine
  async function SUHAIL() {
    // Use the shared auth directory
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    try {
      const Smd = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Safari"),
        // IMPORTANT: disable full history sync to avoid hangs on v7
        syncFullHistory: false,
        // short keepalive and reasonable timeouts
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
      });

      // If not registered yet, request pairing code for the given number
      if (!Smd.authState?.creds?.registered) {
        await delay(1500);
        const code = await Smd.requestPairingCode(num);
        if (!res.headersSent) {
          res.send({ code });
        }
      } else {
        // if already registered, notify caller (just in case)
        if (!res.headersSent) res.send({ info: 'Already registered (creds present). Proceeding to upload.' });
      }

      // Ensure we save credentials on any update
      Smd.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (e) {
          console.error("Failed to saveCreds:", e);
        }
      });

      // Connection update handler
      Smd.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          try {
            // small wait to ensure creds written
            await delay(2500);

            // Ensure creds.json exists and patch for v7 before uploading
            const didPatch = await ensureV7Creds(AUTH_DIR);

            const credsFilePath = path.join(AUTH_DIR, 'creds.json');
            if (fs.existsSync(credsFilePath)) {
              // upload patched creds.json
              const stream = fs.createReadStream(credsFilePath);

              // create a friendly random name for the mega file
              function randomMegaId(length = 6, numberLength = 4) {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                let result = '';
                for (let i = 0; i < length; i++) {
                  result += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                return `${result}${number}`;
              }

              let mega_url;
              try {
                mega_url = await upload(stream, `${randomMegaId()}.json`);
              } catch (uploadErr) {
                console.error("❌ Mega upload failed:", uploadErr);
                // respond if nothing sent yet
                if (!res.headersSent) res.status(500).send({ error: 'Mega upload failed' });
                return;
              }

              const sessionId = mega_url.replace('https://mega.nz/file/', '');
              console.log("✅ Session uploaded:", sessionId);

              // Try to send the sessionId to the target phone JID first
              const phoneJid = `${num}@s.whatsapp.net`;
              let sentMsg;
              try {
                sentMsg = await Smd.sendMessage(phoneJid, { text: sessionId });
                // then quoted success message
                await Smd.sendMessage(phoneJid, { text: MESSAGE }, { quoted: sentMsg });
                console.log(`✅ Sent session ID to ${phoneJid}`);
              } catch (sendErr) {
                console.warn(`⚠️ Failed to send to ${phoneJid}:`, sendErr?.message || sendErr);

                // fallback: send to Smd.user.id (the device that got connected) — helps when recipient uses LID
                try {
                  const fallbackJid = Smd.user?.id;
                  if (fallbackJid) {
                    const fmsg = await Smd.sendMessage(fallbackJid, { text: sessionId });
                    await Smd.sendMessage(fallbackJid, { text: MESSAGE }, { quoted: fmsg });
                    console.log(`✅ Fallback: Sent session ID to ${fallbackJid}`);
                  } else {
                    console.error("❌ No fallback jid available (Smd.user.id not set).");
                    if (!res.headersSent) res.status(500).send({ error: 'Could not deliver session ID (no fallback)' });
                    return;
                  }
                } catch (fallbackErr) {
                  console.error("❌ Fallback send failed:", fallbackErr);
                  if (!res.headersSent) res.status(500).send({ error: 'Failed to deliver session ID' });
                  return;
                }
              }

              // success: send http reply if not already sent
              if (!res.headersSent) {
                res.send({ sessionId });
              }

              // cleanup local auth directory (short delay to ensure file closed)
              await delay(1000);
              try {
                await fs.emptyDir(AUTH_DIR);
              } catch (cleanupErr) {
                console.error("Cleanup failed:", cleanupErr);
              }
            } else {
              console.error("creds.json not found after connection.open");
              if (!res.headersSent) res.status(500).send({ error: 'creds.json missing' });
            }
          } catch (e) {
            console.log("Error during file upload or message send: ", e);
            if (!res.headersSent) res.status(500).send({ error: 'Internal error during upload/send' });
          }

          // ensure directory cleaned again
          try { await fs.emptyDir(AUTH_DIR); } catch (e) {}
        }

        // Handle connection closures
        if (connection === "close") {
          const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
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
            console.log('Connection closed with bot. Restarting pm2 process qasim...');
            exec('pm2 restart qasim');
          }
        }
      });

    } catch (err) {
      console.log("Error in SUHAIL function: ", err);
      // try to restart process or reply with friendly error
      try { exec('pm2 restart qasim'); } catch (e) {}
      try { await fs.emptyDir(AUTH_DIR); } catch (e) {}
      if (!res.headersSent) res.send({ code: "Try After Few Minutes" });
    }
  }

  // start pairing routine
  await SUHAIL();
});

module.exports = router;
