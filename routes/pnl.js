// ════════════════════════════════════════════════════════════════════════════
// routes/pnl.js — महीने-वार नफ़ा/नुक़सान
// Excel की Summary sheet यहीं import होती है.
// ════════════════════════════════════════════════════════════════════════════
const router = require('express').Router();
const Pnl    = require('../models/PnlMonth');

const MONTH_ORDER = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

// ── सारे महीने (पुराने से नए क्रम में) ───────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await Pnl.find().lean();
    rows.sort((a, b) => (a.y - b.y) || ((MONTH_ORDER[a.m] || 0) - (MONTH_ORDER[b.m] || 0)));
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ⭐ Excel import — एक साथ कई महीने ────────────────────────────────────────
// body: { rows: [ {m,y,veh,access,rto,ins,service,gift,accesory,rent,other,parts,pft}, … ] }
//
// वही महीना दोबारा आए तो नया record नहीं बनता — पुराना update होता है (key से).
// इसलिए Excel में नया महीना जोड़कर दोबारा import करना पूरी तरह सुरक्षित है.
router.post('/import', async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : (req.body?.rows || []);
    if (!rows.length) return res.status(400).json({ error: 'कोई row नहीं मिली' });

    let added = 0, updated = 0;
    const skipped = [];

    for (const r of rows) {
      if (!r?.m || !r?.y) { skipped.push(r?.m || '(बिना महीने)'); continue; }
      const key = `${r.y}-${r.m}`;
      const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
      const neg = v => -Math.abs(num(v));   // ख़र्च हमेशा ऋणात्मक

      const doc = {
        key, m: r.m, y: num(r.y),
        veh: num(r.veh), fin: num(r.fin), cash: num(r.cash),
        access: num(r.access), rto: num(r.rto), ins: num(r.ins),
        service: num(r.service), ew: num(r.ew),
        gift: neg(r.gift), accesory: neg(r.accesory), rent: neg(r.rent),
        other: neg(r.other), parts: neg(r.parts),
        source: r.source || 'excel',
        importedAt: new Date().toISOString(),
      };
      // pft भेजा हो तो वही, वरना खुद जोड़ लो
      doc.pft = (r.pft !== undefined && r.pft !== null && r.pft !== '')
        ? num(r.pft)
        : doc.access + doc.rto + doc.ins + doc.service + doc.ew +
          doc.gift + doc.accesory + doc.rent + doc.other + doc.parts;

      const existing = await Pnl.findOne({ key });
      await Pnl.findOneAndUpdate({ key }, doc, { upsert: true, new: true });
      existing ? updated++ : added++;
    }

    res.json({ ok: true, added, updated, skipped, कुल: rows.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── एक महीना बदलो (Dashboard के expense boxes से) ────────────────────────────
router.put('/:key', async (req, res) => {
  try {
    const doc = await Pnl.findOneAndUpdate({ key: req.params.key }, req.body, { new: true, upsert: true });
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:key', async (req, res) => {
  try {
    const out = await Pnl.deleteOne({ key: req.params.key });
    res.json({ ok: true, deleted: out.deletedCount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
