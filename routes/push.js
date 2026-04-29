// routes/push.js – पूरी फ़ाइल (replace करें)
const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// आपकी VAPID keys
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subscriptions = [];

// Endpoint to save subscription
router.post('/save-push-subscription', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid' });
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    console.log('✅ Subscription saved, total:', subscriptions.length);
  }
  res.json({ ok: true });
});

// ✅ NEW - Send immediate push for multiple reminders
router.post('/send-immediate-reminders', async (req, res) => {
  const { reminders } = req.body;
  if (!reminders || reminders.length === 0) {
    return res.status(400).json({ error: 'No reminders' });
  }
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No active subscriptions. Click "Allow Notifications" first.' });
  }

  let successCount = 0;
  for (const sub of subscriptions) {
    for (const r of reminders) {
      const payload = JSON.stringify({
        title: r.title,
        body: r.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: r.url || '/reminders',
        tag: r.tag,
        vibrate: [200, 100, 200]
      });
      try {
        await webpush.sendNotification(sub, payload);
        successCount++;
      } catch (err) {
        if (err.statusCode === 410) {
          subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
        }
      }
    }
  }
  res.json({ message: `✅ Sent ${successCount} push notifications` });
});

// Test endpoint
router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) return res.status(400).json({ error: 'No subscriptions' });
  const payload = JSON.stringify({ title: 'Test', body: 'Manual test', url: '/reminders' });
  let count = 0;
  for (let sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      count++;
    } catch (err) {
      if (err.statusCode === 410) subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
    }
  }
  res.json({ message: `Sent to ${count} devices` });
});

module.exports = router;