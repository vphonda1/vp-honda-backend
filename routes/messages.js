// routes/messages.js — VP Honda Team Chat (Push Notifications - All Bugs Fixed)
const express  = require('express');
const router   = express.Router();
const Message  = require('../models/Message');
const webpush  = require('web-push');

const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let PushSubscription;
try { PushSubscription = require('../models/PushSubscription'); } catch { console.warn('[Messages] PushSubscription model missing'); }

async function sendPushToAll(title, body, url) {
  if (!PushSubscription) return;
  try {
    const subs    = await PushSubscription.find().lean();
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body, url: url || '/chat', icon:'/icons/icon-192x192.png', badge:'/icons/icon-96x96.png' });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        }
      }
    }
  } catch (e) { console.error('[Push]', e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ⚠️ SPECIFIC routes FIRST — before /:room wildcard
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/messages/save-subscription — Save push subscription
router.post('/save-subscription', async (req, res) => {
  try {
    if (!PushSubscription) return res.status(503).json({ error: 'Push not available' });
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Saved ✅' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/messages/save-subscription — Remove subscription (disable notifs)
router.delete('/save-subscription', async (req, res) => {
  try {
    if (PushSubscription && req.body?.endpoint) {
      await PushSubscription.deleteOne({ endpoint: req.body.endpoint });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/messages/vapid-public-key
router.get('/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

// ══════════════════════════════════════════════════════════════════════════════
// WILDCARD routes — after specific routes
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/messages/:room
router.get('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const query = { room, deleted: { $ne: true } };
    if (req.query.after) query._id       = { $gt: req.query.after };
    if (req.query.since) query.createdAt = { $gt: new Date(req.query.since) };
    const messages = await Message.find(query).sort({ createdAt: 1 }).limit(limit).lean();
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/messages/:room — Send message + push notification
router.post('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const { sender, senderRole, text, photo, replyTo } = req.body;
    if (!sender || (!text && !photo)) return res.status(400).json({ error: 'sender and text/photo required' });
    const msg = new Message({ room, sender, senderRole, text, photo, replyTo });
    await msg.save();
    // Send push (non-blocking)
    if (text || photo) {
      const roomLabel = room.startsWith('group_') ? `📢 ${room.replace('group_', '').toUpperCase()}` : '💬 Direct Message';
      sendPushToAll(`${sender} — ${roomLabel}`, text || '📷 Photo भेजी', '/chat').catch(() => {});
    }
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/messages/:room/:id
router.delete('/:room/:id', async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { deleted: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/messages/:room/unread/:user
router.get('/:room/unread/:user', async (req, res) => {
  try {
    const count = await Message.countDocuments({ room: req.params.room, sender: { $ne: req.params.user }, readBy: { $nin: [req.params.user] }, deleted: { $ne: true } });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/messages/:room/read/:user
router.patch('/:room/read/:user', async (req, res) => {
  try {
    await Message.updateMany({ room: req.params.room, sender: { $ne: req.params.user }, readBy: { $nin: [req.params.user] } }, { $addToSet: { readBy: req.params.user } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;