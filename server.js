// VP Honda Backend — server.js
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');
const path      = require('path');
const webpush   = require('web-push');
const paymentTracker  = require('./routes/paymentTracker');
const paymentReceipts = require('./routes/paymentReceipts');
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

// ✅ BULLETPROOF: Direct Customer query (no internal fetch) + smart filter + top 5 pushes
app.post('/api/push/send-reminder-summary', async (req, res) => {
  console.log('[Cron] 🔔 send-reminder-summary called at', new Date().toISOString());
  try {
    const total = await PushSub.countDocuments();
    console.log(`[Cron] Push subscriptions: ${total}`);
    if (total === 0) return res.status(400).json({ error: 'No devices subscribed' });

    // ── Direct Customer query (NO internal fetch) ──
    // Try multiple naming conventions
    const Customer = mongoose.models.Customer
                  || mongoose.models.customer
                  || mongoose.models.Customers
                  || mongoose.models.customers;
    if (!Customer) {
      const available = Object.keys(mongoose.models).join(', ');
      console.warn('[Cron] ❌ Customer model not found. Available models:', available);
      return res.status(500).json({
        error: 'Customer model not found in mongoose',
        availableModels: Object.keys(mongoose.models),
        hint: 'Check model name in your code - share with developer',
      });
    }

    const customers = await Customer.find({}).lean();
    console.log(`[Cron] Loaded ${customers.length} customers from DB`);

    // ── Compute reminders inline ──
    const today    = new Date(); today.setHours(0,0,0,0);
    const todayMs  = today.getTime();
    const dayMs    = 24 * 60 * 60 * 1000;
    const reminders = [];

    for (const c of customers) {
      const name    = c.name || c.customerName || 'Unknown';
      const phone   = c.phone || c.mobile || (c.linkedVehicle && c.linkedVehicle.phone) || '';
      const v       = c.linkedVehicle || c;
      const vehicle = v.vehicleModel || v.model || c.vehicleModel || '';
      const regNo   = v.regNo || v.registrationNo || c.regNo || '';

      // Payment overdue
      const due = +(c.paymentDue || c.balanceAmount || c.balance || 0);
      if (due > 0) {
        reminders.push({ customerName: name, phone, vehicleModel: vehicle, regNo, type: 'payment', title: '💳 Payment Due', daysRemaining: -30, amount: due });
      }

      // Insurance expired/expiring
      const insRaw = c.insuranceDate || v.insuranceDate;
      if (insRaw) {
        const ins  = new Date(insRaw); ins.setHours(0,0,0,0);
        const days = Math.floor((ins.getTime() - todayMs) / dayMs);
        if (days >= -60 && days <= 30) {
          reminders.push({ customerName: name, phone, vehicleModel: vehicle, regNo, type: 'insurance', title: days < 0 ? '🛡️ Insurance Expired' : '🛡️ Insurance Expiring', daysRemaining: days });
        }
      }

      // Service due (basic check via purchaseDate + 90/180/270/365 days)
      const purRaw = v.purchaseDate || c.purchaseDate;
      if (purRaw) {
        const pur = new Date(purRaw); pur.setHours(0,0,0,0);
        const svc = c.serviceData || c.services || {};
        const checks = [
          { key: 'service1DoneDate', label: '1st Service Due', dueDays: 30 },
          { key: 'service2DoneDate', label: '2nd Service Due', dueDays: 90 },
          { key: 'service3DoneDate', label: '3rd Service Due', dueDays: 180 },
          { key: 'service4DoneDate', label: '4th Service Due', dueDays: 270 },
        ];
        for (const ch of checks) {
          if (svc[ch.key]) continue; // already done
          const dueDate = pur.getTime() + ch.dueDays * dayMs;
          const days = Math.floor((dueDate - todayMs) / dayMs);
          if (days >= -7 && days <= 5) {
            reminders.push({ customerName: name, phone, vehicleModel: vehicle, regNo, type: 'service', title: `🔧 ${ch.label}`, daysRemaining: days });
            break; // only one service reminder per customer
          }
        }
      }
    }

    console.log(`[Cron] Computed ${reminders.length} urgent reminders`);

    if (reminders.length === 0) {
      const sent = await sendToAll('✅ VP Honda', 'आज कोई urgent reminder नहीं — सब clear!', '/reminders');
      return res.json({ ok: true, sent, mode: 'all-clear', customers: customers.length });
    }

    // Priority sort: overdue first (most days), then by type
    const typePri = { payment: 3, service: 2, insurance: 1 };
    reminders.sort((a, b) => {
      const aOver = a.daysRemaining < 0;
      const bOver = b.daysRemaining < 0;
      if (aOver !== bOver) return aOver ? -1 : 1;
      const aDays = Math.abs(a.daysRemaining);
      const bDays = Math.abs(b.daysRemaining);
      if (aDays !== bDays) return bDays - aDays;
      return (typePri[b.type] || 0) - (typePri[a.type] || 0);
    });

    const top          = reminders.slice(0, 5);
    const overdueCount = reminders.filter(r => r.daysRemaining < 0).length;
    const upcomingCount= reminders.length - overdueCount;
    let pushCount      = 0;

    // 1. Summary push
    const summaryBody = `🚨 ${overdueCount} overdue · ⏰ ${upcomingCount} upcoming\n📋 ${reminders.length} urgent reminders आज`;
    pushCount += await sendToAll('🔔 VP Honda Reminders', summaryBody, '/reminders');

    // 2. Top 5 individual — हर एक में unique URL with reminder ID
    for (const r of top) {
      const days    = Math.abs(r.daysRemaining);
      const overdue = r.daysRemaining < 0;
      const icon    = overdue ? '🚨' : '⏰';
      const regTxt  = r.regNo ? ` (${r.regNo})` : '';
      const title   = `${icon} ${r.customerName} — ${r.title}`;
      const body    = `${r.vehicleModel || ''}${regTxt} — ${days}d ${overdue ? 'overdue' : 'remaining'}\n📞 ${r.phone || ''}`;
      // ✅ Unique URL per reminder — phone पर click करने पर सीधे यही reminder open होगा
      const phoneClean = (r.phone || '').replace(/[^0-9]/g, '').slice(0, 10);
      const reminderUrl = `/reminders?focus=${encodeURIComponent(r.customerName)}&phone=${phoneClean}&type=${r.type}`;
      pushCount += await sendToAll(title, body, reminderUrl);
      await new Promise(rs => setTimeout(rs, 500));
    }

    console.log(`[Cron] ✅ Sent ${pushCount} pushes successfully`);
    res.json({
      ok: true, sent: pushCount,
      customers: customers.length,
      totalReminders: reminders.length,
      top5Sent: top.length,
      breakdown: { overdue: overdueCount, upcoming: upcomingCount },
    });
  } catch (err) {
    console.error('[Cron] ❌ Error:', err.message, err.stack);
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
app.use('/api/payment-tracker',  paymentTracker);
app.use('/api/payment-receipts', paymentReceipts);
app.use('/api/staff-modules',    require('./routes/staffModules'));
app.use('/api/documents',        require('./routes/documents'));    // ✅ DocumentVault

// ── DB Cleanup (admin only) ───────────────────────────────────────────────
app.post('/api/admin/cleanup', async (req, res) => {
  try {
    const results = {};
    const db = mongoose.connection.db;
    // Delete old notification logs (older than 7 days)
    const cutoff = new Date(Date.now() - 7*24*60*60*1000);
    const notifCol = db.collection('notificationlogs');
    const r1 = await notifCol.deleteMany({ updatedAt: { $lt: cutoff } });
    results.notifLogs = r1.deletedCount;
    // Delete old SMS logs
    try { const r2 = await db.collection('smslogs').deleteMany({ createdAt: { $lt: cutoff } }); results.smsLogs = r2.deletedCount; } catch {}
    // Delete old appnotifications
    try { const r3 = await db.collection('appnotifications').deleteMany({ createdAt: { $lt: cutoff } }); results.appNotifs = r3.deletedCount; } catch {}
    // Stats
    const stats = await db.stats();
    const usedMB = Math.round(stats.dataSize / 1024 / 1024);
    res.json({ ok: true, deleted: results, dbSizeMB: usedMB });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error:'Route not found', path: req.path }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('VP Honda API running on port', PORT));
