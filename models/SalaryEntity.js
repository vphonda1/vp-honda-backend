// models/SalaryEntity.js — Unified staff & rent entity with replacement tracking
const mongoose = require('mongoose');

const salaryEntitySchema = new mongoose.Schema({
  name:          { type: String, required: true, unique: true },
  type:          { type: String, enum: ['staff', 'rent'], required: true },   // 'staff' or 'rent' (house)
  monthlyAmount: { type: Number, default: 0 },                                 // monthly salary or rent
  startDate:     { type: String, required: true },                             // YYYY-MM-DD when hired/started
  endDate:       { type: String, default: null },                              // YYYY-MM-DD when ended (null = active)
  active:        { type: Boolean, default: true },
  replacedBy:    { type: String, default: null },                              // name of next entity
  replaces:      { type: String, default: null },                              // name of previous entity
  photo:         { type: String, default: '' },                                // base64 image or URL
  notes:         { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SalaryEntity', salaryEntitySchema);