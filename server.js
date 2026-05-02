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
mongoose.connect(mongoUri)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('MongoDB Error:', err));

app.get('/', (req, res) => res.json({ status: 'ok' }));

// All Routes
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

// WhatsApp Client
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
    console.log('✅ QR Code Generated Successfully');
});

waClient.on('ready', () => console.log('✅ WhatsApp Ready'));
waClient.initialize();

// ✅ IMPORTANT: QR Route
app.get('/api/qr', (req, res) => {
    if (!qrImageDataURL) {
        return res.status(404).json({ error: 'QR not ready', message: 'Wait 15 seconds' });
    }
    res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><img src="${qrImageDataURL}" width="300"></body></html>`);
});

// Send WhatsApp
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    // ... your existing logic
    const { phoneNumber, caption } = req.body;
    // (keep your existing code here)
});

// 404 Last
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));