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
if (mongoUri) {
    mongoose.connect(mongoUri)
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.error('MongoDB Error:', err));
}

// Root Route
app.get('/', (req, res) => res.json({ status: 'ok', message: 'VP Honda Backend Running' }));

// ====================== YOUR EXISTING ROUTES (Unchanged) ======================
app.use('/api/customers', require('./routes/customers'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/serviceCustomers', require('./routes/serviceCustomers'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/oldbikes', require('./routes/oldbikes'));
app.use('/api/quotations', require('./routes/quotations'));
app.use('/api', require('./routes/dataImport'));
app.use('/api/service-data', require('./routes/servicedata'));
app.use('/api/follow-ups', require('./routes/followups'));
app.use('/api', require('./routes/push'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/salaries', require('./routes/salaries'));
app.use('/api/salary-entities', require('./routes/salaryEntities'));
app.use('/api/messages', require('./routes/messages'));

// ====================== BAILEYS WHATSAPP (Improved) ======================
let qrCodeDataURL = null;
let isConnected = false;
let sock = null;

const startWhatsApp = async () => {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,   // Extra logging
            logger: require('pino')({ level: 'silent' }),
            markOnlineOnConnect: false
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log("🔥 QR CODE RECEIVED!");
                qrCodeDataURL = await QRCode.toDataURL(qr, { width: 320 });
                console.log("✅ QR Code Generated - Ready at /api/qr");
            }

            if (connection === 'open') {
                isConnected = true;
                console.log("🎉 WhatsApp Connected Successfully!");
            }

            if (connection === 'close') {
                console.log("Connection closed, reconnecting in 5s...");
                setTimeout(startWhatsApp, 5000);
            }
        });

        sock.ev.on('creds.update', saveCreds);
        console.log("✅ Baileys Socket Initialized");

    } catch (err) {
        console.error("Baileys Error:", err.message);
    }
};

startWhatsApp();

// QR Route
app.get('/api/qr', (req, res) => {
    if (!qrCodeDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15-20 seconds and refresh' });
    }
    res.send(`
        <html><body style="background:#111;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;">
            <h2>Scan WhatsApp QR</h2>
            <img src="${qrCodeDataURL}" width="300" style="border-radius:12px;">
            ${isConnected ? '<h3 style="color:lime">✅ Connected</h3>' : ''}
        </body></html>
    `);
});

// Send WhatsApp Route
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber || !sock) return res.status(400).json({ error: 'Phone number or WhatsApp not ready' });

    try {
        const jid = `${phoneNumber.replace('+', '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: caption || 'Message from VP Honda' });
        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 404 Handler
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));