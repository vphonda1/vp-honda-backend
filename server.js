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

// ✅ Cron से call: SMART rules से top reminders individual pushes + 1 summary
// Rules: Payment=overdue, Service=±5d, Insurance=30d→-60d, RTO=7d
app.post('/api/push/send-reminder-summary', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    if (total === 0) return res.status(400).json({ error: 'No devices subscribed' });

    // Fetch reminders internally
    let reminders = [];
    try {
      const port = process.env.PORT || 5000;
      const remRes = await fetch(`http://localhost:${port}/api/reminders`);
      if (remRes.ok) reminders = await remRes.json();
    } catch (e) {
      console.warn('[Cron] internal fetch /api/reminders failed:', e.message);
    }

    if (!Array.isArray(reminders) || reminders.length === 0) {
      const sent = await sendToAll('🔔 VP Honda Reminders', 'Open app to view reminders', '/reminders');
      return res.json({ ok: true, sent, mode: 'fallback-generic' });
    }

    // ✅ SMART FILTER: category-specific time windows
    const shouldNotify = (r) => {
      const d = r.daysRemaining || 0;
      const type = (r.type || '').toLowerCase();
      if (type === 'payment')                                     return d < 0;            // overdue only
      if (type === 'service')                                     return d >= -7 && d <= 5;  // ±5d to 7d overdue
      if (type === 'insurance' || type === 'insurance-renewal')   return d >= -60 && d <= 30; // 30d ahead to 60d expired
      if (type === 'rto')                                         return d >= -30 && d <= 7;  // 7d ahead
      return d >= -7 && d <= 3;                                                // default narrow window
    };

    const filtered = reminders.filter(shouldNotify);

    // Agar filter ke baad bhi kuch nahi, generic push
    if (filtered.length === 0) {
      const sent = await sendToAll('✅ VP Honda', 'आज कोई urgent reminder नहीं — सब clear!', '/reminders');
      return res.json({ ok: true, sent, mode: 'all-clear', totalReminders: reminders.length });
    }

    // Priority sort: overdue first (most days), then by type weight
    const typePri = { payment: 3, service: 2, 'insurance-renewal': 1, insurance: 1, rto: 2 };
    const sorted = [...filtered].sort((a, b) => {
      const aOver = (a.daysRemaining || 0) < 0;
      const bOver = (b.daysRemaining || 0) < 0;
      if (aOver !== bOver) return aOver ? -1 : 1;
      const aDays = Math.abs(a.daysRemaining || 0);
      const bDays = Math.abs(b.daysRemaining || 0);
      if (aDays !== bDays) return bDays - aDays;
      return (typePri[b.type] || 0) - (typePri[a.type] || 0);
    });

    const top = sorted.slice(0, 5);
    const overdueCount = filtered.filter(r => (r.daysRemaining || 0) < 0).length;
    const upcomingCount = filtered.length - overdueCount;
    let pushCount = 0;

    // 1. Summary push
    const summaryBody = `🚨 ${overdueCount} overdue · ⏰ ${upcomingCount} upcoming\n📋 ${filtered.length} urgent (of ${reminders.length} total)`;
    pushCount += await sendToAll('🔔 VP Honda Reminders', summaryBody, '/reminders');

    // 2. Top 5 individual
    for (const r of top) {
      const days    = Math.abs(r.daysRemaining || 0);
      const overdue = (r.daysRemaining || 0) < 0;
      const icon    = overdue ? '🚨' : '⏰';
      const vehicle = r.vehicleModel || r.vehicle || '';
      const regNo   = r.regNo ? ` (${r.regNo})` : '';
      const phone   = r.customerPhone || r.phone || '';
      const title   = `${icon} ${r.customerName} — ${r.title || r.type}`;
      const body    = `${vehicle}${regNo} — ${days}d ${overdue ? 'overdue' : 'remaining'}\n📞 ${phone}`;
      pushCount += await sendToAll(title, body, '/reminders');
      await new Promise(res => setTimeout(res, 500));
    }

    res.json({
      ok: true, sent: pushCount,
      totalReminders: reminders.length,
      filteredUrgent: filtered.length,
      top5Sent: top.length,
      breakdown: { overdue: overdueCount, upcoming: upcomingCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
