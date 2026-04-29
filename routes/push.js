const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// आपकी VAPID keys (सही हैं)
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let subscriptions = [];

router.post('/save-push-subscription', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid' });
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    console.log('✅ Push subscription saved, total:', subscriptions.length);
  }
  res.json({ ok: true });
});

router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No subscriptions. Click "Allow Notifications" first.' });
  }
  const payload = JSON.stringify({
    title: '🔔 VP Honda',
    body: 'यह आपके मोबाइल नोटिफिकेशन बार में दिखना चाहिए!',
    url: '/reminders',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png'
  });
  let success = 0;
  for (let sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      success++;
    } catch (err) {
      if (err.statusCode === 410) {
        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    }
  }
  res.json({ message: `✅ ${success} notification(s) sent` });
});

module.exports = router;