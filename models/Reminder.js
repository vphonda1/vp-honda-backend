const mongoose = require('mongoose');

// ════════════════════════════════════════════════════════════════════════════
// Reminder — सिर्फ़ **manual** (हाथ से जोड़े गए) reminders यहाँ रखे जाते हैं.
//
// Service / Payment / Insurance / RTO वाले reminders कहीं save नहीं होते —
// वे हर बार `servicedatas` के असली डेटा से अपने आप बनते हैं (utils/reminderEngine.js).
// इसलिए वे कभी पुराने या डुप्लिकेट नहीं होते.
//
// यहाँ सिर्फ़ वे reminder हैं जो किसी data से नहीं बनते — जैसे "श्री वर्मा को
// नई गाड़ी दिखानी है", "workshop का AMC renew करना है".
// ════════════════════════════════════════════════════════════════════════════
const reminderSchema = new mongoose.Schema({
  title:          { type: String, required: true },
  notes:          { type: String, default: '' },
  type:           { type: String, default: 'manual' },   // manual | service | payment | insurance | followup
  priority:       { type: String, default: 'normal' },   // critical | high | normal | low
  dueDate:        { type: String, default: '' },         // YYYY-MM-DD

  // किससे जुड़ा है
  customerId:     { type: String, default: '' },
  customerName:   { type: String, default: '' },
  phone:          { type: String, default: '' },
  regNo:          { type: String, default: '' },
  vehicle:        { type: String, default: '' },
  invoiceId:      { type: String, default: '' },

  // ⭐ किसे करना है — इसी user के सारे devices पर notification जाएगी
  assignedTo:     { type: String, default: '', index: true },   // staffId या 'admin-1'
  assignedToName: { type: String, default: '' },

  // हालत
  status:         { type: String, default: 'pending', index: true }, // pending | completed | cancelled
  snoozeUntil:    { type: String, default: null },
  completedAt:    { type: String, default: null },
  completedBy:    { type: String, default: '' },
  createdBy:      { type: String, default: '' },

  // किस-किस पड़ाव की notification जा चुकी — दोबारा न जाए
  notifiedRungs:  { type: [Number], default: [] },

  followUps: [{ date: String, notes: String, calledBy: String }],
}, { timestamps: true, strict: false });

reminderSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);
