const mongoose = require('mongoose');

// ════════════════════════════════════════════════════════════════════════════
// PnlMonth — महीने-दर-महीने नफ़ा/नुक़सान (Excel की Summary sheet वाला डेटा)
//
// पहले यह पूरा डेटा Dashboard.jsx में hardcode था (BASE_SUMMARY_PL). नया महीना
// जोड़ने के लिए हर बार code बदलना पड़ता था — app में कोई बटन ही नहीं था.
//
// अब Excel से import होता है और यहाँ सेव रहता है, इसलिए हर device पर वही
// दिखता है और नया महीना जोड़ने के लिए बस file दोबारा import करनी है.
// ════════════════════════════════════════════════════════════════════════════
const pnlSchema = new mongoose.Schema({
  m:        { type: String, required: true },   // 'Sep', 'Oct' …
  y:        { type: Number, required: true },   // 2024, 2025 …
  key:      { type: String, unique: true, index: true },  // '2024-Sep' — दोबारा import पर update

  veh:      { type: Number, default: 0 },       // Fin + Cash (कितनी गाड़ियाँ बिकीं)
  fin:      { type: Number, default: 0 },
  cash:     { type: Number, default: 0 },

  // आमदनी (धनात्मक)
  access:   { type: Number, default: 0 },       // Accessories margin
  rto:      { type: Number, default: 0 },       // RTO margin
  ins:      { type: Number, default: 0 },       // Insurance margin
  service:  { type: Number, default: 0 },       // Service
  ew:       { type: Number, default: 0 },       // Extended Warranty

  // ख़र्च (ऋणात्मक रखे जाते हैं)
  gift:     { type: Number, default: 0 },
  accesory: { type: Number, default: 0 },       // Accessory खरीद
  rent:     { type: Number, default: 0 },       // किराया + वेतन
  other:    { type: Number, default: 0 },
  parts:    { type: Number, default: 0 },       // Parts खरीद

  pft:      { type: Number, default: 0 },       // महीने का शुद्ध लाभ
  source:   { type: String, default: 'excel' }, // excel | manual
  importedAt: { type: String, default: () => new Date().toISOString() },
}, { timestamps: true, strict: false });

module.exports = mongoose.models.PnlMonth || mongoose.model('PnlMonth', pnlSchema);
