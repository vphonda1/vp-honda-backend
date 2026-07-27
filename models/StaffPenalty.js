// models/StaffPenalty.js — VP Honda Staff Penalty System
const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  staffName:   { type: String, required: true, index: true },
  staffId:     { type: String },
  date:        { type: Date, default: Date.now },
  month:       { type: Number },  // 1-12
  year:        { type: Number },
  category:    { type: String, enum: [
    'late_coming',        // देर से आना
    'unauthorized_leave', // बिना permission छुट्टी
    'customer_complaint', // customer complaint
    'policy_violation',   // policy violation
    'traffic_fine',       // traffic fine
    'company_damage',     // company property damage
    'mobile_use',         // unauthorized mobile use
    'dress_code',         // dress code violation
    'manual',             // admin द्वारा manual
    'other'
  ], default: 'manual' },
  amount:      { type: Number, required: true },
  description: { type: String, default: '' },
  isAutomatic: { type: Boolean, default: false },
  appliedBy:   { type: String, default: 'admin' },
  adjusted:    { type: Boolean, default: false },  // salary से adjust हो गया
}, { timestamps: true });
module.exports = mongoose.models.StaffPenalty || mongoose.model('StaffPenalty', Schema);
