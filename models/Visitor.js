const mongoose = require('mongoose');

// ════════════════════════════════════════════════════════════════════════════
// Visitor — showroom में आने वाले हर व्यक्ति का record (आपका enquiry register)
//
// ⚠️ पहले यह सारा डेटा सिर्फ़ browser के localStorage में था (`vp_visitors`).
// Cache साफ़ होते ही, phone बदलते ही, या "Clear & reset" दबाते ही सब ख़त्म —
// और दूसरे phone पर दिखता भी नहीं था. अब MongoDB में है.
// ════════════════════════════════════════════════════════════════════════════
const visitorSchema = new mongoose.Schema({
  localId:         { type: String, index: true },   // पुराने localStorage records का id
  name:            { type: String, default: '' },
  phone:           { type: String, default: '', index: true },
  purpose:         { type: String, default: 'Purchase' },  // Purchase | Service | General Inquiry
  interestedModel: { type: String, default: '' },
  notes:           { type: String, default: '' },
  handledBy:       { type: String, default: '' },
  visitTime:       { type: String, default: () => new Date().toISOString(), index: true },

  // lead का सफ़र
  stage:           { type: String, default: 'new' },  // new | contacted | quoted | negotiating | won | lost
  nextFollowUp:    { type: String, default: '' },
  followUps:       [{ date: String, note: String, by: String, outcome: String }],

  converted:       { type: Boolean, default: false },
  convertedAt:     { type: String, default: null },
  lostReason:      { type: String, default: '' },
}, { timestamps: true, strict: false });

module.exports = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
