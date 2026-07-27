// models/StaffIncentive.js — VP Honda Staff Incentive System
const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  staffName:   { type: String, required: true, index: true },
  staffId:     { type: String },
  date:        { type: Date, default: Date.now },
  month:       { type: Number },
  year:        { type: Number },
  category:    { type: String, enum: [
    'retail',       // vehicle retail
    'finance',      // loan/finance
    'insurance',    // insurance sale
    'accessories',  // accessories
    'service',      // service work
    'exchange',     // exchange vehicle
    'target',       // monthly target achieved
    'festival',     // festival bonus
    'custom',       // custom/manual
    'other'
  ], default: 'retail' },
  amount:      { type: Number, required: true },
  units:       { type: Number, default: 1 },   // कितने units पर
  perUnit:     { type: Number, default: 0 },   // per unit rate
  description: { type: String, default: '' },
  addedBy:     { type: String, default: 'admin' },
  adjusted:    { type: Boolean, default: false },
}, { timestamps: true });
module.exports = mongoose.models.StaffIncentive || mongoose.model('StaffIncentive', Schema);
