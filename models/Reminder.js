const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  customerId: { type: String, default: '' },
  invoiceId: { type: String, default: '' },
  customerName: { type: String, default: '' },
  phone: { type: String, default: '' },
  type: { type: String, default: 'service' },
  serviceType: { type: String, default: '1st' },
  dueDate: { type: String, default: '' },
  status: { type: String, default: 'pending' },
  notes: { type: String, default: '' },
  followUps: [{
    date: String,
    notes: String,
    calledBy: String,
  }],
}, { timestamps: true, strict: false });

module.exports = mongoose.model('Reminder', reminderSchema);
