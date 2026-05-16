// routes/push.js — VP Honda Push Notifications
const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');
const mongoose = require('mongoose');

const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const PushSubSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys:     { p256dh: String, auth: String },
  createdAt:{ type: Date, default: Date.now },
});
const PushSub = mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubSchema);

async function sendToAll(title, body, url) {
  const subs = await PushSub.find().lean();
  console.log('[Push] Sending to', subs.length, 'devices:', title);
  const payload = JSON.stringify({ title, body, url: url || '/', icon: '/icons/icon-192x192.png', badge: '/icons/icon-96x96.png' });
  let sent = 0, removed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await PushSub.deleteOne({ endpoint: sub.endpoint });
        removed++;
      }
    }
  }
  console.log('[Push] Done: sent=' + sent + ' removed=' + removed);
  return { sent, removed };
}

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/push/save-push-subscription
router.post('/save-push-subscription', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    await PushSub.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
      { upsert: true, new: true }
    );
    const total = await PushSub.countDocuments();
    console.log('[Push] Subscription saved. Total devices:', total);
    res.status(201).json({ ok: true, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/push/save-push-subscription
router.delete('/save-push-subscription', async (req, res) => {
  try {
    if (req.body?.endpoint) await PushSub.deleteOne({ endpoint: req.body.endpoint });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/send-push
router.post('/send-push', async (req, res) => {
  try {
    const { title, body, url } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = await sendToAll(title, body || '', url || '/');
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/test-push-notification
router.post('/test-push-notification', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    if (total === 0) {
      return res.status(400).json({ error: 'No devices. पहले notifications allow करें।' });
    }
    const result = await sendToAll(
      '🔔 VP Honda — Test Notification',
      'Notifications working! Chat messages अब आएंगे।',
      '/chat'
    );
    res.json({ ok: true, message: result.sent + ' devices को notification भेजी', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/push/push-subscriptions
router.get('/push-subscriptions', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.sendToAll = sendToAll;