// VP Honda Backend — server.js (with WhatsApp Multi-File Send)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const multer = require('multer');
const puppeteer = require('puppeteer');

// ─── क्रिटिकल फिक्स: Render पर Chrome का पाथ सेट करें ────────────────────────
if (process.env.RENDER) {
    // Render environment me Chrome ka executable path set karo
    const possiblePaths = [
        '/opt/render/.cache/puppeteer/chrome/linux-133.0.6943.126/chrome-linux64/chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-122.0.6261.128/chrome-linux64/chrome',
        '/opt/render/.cache/puppeteer/chrome/linux-121.0.6167.85/chrome-linux64/chrome'
    ];
    for (const chromePath of possiblePaths) {
        const fs = require('fs');
        if (fs.existsSync(chromePath)) {
            process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;
            console.log(`✅ Chrome found at: ${chromePath}`);
            break;
        }
    }
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
        console.warn('⚠️ Chrome executable not found in cache, will rely on Puppeteer default');
    }
}

require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) { console.error('MongoDB URI not defined'); process.exit(1); }
mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 })
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => { console.error('MongoDB Error:', err.message); process.exit(1); });

app.get('/', (req, res) => {
    res.json({ status: 'ok', app: 'VP Honda API v2', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ─── Original routes ──────────────────────────────────────────────────────────
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

// ─── New Smart Feature routes ─────────────────────────────────────────────────
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/salaries', require('./routes/salaries'));
app.use('/api/salary-entities', require('./routes/salaryEntities'));
app.use('/api/messages', require('./routes/messages'));

// ─── WhatsApp Web JS (Multi-File Send) ────────────────────────────────────────
const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});

waClient.on('qr', (qr) => {
    console.log('📱 Scan this QR code with your WhatsApp mobile app:');
    qrcode.generate(qr, { small: true });
});
waClient.on('ready', () => console.log('✅ WhatsApp client is ready!'));
waClient.initialize();

app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number missing' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });

    let chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
    try {
        await waClient.sendMessage(chatId, caption);
        for (const file of req.files) {
            const media = new MessageMedia(file.mimetype, file.buffer.toString('base64'), file.originalname);
            await waClient.sendMessage(chatId, media);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Error handlers ───────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`VP Honda API running on port ${PORT}`));