// routes/messages.js — VP Honda Team Chat (WhatsApp features + push notif)
const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');
const Message  = require('../models/Message');
const webpush  = require('web-push');

const VAPID_PUBLIC_KEY  = 'BKwecIw_aOdebFYVONRm-ZF3au68bNWU1uHPSXkwr1LvV7dIS-b-v614SMT6UgjHbcqigskmSAhFBWHxV9a__TM';
const VAPID_PRIVATE_KEY = 'BphjFle5WwJGYAMWYMIF2bFT1BypFyCmT35JFXsGYYI';
webpush.setVapidDetails('mailto:admin@vphonda.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let PushSubscription;
try { PushSubscription = require('../models/PushSubscription'); } catch { console.warn('[Messages] PushSubscription model missing'); }

// Send push to all EXCEPT sender's device (avoid self-notify)
async function sendPushToAll(title, body, url, excludeEndpoint) {
  if (!PushSubscription) return;
  try {
    const subs = await PushSubscription.find().lean();
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body, url: url || '/chat', icon:'/icons/icon-192x192.png', badge:'/icons/icon-96x96.png' });
    for (const sub of subs) {
      if (excludeEndpoint && sub.endpoint === excludeEndpoint) continue;
      try { await webpush.sendNotification(sub, payload); }
      catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        }
      }
    }
  } catch (e) { console.error('[Push]', e.message); }
}

// ── SPECIFIC routes FIRST ────────────────────────────────────────────────────
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

router.delete('/save-subscription', async (req, res) => {
  try {
    if (PushSubscription && req.body?.endpoint) {
      await PushSubscription.deleteOne({ endpoint: req.body.endpoint });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/vapid-public-key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

// ✅ GET starred messages for a user (MUST be before /:room wildcard)
router.get('/starred/:user', async (req, res) => {
  try {
    const msgs = await Message.find({ starredBy: req.params.user, deleted: { $ne: true } })
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ Search messages (MUST be before /:room wildcard)
router.get('/search/:user', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const msgs = await Message.find({
      text: { $regex: q, $options: 'i' },
      deleted: { $ne: true },
    }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WILDCARD routes ─────────────────────────────────────────────────────────

// GET messages
router.get('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const query = { room, deleted: { $ne: true } };
    // ✅ FIX: 'after' string को ObjectId में convert करें (वरना नए messages live नहीं आते)
    if (req.query.after) {
      try { query._id = { $gt: new mongoose.Types.ObjectId(req.query.after) }; }
      catch { /* invalid id — ignore filter, return all */ }
    }
    if (req.query.since) query.createdAt = { $gt: new Date(req.query.since) };
    const messages = await Message.find(query).sort({ createdAt: 1 }).limit(limit).lean();
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST message — ✅ FIXED: accept all WhatsApp-style fields
router.post('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const {
      sender, senderRole, text,
      fileType, fileData, fileName, fileSize, duration, location,
      photo, forwarded,  // legacy + forward flag
      replyTo, senderEndpoint,
    } = req.body;
    if (!sender) return res.status(400).json({ error: 'sender required' });
    if (!text && !fileData && !photo && !location) return res.status(400).json({ error: 'message content required' });

    const msg = new Message({
      room, sender, senderRole: senderRole || 'staff', text: text || '',
      fileType: fileType || (photo ? 'image' : 'text'),
      fileData: fileData || photo || null,
      fileName, fileSize: fileSize || 0, duration: duration || 0,
      location: location || undefined,
      photo: photo || null,
      forwarded: !!forwarded,
      replyTo,
    });
    await msg.save();

    // Push notification — साझेदार sender को छोड़कर सब devices को
    const roomLabel = room.startsWith('group_') ? `📢 ${room.replace('group_', '').toUpperCase()}` : '💬 DM';
    let preview = text;
    if (!preview) {
      if (fileType === 'image') preview = '📷 Photo भेजी';
      else if (fileType === 'video') preview = '🎥 Video भेजी';
      else if (fileType === 'audio') preview = '🎤 Voice message';
      else if (fileType === 'document') preview = `📄 ${fileName || 'Document'}`;
      else if (fileType === 'location' || location) preview = '📍 Location share की';
      else preview = '📩 Message';
    }
    sendPushToAll(`${sender} — ${roomLabel}`, preview, `/chat?room=${encodeURIComponent(room)}`, senderEndpoint).catch(() => {});

    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ NEW: Edit message (PATCH /:room/:id/edit)
router.patch('/:room/:id/edit', async (req, res) => {
  try {
    const { text, sender } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== sender) return res.status(403).json({ error: 'Only sender can edit' });
    msg.text   = text;
    msg.edited = true;
    await msg.save();
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ Star/unstar message (PATCH /:room/:id/star)
router.patch('/:room/:id/star', async (req, res) => {
  try {
    const { user, star } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (!Array.isArray(msg.starredBy)) msg.starredBy = [];
    if (star) {
      if (!msg.starredBy.includes(user)) msg.starredBy.push(user);
    } else {
      msg.starredBy = msg.starredBy.filter(u => u !== user);
    }
    await msg.save();
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// React to message (PATCH /:room/:id/react) — optional emoji reactions
router.patch('/:room/:id/react', async (req, res) => {
  try {
    const { emoji, user } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (!msg.reactions) msg.reactions = new Map();
    const current = msg.reactions.get(emoji) || [];
    const updated = current.includes(user) ? current.filter(u => u !== user) : [...current, user];
    if (updated.length === 0) msg.reactions.delete(emoji);
    else msg.reactions.set(emoji, updated);
    await msg.save();
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE message
router.delete('/:room/:id', async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { deleted: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unread count
router.get('/:room/unread/:user', async (req, res) => {
  try {
    const count = await Message.countDocuments({
      room: req.params.room,
      sender: { $ne: req.params.user },
      readBy: { $nin: [req.params.user] },
      deleted: { $ne: true },
    });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark as read
router.patch('/:room/read/:user', async (req, res) => {
  try {
    await Message.updateMany(
      { room: req.params.room, sender: { $ne: req.params.user }, readBy: { $nin: [req.params.user] } },
      { $addToSet: { readBy: req.params.user } },
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
