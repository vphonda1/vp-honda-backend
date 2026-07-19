// models/PaymentTracker.js — VP Honda Payment Tracker
const mongoose = require('mongoose');

// Individual payment entry
const PaymentEntrySchema = new mongoose.Schema({
  amount:      { type: Number, required: true },
  date:        { type: Date,   required: true },
  mode:        { type: String, enum: ['cash','upi','cheque','neft','other'], default: 'cash' },
  note:        { type: String, default: '' },
  receivedBy:  { type: String, default: '' },
}, { timestamps: true });

const PaymentTrackerSchema = new mongoose.Schema({
  // ── Customer Link ──────────────────────────────────────────────────────────
  customerId:    { type: String },
  customerName:  { type: String, required: true },
  customerPhone: { type: String, default: '' },
  altPhone:      { type: String, default: '' },
  aadharNo:      { type: String, default: '' },
  vehicleModel:  { type: String, default: '' },
  regNo:         { type: String, default: '' },
  chassisNo:     { type: String, default: '' },

  // ── Loan / Payment Details ─────────────────────────────────────────────────
  vehiclePrice:  { type: Number, default: 0 },
  downPayment:   { type: Number, default: 0 },
  financeAmount: { type: Number, default: 0 },  // vehiclePrice - downPayment
  financer:      { type: String, default: '' },  // bank/NBFC name
  loanAccountNo: { type: String, default: '' },
  
  // ── EMI Structure ──────────────────────────────────────────────────────────
  emiAmount:     { type: Number, default: 0 },
  totalEmis:     { type: Number, default: 0 },  // tenure in months
  paidEmis:      { type: Number, default: 0 },  // auto-updated from entries
  startDate:     { type: Date },
  
  // ── Pending Balance (for non-EMI / udhaari) ───────────────────────────────
  pendingAmount: { type: Number, default: 0 },  // direct balance due
  
  // ── Payment History ────────────────────────────────────────────────────────
  entries:       [PaymentEntrySchema],
  
  // ── Status ─────────────────────────────────────────────────────────────────
  type:     { type: String, enum: ['emi','balance','udhaari'], default: 'balance' },
  status:   { type: String, enum: ['active','completed','defaulted'], default: 'active' },
  invoiceId:{ type: String, default: '' },
  notes:    { type: String, default: '' },
}, { timestamps: true });

// Auto-compute: totalPaid, remainingAmount, paidEmis
PaymentTrackerSchema.virtual('totalPaid').get(function() {
  return this.entries.reduce((s, e) => s + (e.amount || 0), 0);
});
PaymentTrackerSchema.virtual('remainingAmount').get(function() {
  if (this.type === 'emi') return Math.max(0, (this.emiAmount * this.totalEmis) - this.totalPaid);
  return Math.max(0, this.pendingAmount - this.totalPaid);
});
PaymentTrackerSchema.set('toJSON', { virtuals: true });
PaymentTrackerSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.PaymentTracker || mongoose.model('PaymentTracker', PaymentTrackerSchema);
