
// routes/push.js — VP Honda Push Notifications (MongoDB-backed)
const express = require('express');
const router  = express.Router();
const webpush = require('web-push');

const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Load PushSubscription model (MongoDB-backed)
let PushSubscription;
try {
  PushSubscription = require('../models/PushSubscription');
} catch {
  console.warn('[Push] PushSubscription model not found');
}

// ── Helper: send push to all subscribers ────────────────────────────────────
async function sendToAll(title, body, url = '/') {
  if (!PushSubscription) return { sent: 0, removed: 0 };
  const subs = await PushSubscription.find().lean();
  let sent = 0, removed = 0;
  const payload = JSON.stringify({
    title, body, url,
    icon:  '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
        removed++;
      }
    }
  }
  return { sent, removed };
}

// ── GET /api/push/vapid-public-key ──────────────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── POST /api/push/save-push-subscription ───────────────────────────────────
// Frontend (TeamChat, RemindersPage) calls this to register device
router.post('/save-push-subscription', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

    if (PushSubscription) {
      await PushSubscription.findOneAndUpdate(
        { endpoint: sub.endpoint },
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
        { upsert: true, new: true }
      );
      const total = await PushSubscription.countDocuments();
      console.log(`[Push] Subscription saved. Total devices: ${total}`);
    }
    res.status(201).json({ message: '✅ Subscription saved' });
  } catch (err) {
    console.error('[Push] save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/push/save-push-subscription ─────────────────────────────────
router.delete('/save-push-subscription', async (req, res) => {
  try {
    if (PushSubscription && req.body?.endpoint) {
      await PushSubscription.deleteOne({ endpoint: req.body.endpoint });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/push/send-push ─────────────────────────────────────────────────
// Send notification to ALL devices (used by: chat messages, meeting invites, reminders)
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

// ── POST /api/push/test-push-notification ────────────────────────────────────
// Test notification from RemindersPage
router.post('/test-push-notification', async (req, res) => {
  try {
    if (!PushSubscription) return res.status(503).json({ error: 'Push not configured' });
    const count = await PushSubscription.countDocuments();
    if (count === 0) return res.status(400).json({ error: 'No subscriptions — पहले notifications allow करें' });
    const result = await sendToAll(
      '🔔 VP Honda — Test Notification',
      'यह test है! WhatsApp की तरह काम कर रहा है। Reminder notifications अब आएंगी।',
      '/reminders'
    );
    res.json({ message: `✅ ${result.sent} devices को notification भेजी`, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/push/push-subscriptions ─────────────────────────────────────────
router.get('/push-subscriptions', async (req, res) => {
  try {
    const count = PushSubscription ? await PushSubscription.countDocuments() : 0;
    res.json({ total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;