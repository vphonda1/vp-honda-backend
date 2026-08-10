// models/VpDocument.js — VP Honda Document Vault
const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  folder:        { type: String, index: true },
  customerName:  { type: String },
  customerPhone: { type: String },
  aadharNo:      { type: String },
  vehicleModel:  { type: String },
  chassisNo:     { type: String },
  nomineeName:   { type: String },
  hypothecation: { type: String },
  docType:       { type: String },
  docTypeLabel:  { type: String },
  docIcon:       { type: String },
  expiryDate:    { type: String },
  notes:         { type: String },
  // ✅ Cloudinary URL (new) OR base64 (legacy)
  fileUrl:       { type: String, default: null },  // Cloudinary URL
  fileData:      { type: String, default: null },  // base64 (legacy)
  fileType:      { type: String },
  fileName:      { type: String },
  storageType:   { type: String, default: 'mongodb' }, // 'cloudinary' or 'mongodb'
  savedAt:       { type: String },
}, { timestamps: true, strict: false });
module.exports = mongoose.models.VpDocument || mongoose.model('VpDocument', Schema, 'vpdocuments');
