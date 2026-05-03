const express = require('express');
const router  = express.Router();
const webpush = require('web-push');
const mongoose = require('mongoose');

// VAPID Keys
const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ✅ MongoDB Schema — persistent across all server restarts
const PushSubSchema = new mongoose.Schema({
  endpoint:  { type: String, required: true, unique: true },
  keys:      { p256dh: String, auth: String },
  createdAt: { type: Date, default: Date.now },
});
const PushSub = mongoose.models.PushSubscription || mongoose.model('PushSubscription', PushSubSchema);

// Helper: send push to all saved devices
async function sendToAll(title, body, url) {
  const subs = await PushSub.find().lean();
  console.log(`[Push] Sending "${title}" to ${subs.length} devices`);
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
  console.log(`[Push] Sent:${sent} Removed:${removed}`);
  return { sent, removed };
}

// Save subscription (called when user clicks Allow)
router.post('/save-push-subscription', async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    await PushSub.findOneAndUpdate(
      { endpoint },
      { endpoint, keys },
      { upsert: true, new: true }
    );
    const total = await PushSub.countDocuments();
    console.log(`[Push] ✅ Device saved. Total: ${total}`);
    res.json({ ok: true, total });
  } catch (err) {
    console.error('[Push] Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Remove subscription
router.delete('/save-push-subscription', async (req, res) => {
  try {
    if (req.body?.endpoint) await PushSub.deleteOne({ endpoint: req.body.endpoint });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send push to ALL devices (used by chat, reminders, meeting)
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

// Test notification
router.post('/test-push-notification', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    if (total === 0) return res.status(400).json({ error: 'No devices registered. Allow notifications first.' });
    const result = await sendToAll('🔔 VP Honda Test', `${total} device${total>1?'s':''} registered! Notifications working ✅`, '/reminders');
    res.json({ ok: true, message: `${result.sent} devices को notification भेजी`, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// VAPID public key
router.get('/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

// Count devices
router.get('/push-subscriptions', async (req, res) => {
  try {
    const total = await PushSub.countDocuments();
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, sendToAll };