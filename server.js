// VP Honda Backend — server.js
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const webpush   = require('web-push');
require('dotenv').config();

const app = express();
app.use(cors({ origin:'*', methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization'] }));
app.use(express.json({ limit:'50mb' }));
app.use(express.urlencoded({ limit:'50mb', extended:true }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) { console.error('MongoDB URI not defined'); process.exit(1); }
mongoose.connect(mongoUri, { serverSelectionTimeoutMS:5000, socketTimeoutMS:45000 })
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => { console.error('MongoDB Error:', err.message); process.exit(1); });

// VAPID
const VAPID_PUBLIC  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC, VAPID_PRIVATE);

// PushSubscription Model — deviceId-based dedupe (1 device = 1 subscription)
const PushSubSchema = new mongoose.Schema({
  endpoint:  { type: String, required: true, unique: true },
  keys:      { p256dh: String, auth: String },
  deviceId:  { type: String, index: true },
  userAgent: { type: String },
  savedAt:   { type: Date, default: Date.now },
});
const PushSub = mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubSchema);

// sendToAll helper
async function sendToAll(title, body, url) {
  const subs = await PushSub.find().lean();
  console.log('[Push] Sending to', subs.length, 'devices:', title);
  const payload = JSON.stringify({ title, body, url: url || '/', icon:'/icons/icon-192x192.png', badge:'/icons/icon-96x96.png' });
  let sent = 0;
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, payload); sent++; }
    catch (err) { if (err.statusCode === 410 || err.statusCode === 404) await PushSub.deleteOne({ endpoint: sub.endpoint }).catch(()=>{}); }
  }
  return sent;
}

// ── PUSH ROUTES ────────────────────────────────────────────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC }));

app.post('/api/push/save-push-subscription', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid' });

    // ✅ FIX: अगर deviceId भेजा है, उसी device की पुरानी subscriptions delete करें
    // ताकि एक device = एक subscription हमेशा
    if (sub.deviceId) {
      await PushSub.deleteMany({
        deviceId: sub.deviceId,
        endpoint: { $ne: sub.endpoint }   // current endpoint को छोड़ कर
      }).catch(() => {});
    }

    await PushSub.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        endpoint:  sub.endpoint,
        keys:      { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth },
        deviceId:  sub.deviceId || '',
        userAgent: sub.userAgent || '',
      },
      { upsert: true, new: true }
    );
    const total = await PushSub.countDocuments();
    console.log('[Push] Saved. Total:', total);
    res.status(201).json({ ok: true, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ NEW: Cleanup stale subscriptions (test each, delete failures)
app.post('/api/push/cleanup', async (req, res) => {
  try {
    const subs = await PushSub.find().lean();
    let removed = 0;
    const payload = JSON.stringify({ title: '', body: '', silent: true });
    for (const sub of subs) {
      try { await webpush.sendNotification(sub, payload); }
      catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
          await PushSub.deleteOne({ endpoint: sub.endpoint }).catch(()=>{});
          removed++;
        }
      }
    }
    const total = await PushSub.countDocuments();
    res.json({ ok: true, removed, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/push/push-subscriptions', async (req, res) => {
  try { const total = await PushSub.countDocuments(); res.json({ total }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/push/test-push-notification', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    if (total === 0) return res.status(400).json({ error: 'No devices. Chat में "चालू करें" दबाएं।' });
    const sent = await sendToAll('🔔 VP Honda Test', 'Notifications working! ✅', '/chat');
    res.json({ ok: true, message: sent + ' devices को notification भेजी', sent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/push/send-push', async (req, res) => {
  try {
    const { title, body, url } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const sent = await sendToAll(title, body || '', url || '/');
    res.json({ ok: true, sent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── STATUS ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status:'ok', app:'VP Honda API v2', db: mongoose.connection.readyState===1?'connected':'disconnected' }));

// ── ALL OTHER ROUTES ───────────────────────────────────────────────────────────
app.use('/api/customers',        require('./routes/customers'));
app.use('/api/parts',            require('./routes/parts'));
app.use('/api/invoices',         require('./routes/invoices'));
app.use('/api/reminders',        require('./routes/reminders'));
app.use('/api/serviceCustomers', require('./routes/serviceCustomers'));
app.use('/api/dashboard',        require('./routes/dashboard'));
app.use('/api/staff',            require('./routes/staff'));
app.use('/api/oldbikes',         require('./routes/oldbikes'));
app.use('/api/quotations',       require('./routes/quotations'));
app.use('/api',                  require('./routes/dataImport'));
app.use('/api/service-data',     require('./routes/servicedata'));
app.use('/api/follow-ups',       require('./routes/followups'));
app.use('/api/attendance',       require('./routes/attendance'));
app.use('/api/salaries',         require('./routes/salaries'));
app.use('/api/salary-entities',  require('./routes/salaryEntities'));
app.use('/api/messages',         require('./routes/messages'));

// documents route (if file exists)
try { app.use('/api/documents', require('./routes/documents')); } catch(e) { console.warn('documents route not found'); }

// 404 handler
app.use((req, res) => res.status(404).json({ error:'Route not found', path: req.path }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('VP Honda API running on port', PORT));