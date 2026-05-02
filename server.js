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

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (mongoUri) {
    mongoose.connect(mongoUri)
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.error('❌ MongoDB Error:', err));
} else {
    console.warn('⚠️ MongoDB URI not found');
}

// Root Route
app.get('/', (req, res) => res.json({ status: 'ok', message: 'VP Honda Backend Running' }));

// ====================== ALL YOUR ROUTES ======================
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
    try {
        qrImageDataURL = await QRCode.toDataURL(qr, { width: 300 });
        console.log('✅ QR Code Generated Successfully');
    } catch (e) {
        console.error('QR Generation Error:', e);
    }
});

waClient.on('ready', () => console.log('✅ WhatsApp Client is Ready'));
waClient.on('authenticated', () => console.log('✅ WhatsApp Authenticated'));

waClient.initialize();

// ====================== DEBUG ROUTE ======================
app.get('/api/debug-routes', (req, res) => {
    const routes = [];
    const seen = new Set();

    function print(path, layer) {
        if (layer.route) {
            const method = Object.keys(layer.route.methods)[0].toUpperCase();
            const fullPath = path + layer.route.path;
            if (!seen.has(fullPath)) {
                seen.add(fullPath);
                routes.push({ method, path: fullPath });
            }
        } else if (layer.name === 'router' && layer.handle.stack) {
            layer.handle.stack.forEach(stackItem => {
                print(path, stackItem);
            });
        }
    }

    if (app._router && app._router.stack) {
        app._router.stack.forEach(middleware => {
            print('', middleware);
        });
    }

    res.json({
        message: "All Registered Routes",
        total: routes.length,
        routes: routes.sort((a, b) => a.path.localeCompare(b.path))
    });
});

// ====================== QR ROUTE ======================
app.get('/api/qr', (req, res) => {
    console.log('📍 /api/qr route was accessed');
    if (!qrImageDataURL) {
        return res.status(404).json({
            error: 'QR not ready',
            message: 'Please wait 15-20 seconds and refresh'
        });
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>WhatsApp QR - VP Honda</title>
        </head>
        <body style="margin:0; background:#111; color:white; font-family:Arial; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh;">
            <h2>Scan WhatsApp QR Code</h2>
            <img src="${qrImageDataURL}" style="width:280px; border-radius:15px; box-shadow:0 0 20px #0f0;">
            <p style="margin-top:20px;">Scan this code from your WhatsApp mobile app</p>
        </body>
        </html>
    `);
});

// ====================== SEND WHATSAPP ======================
app.post('/api/send-whatsapp-multi', upload.array('files'), async (req, res) => {
    const { phoneNumber, caption } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

    try {
        if (caption) await waClient.sendMessage(chatId, caption);
        
        for (const file of req.files || []) {
            const media = new MessageMedia(file.mimetype, file.buffer.toString('base64'), file.originalname);
            await waClient.sendMessage(chatId, media);
        }
        res.json({ success: true, message: 'Message sent' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ====================== 404 HANDLER (LAST) ======================
app.use((req, res) => {
    console.log(`❌ 404 - ${req.method} ${req.path}`);
    res.status(404).json({ 
        error: 'Route not found', 
        path: req.path 
    });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔍 Debug Routes: /api/debug-routes`);
    console.log(`📱 QR Code: /api/qr`);
});