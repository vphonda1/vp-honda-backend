const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String },
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  customerId: { type: String, default: '' },
  vehicle: { type: String, default: '' },
  regNo: { type: String, default: '', index: true },
  frameNo: { type: String, default: '' },
  engineNo: { type: String, default: '' },
  invoiceDate: { type: String, default: '' },
  paymentMode: { type: String, default: 'CASH' },
  serviceKm: { type: String, default: '' },
  serviceType: { type: String, default: '' },
  serviceNumber: { type: String, default: '' },
  items: [{ 
    srNo: Number, partNo: String, hsn: String, description: String,
    mrp: Number, unitPrice: Number, quantity: Number,
    total: Number, gstRate: Number, gstAmount: Number,
  }],
  totals: {
    subtotal: { type: Number, default: 0 },
    gstRate: { type: Number, default: 18 },
    gstAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
  },
  importedFrom: { type: String, default: '' },
  importedAt: { type: String, default: '' },
  status: { type: String, default: 'Active' },
  source: { type: String, default: '' },
}, { timestamps: true, strict: false });

module.exports = mongoose.model('Invoice', invoiceSchema);