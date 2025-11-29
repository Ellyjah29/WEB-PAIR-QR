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

// Utility: safe-read creds.json or return null
async function readCreds(authPath) {
  const credsFile = path.join(authPath, 'creds.json');
  if (!fs.existsSync(credsFile)) return null;
  try {
    const raw = await fs.readFile(credsFile, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Utility: patch creds JSON so v7 has required keys (but don't rely on this alone)
async function patchCredsDefaults(authPath) {
  const credsFile = path.join(authPath, 'creds.json');
  if (!fs.existsSync(credsFile)) return false;
  try {
    const raw = await fs.readFile(credsFile, 'utf8');
    const creds = JSON.parse(raw);
    let modified = false;

    if (!('lid-mapping' in creds)) {
      creds['lid-mapping'] = {};
      modified = true;
    }
    if (!('device-list' in creds)) {
      creds['device-list'] = {}; // object/map is safer than array default
      modified = true;
    }
    if (!('tctoken' in creds)) {
      creds['tctoken'] = '';
      modified = true;
    }

    if (modified) {
      await fs.writeFile(credsFile, JSON.stringify(creds, null, 2), 'utf8');
      console.log("🔧 Patched creds.json with v7 defaults (lid-mapping, device-list, tctoken).");
    }
    return true;
  } catch (err) {
    console.error("❌ Failed to read/patch creds.json:", err);
    return false;
  }
}

// Wait for Baileys to populate tctoken/device-list/lid-mapping OR until timeout
// Will resolve with the final creds object (possibly still incomplete if timed out)
function waitForValidCreds(authPath, socketEv, timeoutMs = 25000) {
  return new Promise(async (resolve) => {
    const credsFile = path.join(authPath, 'creds.json');

    // helper to evaluate if creds look valid for v7
    const isValid = (creds) => {
      if (!creds) return false;
      const hasDeviceList = creds['device-list'] && Object.keys(creds['device-list']).length > 0;
      const hasTCToken = typeof creds['tctoken'] === 'string' && creds['tctoken'].trim().length > 0;
      const hasLid = creds['lid-mapping'] && Object.keys(creds['lid-mapping']).length > 0;
      // consider valid if we have either device-list populated OR tctoken non-empty
      return hasDeviceList || hasTCToken || hasLid;
    };

    // immediate check
    let creds = await readCreds(authPath);
    if (isValid(creds)) return resolve(creds);

    let done = false;
    const timeout = setTimeout(async () => {
      if (done) return;
      done = true;
      // try a final patch & read
      await patchCredsDefaults(authPath);
      const finalCreds = await readCreds(authPath);
      console.warn("⚠️ waitForValidCreds: timed out waiting for tctoken/device-list. Uploading whatever we have.");
      return resolve(finalCreds);
    }, timeoutMs);

    // If socketEv provided, listen for creds.update events
    const onCredsUpdate = async () => {
      if (done) return;
      creds = await readCreds(authPath);
      if (isValid(creds)) {
        clearTimeout(timeout);
        done = true;
        if (socketEv && typeof socketEv.removeListener === 'function') {
          socketEv.removeListener('creds.update', onCredsUpdate);
        }
        return resolve(creds);
      }
      // otherwise keep waiting until timeout
    };

    if (socketEv && typeof socketEv.on === 'function') {
      socketEv.on('creds.update', onCredsUpdate);
    }

    // also poll every 1s as fallback
    const poll = setInterval(async () => {
      if (done) {
        clearInterval(poll);
        return;
      }
      creds = await readCreds(authPath);
      if (isValid(creds)) {
        clearTimeout(timeout);
        clearInterval(poll);
        done = true;
        if (socketEv && typeof socketEv.removeListener === 'function') {
          socketEv.removeListener('creds.update', onCredsUpdate);
        }
        return resolve(creds);
      }
    }, 1000);
  });
}

// helper: random friendly mega filename
function randomMegaId(length = 6, numberLength = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  const number = Math.floor(Math.random() * Math.pow(10, numberLength));
  return `${result}${number}`;
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

  async function SUHAIL() {
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

      // Save any creds updates
      Smd.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (e) {
          console.error("Failed to saveCreds:", e);
        }
      });

      // Pairing: request code when not registered
      if (!Smd.authState?.creds?.registered) {
        await delay(1500);
        const code = await Smd.requestPairingCode(num);
        if (!res.headersSent) {
          res.send({ code });
        }
      } else {
        if (!res.headersSent) res.send({ info: 'Already registered (creds present). Proceeding to upload when ready.' });
      }

      // Connection handler
      Smd.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          try {
            // small wait to ensure creds update has time to run
            await delay(1500);

            // Wait for Baileys to populate tctoken/device-list etc (or timeout)
            const finalCreds = await waitForValidCreds(AUTH_DIR, Smd.ev, 22000);

            // As a safe fallback, ensure defaults exist (this won't create a true tctoken/device-list)
            await patchCredsDefaults(AUTH_DIR);

            const credsFilePath = path.join(AUTH_DIR, 'creds.json');
            if (fs.existsSync(credsFilePath)) {
              const stream = fs.createReadStream(credsFilePath);
              let mega_url;
              try {
                mega_url = await upload(stream, `${randomMegaId()}.json`);
              } catch (uploadErr) {
                console.error("❌ Mega upload failed:", uploadErr);
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
                await Smd.sendMessage(phoneJid, { text: MESSAGE }, { quoted: sentMsg });
                console.log(`✅ Sent session ID to ${phoneJid}`);
              } catch (sendErr) {
                console.warn(`⚠️ Failed to send to ${phoneJid}:`, sendErr?.message || sendErr);

                // fallback: send to Smd.user.id (the connected companion)
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
                res.send({ sessionId, note: "Session uploaded; if messages do not arrive, regenerate session using this endpoint (server must be running during pairing)." });
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
      try { exec('pm2 restart qasim'); } catch (e) {}
      try { await fs.emptyDir(AUTH_DIR); } catch (e) {}
      if (!res.headersSent) res.send({ code: "Try After Few Minutes" });
    }
  }

  // start pairing routine
  await SUHAIL();
});

module.exports = router;