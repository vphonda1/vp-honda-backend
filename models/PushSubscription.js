// models/PushSubscription.js — VP Honda Push Notification Subscriptions
const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String },
    auth:   { type: String },
  },
  userAgent: { type: String },
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model('PushSubscription', PushSubscriptionSchema);