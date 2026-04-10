const mongoose = require('mongoose');

const partSchema = new mongoose.Schema({
  partName: { type: String, default: '' },
  partNumber: { type: String, default: '' },
  hsnCode: { type: String, default: '' },
  category: { type: String, default: '' },
  unitPrice: { type: Number, default: 0 },
  mrp: { type: Number, default: 0 },
  salePrice: { type: Number, default: 0 },
  stock: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  minStock: { type: Number, default: 0 },
  supplier: { type: String, default: '' },
  location: { type: String, default: '' },
  gstRate: { type: Number, default: 18 },
  notes: { type: String, default: '' },
}, { timestamps: true, strict: false });

partSchema.index({ partName: 'text', partNumber: 'text' });

module.exports = mongoose.model('Part', partSchema);
