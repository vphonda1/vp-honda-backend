// routes/push.js
const express = require('express');
const router = express.Router();
const webpush = require('web-push');

// ⚠️ आपकी VAPID keys – यहाँ सही से डालें (आपने पहले जनरेट की थीं)
const VAPID_PUBLIC_KEY = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';

webpush.setVapidDetails(
  'mailto:admin@vphonda.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Temporary in-memory storage (for development only)
// ⚠️ Production में इसे real database (MongoDB) से बदलें
let subscriptions = [];

// POST /api/save-push-subscription – frontend से subscription सेव करने के लिए
router.post('/save-push-subscription', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  // Check if already exists
  const exists = subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    console.log(`✅ New push subscription saved. Total: ${subscriptions.length}`);
  }
  res.status(201).json({ message: 'Subscription saved successfully' });
});

// POST /api/test-push-notification – test notification भेजने के लिए
router.post('/test-push-notification', async (req, res) => {
  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No subscriptions found. Please allow notifications first.' });
  }
  const payload = JSON.stringify({
    title: '🔔 VP Honda Test',
    body: 'यह आपके मोबाइल पर पुश नोटिफिकेशन है। WhatsApp की तरह काम कर रहा है!',
    url: '/reminders'
  });
  let success = 0;
  for (let sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      success++;
    } catch (err) {
      if (err.statusCode === 410) {
        // Remove expired subscription
        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
      }
    }
  }
  res.json({ message: `✅ ${success} devices को notification भेजी` });
});

// GET /api/push-subscriptions – (optional) to see all subs (debug only)
router.get('/push-subscriptions', (req, res) => {
  res.json({ total: subscriptions.length, subscriptions });
});

module.exports = router;