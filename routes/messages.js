// routes/messages.js — VP Honda Team Chat API
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// GET /api/messages/:room — Get messages for a room
router.get('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const since = req.query.since;  // ISO timestamp — only return newer

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

// POST /api/messages/:room — Send a message
router.post('/:room', async (req, res) => {
  try {
    const { room } = req.params;
    const { sender, senderRole, text, photo, replyTo } = req.body;

    if (!sender || (!text && !photo)) {
      return res.status(400).json({ error: 'sender and text/photo required' });
    }

    const msg = new Message({ room, sender, senderRole, text, photo, replyTo });
    await msg.save();
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/:room/:id — Soft delete
router.delete('/:room/:id', async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { deleted: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:room/unread/:user — Count unread
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

// PATCH /api/messages/:room/read/:user — Mark all as read
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

module.exports = router;