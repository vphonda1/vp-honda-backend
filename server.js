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
    mongoose.connect(mongoUri).then(() => console.log('✅ MongoDB Connected')).catch(err => console.error(err));
}

// Root
app.get('/', (req, res) => res.json({ status: 'ok' }));

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

// ====================== DEBUG ROUTES ======================
app.get('/api/debug-routes', (req, res) => {
    const routes = [];
    if (app._router?.stack) {
        app._router.stack.forEach(layer => {
            if (layer.route) {
                routes.push({ method: Object.keys(layer.route.methods)[0].toUpperCase(), path: layer.route.path });
            }
        });
    }
    res.json({ message: "Registered Routes", count: routes.length, routes });
});

// ====================== QR ROUTE ======================
let qrImageDataURL = null;

app.get('/api/qr', (req, res) => {
    if (!qrImageDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15 seconds' });
    }
    res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh"><img src="${qrImageDataURL}" width="300"></body></html>`);
});

// ====================== WHATSAPP SETUP (Safe) ======================
let qrImageDataURL = null;

const startWhatsApp = async () => {
    try {
        console.log("🚀 Starting WhatsApp Client...");

        const waClient = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
                timeout: 60000,
            }
        });

        waClient.on('qr', async (qr) => {
            qrImageDataURL = await QRCode.toDataURL(qr, { width: 300 });
            console.log('✅ QR Code Generated Successfully');
        });

        waClient.on('ready', () => console.log('✅ WhatsApp Ready'));
        waClient.on('authenticated', () => console.log('✅ WhatsApp Authenticated'));
        waClient.on('disconnected', () => console.log('❌ WhatsApp Disconnected'));

        await waClient.initialize();
        console.log("✅ WhatsApp Client Initialized");

    } catch (err) {
        console.error('❌ WhatsApp Init Error:', err.message);
    }
};

// Start WhatsApp
startWhatsApp();


// ====================== SEND WHATSAPP ======================
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone missing' });

    try {
        const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
        if (caption) await waClient.sendMessage(chatId, caption);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 404 Last
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔍 Debug: https://vp-honda-backend.onrender.com/api/debug-routes`);
});