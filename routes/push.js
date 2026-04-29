// routes/push.js
const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// आपकी VAPID keys (बिल्कुल सही)
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subscriptions = [];

// ----- Save subscription -----
router.post('/save-push-subscription', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    console.log(`✅ Subscription saved. Total: ${subscriptions.length}`);
  }
  res.json({ ok: true });
});

// ----- Test notification (manual) -----
router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) return res.status(400).json({ error: 'No subscriptions' });
  const payload = JSON.stringify({ title: '🔔 Test', body: 'यह आपके मोबाइल पर दिखना चाहिए', url: '/reminders' });
  let success = 0;
  for (let sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      success++;
    } catch (err) {
      if (err.statusCode === 410) subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
    }
  }
  res.json({ message: `✅ ${success} subscribers notified` });
});

// ----- Send immediate reminders (called from RemindersPage) -----
router.post('/send-immediate-reminders', async (req, res) => {
  const { reminders } = req.body;
  if (!reminders || reminders.length === 0) return res.status(400).json({ error: 'No reminders' });
  if (subscriptions.length === 0) return res.status(400).json({ error: 'No subscriptions' });
  let total = 0;
  for (let sub of subscriptions) {
    for (let r of reminders) {
      const payload = JSON.stringify({
        title: r.title,
        body: r.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        url: r.url || '/reminders'
      });
      try {
        await webpush.sendNotification(sub, payload);
        total++;
      } catch (err) {
        if (err.statusCode === 410) subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    }
  }
  res.json({ message: `✅ Sent ${total} pushes` });
});

module.exports = router;