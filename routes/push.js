// routes/push.js — VP Honda Push Notifications (MongoDB-backed, persistent)
const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');

const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ✅ MongoDB model — data persists across Render restarts
const PushSubscription = require('../models/PushSubscription');

// ── Helper: send to all subscribers ─────────────────────────────────────────
async function sendToAll(title, body, url, icon) {
  const subs = await PushSubscription.find().lean();
  console.log(`[Push] Sending to ${subs.length} subscribers: "${title}"`);
  if (!subs.length) return { sent: 0, removed: 0 };

  const payload = JSON.stringify({
    title,
    body,
    url:   url   || '/',
    icon:  icon  || '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
  });

  let sent = 0, removed = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Expired subscription — remove from DB
        await PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
        removed++;
        console.log('[Push] Removed expired subscription');
      } else {
        console.error('[Push] Send error:', err.statusCode, err.message);
      }
    }
  }
  console.log(`[Push] Done: ${sent} sent, ${removed} removed`);
  return { sent, removed };
}

// ── GET /api/push/vapid-public-key ──────────────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── POST /api/push/save-push-subscription ───────────────────────────────────
// Frontend calls this when user clicks "Allow Notifications"
router.post('/save-push-subscription', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub?.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    // Upsert — no duplicates
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.keys?.p256dh,
          auth:   sub.keys?.auth,
        },
      },
      { upsert: true, new: true }
    );
    const total = await PushSubscription.countDocuments();
    console.log(`[Push] ✅ Subscription saved. Total devices: ${total}`);
    res.status(201).json({ message: `✅ Saved. Total devices: ${total}` });
  } catch (err) {
    console.error('[Push] Save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/push/save-push-subscription ─────────────────────────────────
router.delete('/save-push-subscription', async (req, res) => {
  try {
    if (req.body?.endpoint) {
      await PushSubscription.deleteOne({ endpoint: req.body.endpoint });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/push/send-push ─────────────────────────────────────────────────
// Used by: chat messages, meeting invites, any manual notification
router.post('/send-push', async (req, res) => {
  try {
    const { title, body, url, icon } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const result = await sendToAll(title, body || '', url || '/', icon);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/push/test-push-notification ────────────────────────────────────
router.post('/test-push-notification', async (req, res) => {
  try {
    const count = await PushSubscription.countDocuments();
    if (count === 0) {
      return res.status(400).json({
        error: 'No devices registered. पहले Reminders page पर जाएं → "🔔 Allow Notifications" दबाएं।'
      });
    }
    const result = await sendToAll(
      '🔔 VP Honda — Test Notification',
      `WhatsApp जैसी notification! ${count} device${count > 1 ? 's' : ''} registered हैं।`,
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
    const total = await PushSubscription.countDocuments();
    res.json({ total, message: `${total} devices registered` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;