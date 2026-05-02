const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (mongoUri) mongoose.connect(mongoUri).then(() => console.log('✅ MongoDB Connected'));

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Debug Route
app.get('/api/debug-routes', (req, res) => {
    res.json({ status: "ok", message: "Server is running" });
});

// ====================== BAILEYS WHATSAPP ======================
let qrCodeDataURL = null;

const startWhatsApp = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { qr, connection } = update;

        if (qr) {
            qrCodeDataURL = await QRCode.toDataURL(qr, { width: 320 });
            console.log("✅ QR GENERATED!");
        }

        if (connection === 'open') {
            console.log("🎉 WhatsApp Connected!");
        }
    });

    sock.ev.on('creds.update', saveCreds);
};

startWhatsApp();

// QR Route
app.get('/api/qr', (req, res) => {
    if (!qrCodeDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15 seconds' });
    }
    res.send(`<img src="${qrCodeDataURL}" width="300">`);
});

// Send Route
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    res.json({ success: true, message: "Baileys is ready" });
});

app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));