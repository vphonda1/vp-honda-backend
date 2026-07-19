// models/PaymentReceipt.js — VP Honda Payment Receipts
const mongoose = require('mongoose');

const PaymentReceiptSchema = new mongoose.Schema({
  receiptNumber:      { type: String, required: true, unique: true },
  receiptDate:        { type: Date, default: Date.now },
  customerId:         { type: String },
  customerName:       { type: String, required: true },
  customerPhone:      { type: String, default: '' },
  vehicleModel:       { type: String, default: '' },
  regNo:              { type: String, default: '' },
  paymentType:        { type: String, enum: ['emi', 'downpayment', 'other'], default: 'other' },
  amount:             { type: Number, required: true },
  paymentMethod:      { type: String, default: 'cash' },
  notes:              { type: String, default: '' },
  // EMI specific
  trackerId:          { type: String },       // PaymentTracker._id
  installmentIndex:   { type: Number },
  installmentLabel:   { type: String },
  installmentDueDate: { type: Date },
  emiAmount:          { type: Number },
  financer:           { type: String, default: '' },
  loanAccountNo:      { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.PaymentReceipt || mongoose.model('PaymentReceipt', PaymentReceiptSchema);
