const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const fs = require('fs');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) {
    console.error('❌ MongoDB URI missing in environment variables');
    process.exit(1);
}

mongoose.connect(mongoUri)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Root Route
app.get('/', (req, res) => res.json({ status: 'ok', message: 'VP Honda Backend Running' }));

// ====================== ALL ROUTES ======================
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

// ====================== WHATSAPP SETUP ======================
let chromePath = null;
const possiblePaths = [
    '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    '/opt/render/.cache/puppeteer/chrome/linux-133.0.6943.126/chrome-linux64/chrome'
];

for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        chromePath = p;
        break;
    }
}

console.log(chromePath ? `✅ Chrome found at: ${chromePath}` : '⚠️ Chrome not found');

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: chromePath || undefined,
        timeout: 60000
    }
});

let qrImageDataURL = null;

waClient.on('qr', async (qr) => {
    try {
        qrImageDataURL = await QRCode.toDataURL(qr, { width: 300 });
        console.log('✅ New QR Code Generated - Ready at /api/qr');
    } catch (err) {
        console.error('QR Code Generation Error:', err);
    }
});

waClient.on('ready', () => {
    console.log('✅ WhatsApp Client is Ready!');
});

waClient.on('authenticated', () => {
    console.log('✅ WhatsApp Authenticated');
});

waClient.initialize();

// ====================== QR ROUTE ======================
app.get('/api/qr', (req, res) => {
    if (!qrImageDataURL) {
        return res.status(404).json({
            error: 'QR not ready',
            message: 'Please wait 10-20 seconds and refresh this page'
        });
    }

    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WhatsApp QR - VP Honda</title>
</head>
<body style="margin:0; background:#111; display:flex; justify-content:center; align-items:center; min-height:100vh; flex-direction:column; color:white; font-family:Arial,sans-serif;">
    <h2>Scan WhatsApp QR Code</h2>
    <img src="${qrImageDataURL}" style="width:280px; border-radius:16px; box-shadow:0 0 25px rgba(0,255,0,0.4);">
    <p style="margin-top:15px; opacity:0.9;">Scan this QR code with your WhatsApp</p>
    <small>If QR not visible, refresh page after 15 seconds</small>
</body>
</html>`);
});

// ====================== SEND WHATSAPP ======================
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

    try {
        // Send text message
        if (caption) {
            await waClient.sendMessage(chatId, caption);
        }

        // Send files if any
        for (const file of req.files || []) {
            const media = new MessageMedia(
                file.mimetype,
                file.buffer.toString('base64'),
                file.originalname
            );
            await waClient.sendMessage(chatId, media);
        }

        res.json({ success: true, message: 'Message sent successfully' });
    } catch (err) {
        console.error('WhatsApp Send Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ====================== 404 HANDLER (LAST) ======================
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.path,
        method: req.method
    });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 QR Code URL: http://localhost:${PORT}/api/qr`);
});