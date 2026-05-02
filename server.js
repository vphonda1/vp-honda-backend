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
app.get('/', (req, res) => res.json({ status: 'ok' }));

// ====================== YOUR EXISTING ROUTES ======================
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

// ====================== DEBUG ROUTES ======================
app.get('/api/debug-routes', (req, res) => {
    res.json({
        message: "All Routes Working",
        routes: [
            { method: "GET", path: "/" },
            { method: "GET", path: "/api/qr" },
            { method: "GET", path: "/api/debug-routes" },
            { method: "POST", path: "/api/send-whatsapp-multi" }
        ]
    });
});

// ====================== WHATSAPP AUTOMATION ======================
let qrImageDataURL = null;
let isWhatsAppReady = false;

const startWhatsApp = async () => {
    try {
        console.log("🚀 Starting WhatsApp Client...");

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: "vp-honda" }),
            puppeteer: {
                headless: true,
                executablePath: '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.264/chrome-linux64/chrome',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process'
                ],
                timeout: 0,
                defaultViewport: null
            }
        });

        client.on('qr', async (qr) => {
            qrImageDataURL = await QRCode.toDataURL(qr, { width: 320 });
            console.log('✅ QR Code Generated Successfully!');
        });

        client.on('ready', () => {
            isWhatsAppReady = true;
            console.log('🎉 WhatsApp Web is Ready!');
        });

        client.on('authenticated', () => console.log('✅ Authenticated'));
        client.initialize();

    } catch (err) {
        console.error("❌ WhatsApp Error:", err.message);
    }
};

startWhatsApp();

// QR Route
app.get('/api/qr', (req, res) => {
    if (!qrImageDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15-20 seconds and refresh' });
    }
    res.send(`
        <html>
        <head><title>WhatsApp QR</title></head>
        <body style="background:#111;color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:Arial">
            <h2>Scan WhatsApp QR</h2>
            <img src="${qrImageDataURL}" style="border-radius:15px;box-shadow:0 0 25px #0f0;">
            ${isWhatsAppReady ? '<h3 style="color:lime">✅ Connected</h3>' : '<p>Scan करने के बाद Refresh करें</p>'}
        </body>
        </html>
    `);
});

// Send WhatsApp
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

    try {
        const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
        if (caption) await waClient.sendMessage(chatId, caption);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});