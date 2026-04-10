const mongoose = require('mongoose');

const serviceCustomerSchema = new mongoose.Schema({
  customerName: { type: String, default: '' },
  fatherName: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  dob: { type: String, default: '' },
  aadhar: { type: String, default: '' },
  pan: { type: String, default: '' },
  vehicleModel: { type: String, default: '' },
  registrationNo: { type: String, default: '' },
  engineNo: { type: String, default: '' },
  chassisNo: { type: String, default: '' },
  purchaseDate: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { timestamps: true, strict: false });

module.exports = mongoose.model('ServiceCustomer', serviceCustomerSchema);
