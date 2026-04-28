// routes/messages.js — VP Honda Team Chat API (with Push Notifications)
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const PushSubscription = require('../models/PushSubscription');
const webpush = require('web-push');

// VAPID Keys (आपकी दी हुई keys)
const vapidKeys = {
  publicKey: 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM',
  privateKey: 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI'
};

webpush.setVapidDetails(
  'mailto:admin@vphonda.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ────────────── Helper: Send push to all subscribers ──────────────
async function sendPushToAll(title, body, targetUrl) {
  const subscriptions = await PushSubscription.find();
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({ title, body, url: targetUrl });
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410) {
        // Subscription expired, remove from DB
        await PushSubscription.deleteOne({ endpoint: sub.endpoint });
      } else {
        console.error('Push send error:', err);
      }
    }
  }
}

// ────────────── GET /api/messages/:room ──────────────
router.get('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const since = req.query.since;

    const query = { room, deleted: { $ne: true } };
    if (since) query.createdAt = { $gt: new Date(since) };

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────── POST /api/messages/:room ──────────────
router.post('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const { sender, senderRole, text, photo, replyTo } = req.body;

    if (!sender || (!text && !photo)) {
      return res.status(400).json({ error: 'sender and text/photo required' });
    }

    const msg = new Message({ room, sender, senderRole, text, photo, replyTo });
    await msg.save();

    // ──────── PUSH NOTIFICATION (दूसरों को सूचित करें) ────────
    // केवल तभी भेजें जब message में टेक्स्ट या फोटो हो
    if (msg.text || msg.photo) {
      const title = sender;
      const body = msg.text ? msg.text : '📷 नई फोटो';
      const targetUrl = 'https://vp-honda-frontend.vercel.app/team-chat'; // अपना फ्रंटएंड URL
      // असिंक्रोनस रूप से भेजें, रिस्पॉन्स ब्लॉक न हो
      sendPushToAll(title, body, targetUrl).catch(console.error);
    }

    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────── DELETE /api/messages/:room/:id ──────────────
router.delete('/:room/:id', async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { deleted: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────── GET unread count ──────────────
router.get('/:room/unread/:user', async (req, res) => {
  try {
    const count = await Message.countDocuments({
      room: req.params.room,
      sender: { $ne: req.params.user },
      readBy: { $nin: [req.params.user] },
      deleted: { $ne: true },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────── PATCH mark as read ──────────────
router.patch('/:room/read/:user', async (req, res) => {
  try {
    await Message.updateMany(
      { room: req.params.room, sender: { $ne: req.params.user }, readBy: { $nin: [req.params.user] } },
      { $addToSet: { readBy: req.params.user } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────── NEW: POST /api/save-push-subscription ──────────────
// यह endpoint frontend से subscription save करने के लिए है
router.post('/save-push-subscription', async (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    // Check if already exists
    const existing = await PushSubscription.findOne({ endpoint: subscription.endpoint });
    if (!existing) {
      await PushSubscription.create(subscription);
    }
    res.status(201).json({ message: 'Subscription saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;