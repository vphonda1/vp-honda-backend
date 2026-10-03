// ════════════════════════════════════════════════════════════════════════════
// routes/priceList.js — 🏷️ Honda Price List (Excel "Rate List" sheet से)
// ════════════════════════════════════════════════════════════════════════════
//   GET    /api/price-list            → सबसे नई price list (कुछ न हो तो null)
//   GET    /api/price-list/history    → पिछले imports की सूची (बिना rows के — हल्की)
//   GET    /api/price-list/:id        → कोई एक पुरानी price list पूरी
//   POST   /api/price-list            → नई price list सेव (Excel import के बाद)
//   DELETE /api/price-list/:id        → गलत import हटाओ
// ════════════════════════════════════════════════════════════════════════════
const router    = require('express').Router();
const mongoose  = require('mongoose');
const PriceList = require('../models/PriceList');

const KEEP_VERSIONS = 12;   // इससे पुराने अपने आप हट जाते हैं

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/** frontend से आई rows को साफ़ करो — अनजान field या बहुत बड़ा data न जाए */
function cleanRows(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'section') {
      const label = str(r.label, 120);
      if (label) out.push({ type: 'section', label });
      continue;
    }
    const model = str(r.model, 120);
    if (!model) continue;
    out.push({
      type:       'model',
      sNo:        str(r.sNo, 10),
      model,
      cc:         str(r.cc, 30),
      exShowroom: num(r.exShowroom),
      rto:        num(r.rto),
      insurance:  num(r.insurance),
      offerPrice: num(r.offerPrice),
      zeroDep:    num(r.zeroDep),
      warranty:   num(r.warranty),
      accessory:  num(r.accessory),
      grandTotal: num(r.grandTotal),
    });
  }
  return out;
}

// ── सबसे नई price list ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const latest = await PriceList.findOne().sort({ createdAt: -1 }).lean();
    res.json(latest || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── पिछले imports की सूची ────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const list = await PriceList.find()
      .sort({ createdAt: -1 })
      .limit(KEEP_VERSIONS)
      .select('title modelCount sourceFile importedBy createdAt')
      .lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── कोई एक पुरानी price list ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'गलत id' });
    const doc = await PriceList.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'price list नहीं मिली' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ⭐ नई price list सेव (Excel import) ──────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.rows) || !b.rows.length) {
      return res.status(400).json({ error: 'price list में कोई model नहीं मिला' });
    }
    if (b.rows.length > 300) {
      return res.status(400).json({ error: 'बहुत ज़्यादा rows — क्या सही sheet चुनी है?' });
    }
    const rows = cleanRows(b.rows);
    const modelCount = rows.filter(r => r.type === 'model').length;
    if (!modelCount) return res.status(400).json({ error: 'price list में कोई model नहीं मिला' });

    const headers = {};
    if (b.headers && typeof b.headers === 'object') {
      for (const [k, v] of Object.entries(b.headers).slice(0, 20)) headers[str(k, 30)] = str(v, 40);
    }

    const doc = await PriceList.create({
      title:      str(b.title, 150),
      groups:     {
        onRoad:   str(b.groups?.onRoad, 60),
        optional: str(b.groups?.optional, 60),
      },
      headers,
      rows,
      notes:      (Array.isArray(b.notes) ? b.notes : []).map(n => str(n, 200)).filter(Boolean).slice(0, 10),
      modelCount,
      sheetName:  str(b.sheetName, 60),
      sourceFile: str(b.sourceFile, 150),
      importedBy: str(b.importedBy, 60),
    });

    // पुराने versions हटाओ — सिर्फ़ आख़िरी KEEP_VERSIONS रखो
    const old = await PriceList.find().sort({ createdAt: -1 }).skip(KEEP_VERSIONS).select('_id').lean();
    if (old.length) await PriceList.deleteMany({ _id: { $in: old.map(o => o._id) } });

    res.status(201).json({ ok: true, id: doc._id, modelCount, createdAt: doc.createdAt });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── गलत import हटाओ ──────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'गलत id' });
    const out = await PriceList.deleteOne({ _id: req.params.id });
    res.json({ ok: true, deleted: out.deletedCount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
