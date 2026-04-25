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

  // ⭐ Grace period: rules apply only from this date onwards
  // Default empty = no rules active (all months grace)
  // Format: YYYY-MM-DD (use first day of month e.g. "2026-05-01")
  attendanceRulesStartDate: { type: String, default: '' },

  // ⭐ Attendance rules activation date — grace period for old months
  attendanceRulesStartDate: { type: String, default: null }, // YYYY-MM-DD — rules lagu from this month onwards
}, { timestamps: true });

module.exports = mongoose.models.ShopSettings || mongoose.model('ShopSettings', shopSettingsSchema);