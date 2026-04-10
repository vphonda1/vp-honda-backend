const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  // Basic Info
  customerName: { type: String, default: '' },
  fatherName: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  district: { type: String, default: '' },
  dob: { type: String, default: '' },
  aadhar: { type: String, default: '' },
  pan: { type: String, default: '' },

  // Vehicle Info
  vehicleModel: { type: String, default: '' },
  vehicleColor: { type: String, default: '' },
  engineNo: { type: String, default: '' },
  chassisNo: { type: String, default: '' },
  registrationNo: { type: String, default: '' },
  invoiceDate: { type: String, default: '' },
  purchaseDate: { type: String, default: '' },

  // Financial
  exShowroom: { type: Number, default: 0 },
  onRoad: { type: Number, default: 0 },
  financeCompany: { type: String, default: '' },
  financeAmount: { type: Number, default: 0 },
  pendingAmount: { type: Number, default: 0 },
  paymentType: { type: String, default: 'Cash' },

  // Insurance / RTO
  insuranceCompany: { type: String, default: '' },
  insuranceAmount: { type: Number, default: 0 },
  rtoAmount: { type: Number, default: 0 },

  // Service
  firstServiceDate: { type: String, default: '' },
  secondServiceDate: { type: String, default: '' },
  thirdServiceDate: { type: String, default: '' },

  // Old Bike Exchange
  oldBikeModel: { type: String, default: '' },
  oldBikeRegNo: { type: String, default: '' },
  oldBikeValue: { type: Number, default: 0 },

  // Battery
  batteryNo: { type: String, default: '' },

  // Misc
  invoiceNumber: { type: String, default: '' },
  notes: { type: String, default: '' },
}, {
  timestamps: true,
  strict: false  // Allow extra fields from Excel import
});

// Text search index
customerSchema.index({ customerName: 'text', phone: 'text', vehicleModel: 'text', registrationNo: 'text' });

module.exports = mongoose.model('Customer', customerSchema);
