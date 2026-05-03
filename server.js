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

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (mongoUri) {
    mongoose.connect(mongoUri).then(() => console.log('✅ MongoDB Connected'));
}

app.get('/', (req, res) => res.json({ status: 'ok' }));

// ----- सभी पुराने routes (customers, documents, etc.) बिल्कुल यहाँ रहेंगे – आपको बस अपने routes यहाँ जोड़ने हैं -----
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

// ----- WhatsApp Client Setup (WhatsApp Web JS) -----
// Chrome का पाथ ढूंढो (Render के cache में)
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
if (!chromePath) console.warn('⚠️ Chrome not found');
else console.log(`✅ Chrome found at: ${chromePath}`);

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: chromePath || undefined
    }
});

let qrCodeImage = null;
waClient.on('qr', async (qr) => {
    // QR को Image में बदलो
    qrCodeImage = await QRCode.toDataURL(qr, { width: 300 });
    console.log('✅ QR code generated. Visit /api/qr');
});

waClient.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    qrCodeImage = null; // QR हटाओ अब जरूरत नहीं
});

waClient.initialize();

// ----- QR endpoint – बिल्कुल सरल HTML पेज -----
app.get('/api/qr', (req, res) => {
    if (!qrCodeImage) {
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;text-align:center;margin-top:50px;">
            <h2>⏳ QR कोड तैयार नहीं है</h2>
            <p>कृपया 10 सेकंड रुकें और पेज रिफ्रेश करें।</p>
            </body></html>
        `);
    }
    res.send(`
        <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;">
            <img src="${qrCodeImage}" style="width:280px;border-radius:16px;box-shadow:0 0 10px #00a884;">
        </body>
        </html>
    `);
});

// ----- WhatsApp send endpoint (multi-file) -----
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number missing' });
    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
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

// ----- 404 handler (सबसे नीचे) -----
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ VP Honda API running on port ${PORT}`));