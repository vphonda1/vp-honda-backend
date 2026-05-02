const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const AUTH_FOLDER = 'auth_info_baileys';
let qrCodeDataURL = null;
let sock = null;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ... (Your MongoDB connection and all existing routes remain exactly the same) ...

// ============================================================
// FIXED: Robust WhatsApp Connection with Clear Session Handler
// ============================================================

const initializeBot = async () => {
    try {
        // 1. CLEAR OLD SESSION (This is the key to getting a fresh QR)
        // This deletes the potentially corrupted auth folder.
        try {
            await fs.rm(AUTH_FOLDER, { recursive: true, force: true });
            console.log("✅ Old session cleared. A fresh QR will be generated.");
        } catch (err) {
            console.log("No existing session folder found, ready for a new one.");
        }

        // Ensure the auth folder exists for the new session
        await fs.mkdir(AUTH_FOLDER, { recursive: true });

        // 2. Load the auth state (this will be empty now)
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

        // 3. Create the WhatsApp socket
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // We will handle QR generation ourselves
            browser: ['VP Honda Backend', 'Chrome', '1.0.0'], // Custom browser name
        });

        // Handle connection updates (This is where the QR event is handled)
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // THIS IS THE CRITICAL EVENT FOR THE QR CODE
            if (qr) {
                console.log("New QR Code event received. Generating image...");
                try {
                    // Generate a clean, scannable QR code as a Data URL
                    qrCodeDataURL = await QRCode.toDataURL(qr, { 
                        width: 350, 
                        margin: 2,
                        color: { dark: '#000000', light: '#FFFFFF' } 
                    });
                    console.log("✅ QR code generated successfully! Ready at /api/qr");
                } catch (err) {
                    console.error("Error generating QR image:", err);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`Connection closed. Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);

                // Automatically restart the bot if the connection was closed gracefully.
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log("Reconnecting...");
                    initializeBot();
                } else {
                    console.log("Device logged out. Please restart the server to clear session.");
                }
            }

            if (connection === 'open') {
                console.log('🎉 WhatsApp is CONNECTED and ready to send messages!');
                qrCodeDataURL = null; // Clear the QR code from memory as it's no longer needed
            }
        });

        // Handle credentials update (save the session after successful pairing)
        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        console.error("Failed to initialize WhatsApp bot:", err);
        // Retry after a delay if initialization fails
        setTimeout(initializeBot, 5000);
    }
};

// Start the bot
initializeBot();

// ============================================================
// QR CODE ENDPOINT (Now reliably displays a scannable image)
// ============================================================
app.get('/api/qr', (req, res) => {
    if (qrCodeDataURL) {
        // Send a clean HTML page with the QR code image
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
                <title>VP Honda - WhatsApp QR Code</title>
                <style>
                    body { font-family: system-ui, sans-serif; background: #000; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
                    .card { background: #1e293b; padding: 30px; border-radius: 24px; max-width: 500px; }
                    img { max-width: 100%; height: auto; border-radius: 16px; background: white; padding: 20px; box-sizing: border-box; }
                    p { color: #94a3b8; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>VP Honda - WhatsApp QR Code</h2>
                    <img src="${qrCodeDataURL}" alt="WhatsApp QR Code">
                    <p>1. Open WhatsApp on your phone<br>2. Tap Menu (⋮) or Settings → Linked Devices<br>3. Tap "Link a Device" and scan this code</p>
                </div>
            </body>
            </html>
        `);
    } else if (sock && sock.user?.id) {
        res.status(400).send(`
            <div style="font-family: system-ui; text-align: center; margin-top: 50px;">
                <h2 style="color: #22c55e;">✅ WhatsApp is already connected!</h2>
                <p style="color: #64748b;">You don't need to scan a QR code. The bot is ready to send messages.</p>
            </div>
        `);
    } else {
        res.status(404).send(`
            <div style="font-family: system-ui; text-align: center; margin-top: 50px;">
                <h2 style="color: #ef4444;">⏳ QR Code Not Ready Yet</h2>
                <p style="color: #64748b;">Please wait a few seconds and refresh the page.<br>The server is generating the connection code.</p>
            </div>
        `);
    }
});

// ... (Your WhatsApp send endpoint and all other routes remain exactly the same) ...

// Final 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ VP Honda API running on port ${PORT}`));