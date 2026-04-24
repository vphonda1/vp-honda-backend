// models/PartConsumption.js — Track every part deduction
const mongoose = require('mongoose');

const partConsumptionSchema = new mongoose.Schema({
  partId:        { type: String, index: true },
  partNumber:    { type: String, index: true },
  partName:      { type: String, default: '' },
  quantity:      { type: Number, default: 0 },          // qty consumed
  invoiceId:     { type: String, default: '', index: true },
  invoiceNumber: { type: String, default: '' },
  customerId:    { type: String, default: '' },
  customerName:  { type: String, default: '' },
  regNo:         { type: String, default: '' },
  consumedAt:    { type: String, default: () => new Date().toISOString() },
  consumedBy:    { type: String, default: 'System' },   // staff who created the invoice
  unitPrice:     { type: Number, default: 0 },
  totalValue:    { type: Number, default: 0 },          // qty × unitPrice
  // Stock snapshot for audit
  stockBefore:   { type: Number, default: 0 },
  stockAfter:    { type: Number, default: 0 },
  reverted:      { type: Boolean, default: false },     // true if invoice deleted later
}, { timestamps: true });

module.exports = mongoose.models.PartConsumption || mongoose.model('PartConsumption', partConsumptionSchema);