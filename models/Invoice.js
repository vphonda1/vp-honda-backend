const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, default: '' },
  invoiceDate: { type: String, default: '' },
  invoiceType: { type: String, default: 'vehicle' },
  customerName: { type: String, default: '' },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  phone: { type: String, default: '' },
  vehicle: { type: String, default: '' },
  items: [{ name: String, qty: Number, rate: Number, amount: Number, gst: Number }],
  totals: {
    subtotal: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    totalGst: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
  },
  amount: { type: Number, default: 0 },
  pdfText: { type: String, default: '' },
  importedAt: { type: Date, default: Date.now },
  notes: { type: String, default: '' },
}, { timestamps: true, strict: false });

module.exports = mongoose.model('Invoice', invoiceSchema);
