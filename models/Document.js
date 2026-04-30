// models/Document.js
const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  folder: { type: String, required: true },
  customerName: { type: String, required: true },
  customerPhone: String,
  aadharNo: String,
  vehicleModel: String,
  chassisNo: String,
  nomineeName: String,
  docType: String,
  docTypeLabel: String,
  docIcon: String,
  expiryDate: String,
  notes: String,
  fileData: String,   // base64 encoded file
  fileType: String,   // 'image', 'pdf', 'video'
  fileName: String,
  savedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Document', documentSchema);