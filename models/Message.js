// models/Message.js — VP Honda Team Chat (WhatsApp-style features)
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  room:       { type: String, required: true, index: true },
  sender:     { type: String, required: true },
  senderRole: { type: String, default: 'staff' },
  text:       { type: String, default: '' },

  // Universal file fields
  fileType:   { type: String, default: 'text' },   // text|image|video|audio|document|location
  fileData:   { type: String, default: null },     // base64 or URL
  fileName:   { type: String, default: null },
  fileSize:   { type: Number, default: 0 },
  duration:   { type: Number, default: 0 },
  location:   { lat: Number, lng: Number, address: String },  // matches TeamChat

  photo:      { type: String, default: null },  // legacy compat

  replyTo: {
    id:       { type: String },
    sender:   { type: String },
    text:     { type: String },
    fileType: { type: String },
  },
  forwarded:  { type: Boolean, default: false },   // ✅ forward flag
  starredBy:  [{ type: String }],                  // ✅ star/bookmark by users
  reactions:  { type: Map, of: [String], default: {} },
  edited:     { type: Boolean, default: false },
  readBy:     [{ type: String }],
  deleted:    { type: Boolean, default: false },
}, { timestamps: true });

MessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.models.Message || mongoose.model('Message', MessageSchema);
