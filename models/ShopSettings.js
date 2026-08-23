// models/ShopSettings.js — Stores shop GPS location and attendance rules
const mongoose = require('mongoose');

const shopSettingsSchema = new mongoose.Schema({
  key:            { type: String, default: 'main', unique: true },   // singleton
  shopName:       { type: String, default: 'VP Honda' },
  address:        { type: String, default: 'Parwaliya Sadak, Bhopal' },

  // ⭐ GPS coordinates of shop (owner sets this)
  shopLat:        { type: Number, default: null },
  shopLng:        { type: Number, default: null },
  allowedRadius:  { type: Number, default: 100 },            // meters

  // Work hours
  workStartTime:  { type: String, default: '09:00' },        // HH:MM
  lateAfter:      { type: String, default: '09:30' },
  workEndTime:    { type: String, default: '19:00' },

  // Penalty rules
  latePenalty:    { type: Number, default: 50 },             // per late day
  absentPenaltyDays:{ type: Number, default: 1 },            // days deducted per absent

  // ⭐ Attendance rules activation date — grace period for old months
  // ⚠️ FIX: यह field दो बार declare थी (एक default:'' और एक default:null).
  // Mongoose सिर्फ आखिरी वाली लेता था — अब सिर्फ एक ही है.
  // Format: YYYY-MM-DD (महीने का पहला दिन, जैसे "2026-05-01"). खाली = कोई rule नहीं.
  attendanceRulesStartDate: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.ShopSettings || mongoose.model('ShopSettings', shopSettingsSchema);