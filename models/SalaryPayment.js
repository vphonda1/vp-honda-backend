// models/SalaryPayment.js — Staff salary + advance tracking
const mongoose = require('mongoose');

const salaryPaymentSchema = new mongoose.Schema({
  staffId:       { type: String, index: true },         // numeric staff id OR mongoid
  staffName:     { type: String, default: '' },
  staffPosition: { type: String, default: '' },
  type:          { type: String, default: 'salary', enum: ['salary', 'advance', 'bonus', 'incentive', 'deduction'] },
  amount:        { type: Number, default: 0 },
  paymentDate:   { type: String, default: '' },         // YYYY-MM-DD
  forMonth:      { type: Number, default: 0 },          // 1-12 (which month this salary is for)
  forYear:       { type: Number, default: 0 },
  paymentMode:   { type: String, default: 'CASH' },     // CASH / UPI / BANK
  reference:     { type: String, default: '' },         // UPI ref / cheque no / receipt
  notes:         { type: String, default: '' },
  paidBy:        { type: String, default: 'Admin' },
  cancelled:     { type: Boolean, default: false },
  seeded:        { type: Boolean, default: false },       // true if imported from Excel seed
}, { timestamps: true });

salaryPaymentSchema.index({ staffId: 1, forYear: -1, forMonth: -1 });
salaryPaymentSchema.index({ paymentDate: -1 });

module.exports = mongoose.models.SalaryPayment || mongoose.model('SalaryPayment', salaryPaymentSchema);