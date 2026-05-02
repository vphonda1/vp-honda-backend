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
} else {
    console.warn('⚠️ MongoDB URI not found');
}

// Root Route
app.get('/', (req, res) => res.json({ status: 'ok', message: 'VP Honda Backend' }));

// ====================== ALL OTHER ROUTES ======================
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

// ====================== WHATSAPP QR ======================
let qrImageDataURL = null;

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'
    }
});

waClient.on('qr', async (qr) => {
    qrImageDataURL = await QRCode.toDataURL(qr, { width: 300 });
    console.log('✅ QR Code Generated - Access at /api/qr');
});

waClient.on('ready', () => console.log('✅ WhatsApp Client Ready'));
waClient.initialize();

// 🔥 QR Route - सबसे महत्वपूर्ण
app.get('/api/qr', (req, res) => {
    console.log('QR Route Hit!');
    if (!qrImageDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15-20 seconds' });
    }
    res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><img src="${qrImageDataURL}" width="300" style="border-radius:12px"></body></html>`);
});

// Send WhatsApp Route
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    // आपका पुराना logic यहाँ paste कर दें
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone missing' });
    
    // ... बाकी आपका code
    res.json({ success: true });
});

// 404 Handler - अंत में
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Route not found', path: req.path });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 QR URL: https://vp-honda-backend.onrender.com/api/qr`);
});