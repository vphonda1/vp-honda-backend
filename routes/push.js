// routes/push.js
const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// ⚠️ आपकी अपनी VAPID keys
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Temporary in-memory store (production में डेटाबेस जोड़ें)
let subscriptions = [];

// ✅ POST /api/save-push-subscription
router.post('/save-push-subscription', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const exists = subscriptions.find(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push(sub);
    console.log(`✅ Subscription saved. Total: ${subscriptions.length}`);
  }
  res.json({ success: true });
});

// ✅ POST /api/test-push-notification
router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No subscriptions. Please allow notifications first.' });
  }
  const payload = JSON.stringify({
    title: '🔔 VP Honda',
    body: 'यह आपके मोबाइल पर पुश नोटिफिकेशन है। WhatsApp की तरह!',
    url: '/reminders',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
  });
  let successCount = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      successCount++;
    } catch (err) {
      console.error('Send failed:', err);
      if (err.statusCode === 410) {
        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    }
  }
  res.json({ message: `✅ Notifications sent to ${successCount} device(s)` });
});

// (Optional) डिबगिंग के लिए
router.get('/push-subscriptions', (req, res) => {
  res.json({ total: subscriptions.length, subscriptions });
});

module.exports = router;