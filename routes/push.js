// routes/push.js
const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// आपकी VAPID keys (जो आपने पहले जनरेट की थीं)
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails(
  'mailto:admin@vphonda.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

let subscriptions = [];

// ✅ सब्सक्रिप्शन सेव करने का एंडपॉइंट
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

// ✅ टेस्ट नोटिफिकेशन भेजने का एंडपॉइंट
router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No subscriptions. Click "Allow Notifications" first.' });
  }
  const payload = JSON.stringify({
    title: '🔔 VP Honda Test',
    body: 'यह आपके मोबाइल के नोटिफिकेशन बार में दिखना चाहिए!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    url: '/reminders',
  });
  let successCount = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      successCount++;
    } catch (err) {
      if (err.statusCode === 410) {
        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
        console.log('Expired subscription removed');
      }
    }
  }
  res.json({ message: `✅ ${successCount} notification(s) sent` });
});

// ✅ तुरंत रिमाइंडर भेजने का एंडपॉइंट (RemindersPage से कॉल होगा)
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
        tag: r.tag || 'reminder',
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
  res.json({ message: `✅ Sent ${successCount} immediate pushes` });
});

module.exports = router;