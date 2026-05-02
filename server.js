// server.js – Final working version with /api/qr
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

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) { console.error('MongoDB URI missing'); process.exit(1); }
mongoose.connect(mongoUri).then(() => console.log('✅ MongoDB Connected')).catch(err => { console.error(err); process.exit(1); });

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Your existing routes
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

// WhatsApp client
let chromePath = '/opt/render/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome';
if (!fs.existsSync(chromePath)) chromePath = null;

const waClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
        executablePath: chromePath || undefined
    }
});

waClient.on('qr', async (qr) => {
    const qrImage = await QRCode.toDataURL(qr);
    app.locals.qrCode = qrImage;
    console.log('✅ QR ready. Visit /api/qr');
});
waClient.on('ready', () => console.log('✅ WhatsApp ready'));
waClient.initialize();

// QR endpoint – exactly at /api/qr
app.get('/api/qr', (req, res) => {
    if (!app.locals.qrCode) return res.status(404).send('QR not yet generated, wait 10s');
    res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${app.locals.qrCode}" style="width:300px;"></body></html>`);
});

app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone missing' });
    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
    try {
        await waClient.sendMessage(chatId, caption);
        for (const file of req.files) {
            const media = new MessageMedia(file.mimetype, file.buffer.toString('base64'), file.originalname);
            await waClient.sendMessage(chatId, media);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 404 must be below all routes
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ API running on port ${PORT}`));