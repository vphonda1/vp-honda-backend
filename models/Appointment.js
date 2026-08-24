const mongoose = require('mongoose');

// Calendar की booking. पहले सिर्फ़ localStorage (`vp_appointments`) में थी.
const appointmentSchema = new mongoose.Schema({
  localId:       { type: String, index: true },
  title:         { type: String, default: '' },
  customerName:  { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  type:          { type: String, default: 'Service' },   // Service | Delivery | Meeting | Other
  date:          { type: String, index: true },          // YYYY-MM-DD
  time:          { type: String, default: '10:00' },
  notes:         { type: String, default: '' },
  handledBy:     { type: String, default: '' },
  status:        { type: String, default: 'scheduled' }, // scheduled | done | cancelled
}, { timestamps: true, strict: false });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
