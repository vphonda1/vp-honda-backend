// models/VpDocSentLog.js — DocumentVault: किस customer का Insurance / RTO / SU Tax कितनी बार भेजा गया
// हर (customer folder × kind) की एक row — ताकि सभी फोन/laptop पर "भेजा गया" एक जैसा दिखे।
const mongoose = require('mongoose');
const Schema = new mongoose.Schema({
  fKey:  { type: String, required: true },            // customer folder का key (नाम+फोन से बना)
  kind:  { type: String, required: true, enum: ['ins', 'rto', 'su'] },
  count: { type: Number, default: 0 },                // कितनी बार भेजा
  last:  { type: Date,   default: Date.now },         // आख़िरी बार कब
  files: { type: Number, default: 0 },                // आख़िरी बार कितनी files
}, { timestamps: true });
Schema.index({ fKey: 1, kind: 1 }, { unique: true });
module.exports = mongoose.models.VpDocSentLog || mongoose.model('VpDocSentLog', Schema, 'vpdocsentlogs');
