// VP Honda Backend — server.js (Working QR endpoint)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const fs = require('fs');
const QRCode = require('qrcode');

require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) { console.error('MongoDB URI missing'); process.exit(1); }
mongoose.connect(mongoUri)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => { console.error(err); process.exit(1); });

app.get('/', (req, res) => res.json({ status: 'ok' }));

// --- Your existing routes (unchanged) ---
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

// --- WhatsApp client setup ---
let chromePath = null;
const possiblePaths = [
    '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome',
    '/opt/render/.cache/puppeteer/chrome/linux-133.0.6943.126/chrome-linux64/chrome'
];
for (const p of possiblePaths) {
    if (fs.existsSync(p)) { chromePath = p; break; }
}
if (!chromePath) console.warn('⚠️ Chrome not found, WhatsApp may fail');
else console.log(`✅ Chrome found at: ${chromePath}`);

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: chromePath || undefined
    }
});

let latestQR = null;
waClient.on('qr', async (qr) => {
    latestQR = qr;
    const qrImage = await QRCode.toDataURL(qr);
    app.locals.qrCode = qrImage;
    console.log('🔐 QR code generated. Go to /api/qr');
});

waClient.on('ready', () => console.log('✅ WhatsApp client is ready!'));
waClient.initialize();

// QR endpoint - must be defined BEFORE error handlers
app.get('/api/qr', (req, res) => {
    if (!app.locals.qrCode) return res.status(404).send('QR code not ready yet. Wait a few seconds and refresh.');
    res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><img src="${app.locals.qrCode}" style="width:300px;height:auto;"></body></html>`);
});

// WhatsApp send endpoint (unchanged)
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

// --- Error handlers (placed at the end) ---
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ VP Honda API running on port ${PORT}`));