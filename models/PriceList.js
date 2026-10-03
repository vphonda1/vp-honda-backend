const mongoose = require('mongoose');

// ════════════════════════════════════════════════════════════════════════════
// PriceList — Honda की on-road price list (Excel की "Rate List" sheet, A1:L31)
//
// हर import एक नया record बनता है. सबसे नया = आज की price list.
// पुराने 12 तक रखे जाते हैं — ताकि पता चले कौन सा दाम कितना बढ़ा/घटा.
// (एक record ≈ 5–8 KB, यानी MongoDB पर कोई बोझ नहीं.)
// ════════════════════════════════════════════════════════════════════════════
const priceListSchema = new mongoose.Schema({
  title:      { type: String, default: '' },     // "HONDA PRICE LIST 01 - OCT - 2026"
  groups:     { type: Object, default: {} },     // { onRoad: 'ON-ROAD PRICE', optional: 'OPTIONAL' }
  headers:    { type: Object, default: {} },     // Excel वाले कॉलम नाम, जैसे लिखे हैं
  rows:       { type: Array,  default: [] },     // [{type:'model', sNo, model, cc, exShowroom, …} | {type:'section', label}]
  notes:      { type: [String], default: [] },   // नीचे की लाइनें (Hypothecation, Temp. Registration …)
  modelCount: { type: Number, default: 0 },
  sheetName:  { type: String, default: '' },
  sourceFile: { type: String, default: '' },
  importedBy: { type: String, default: '' },
}, { timestamps: true });

priceListSchema.index({ createdAt: -1 });

module.exports = mongoose.models.PriceList || mongoose.model('PriceList', priceListSchema);
