// models/Message.js — VP Honda Team Chat Messages
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  room:      { type: String, required: true, index: true },  // 'group_general' | 'dm_A_B'
  sender:    { type: String, required: true },
  senderRole:{ type: String, default: 'staff' },
  text:      { type: String, default: '' },
  photo:     { type: String, default: null },    // base64 or URL
  replyTo:   {
    id:     { type: String },
    sender: { type: String },
    text:   { type: String },
  },
  readBy:    [{ type: String }],
  deleted:   { type: Boolean, default: false },
}, { timestamps: true });

// Auto-delete messages older than 90 days
MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('Message', MessageSchema);