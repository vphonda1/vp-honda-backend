// ════════════════════════════════════════════════════════════════════════════
// routes/tracking.js — Visitors, Pickup/Drop और Appointments
//
// तीनों का डेटा पहले सिर्फ़ browser के localStorage में रहता था. अब MongoDB में.
// हर collection में एक `/migrate` endpoint भी है जो phone में पड़ा पुराना
// डेटा एक बार में server पर उठा लाता है — कुछ खोता नहीं.
// ════════════════════════════════════════════════════════════════════════════
const router      = require('express').Router();
const Visitor     = require('../models/Visitor');
const PickupDrop  = require('../models/PickupDrop');
const Appointment = require('../models/Appointment');

/** तीनों के लिए एक जैसा CRUD — बार-बार वही code न लिखना पड़े */
function crud(basePath, Model, sortField) {
  router.get(basePath, async (req, res) => {
    try {
      const q = {};
      if (req.query.status) q.status = req.query.status;
      if (req.query.from || req.query.to) {
        q[sortField] = {};
        if (req.query.from) q[sortField].$gte = req.query.from;
        if (req.query.to)   q[sortField].$lte = req.query.to;
      }
      const limit = Math.min(Number(req.query.limit) || 1000, 5000);
      res.json(await Model.find(q).sort({ [sortField]: -1 }).limit(limit).lean());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ⚠️ `/migrate` हमेशा `/:id` वाले routes से **पहले** — वरना कल कोई
  // `POST /:id` जोड़ दे तो Express '/migrate' को id समझकर खा जाएगा.
  router.post(basePath + '/migrate', async (req, res) => {
    try {
      const rows = Array.isArray(req.body) ? req.body : (req.body?.rows || []);
      let added = 0, skipped = 0;
      for (const r of rows) {
        if (!r) continue;
        const localId = String(r.id || r.localId || '');
        if (localId && await Model.findOne({ localId })) { skipped++; continue; }
        const { id, _id, __v, ...rest } = r;
        await Model.create({ ...rest, localId: localId || undefined });
        added++;
      }
      res.json({ ok: true, added, skipped, total: rows.length });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post(basePath, async (req, res) => {
    try {
      // वही localId दोबारा आए तो नया record न बने (offline queue दो बार भेज सकती है)
      if (req.body?.localId) {
        const exists = await Model.findOne({ localId: req.body.localId });
        if (exists) {
          const upd = await Model.findByIdAndUpdate(exists._id, req.body, { new: true });
          return res.json(upd);
        }
      }
      res.status(201).json(await Model.create(req.body || {}));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.put(basePath + '/:id', async (req, res) => {
    try {
      const q = /^[0-9a-fA-F]{24}$/.test(req.params.id)
        ? { _id: req.params.id } : { localId: req.params.id };
      const doc = await Model.findOneAndUpdate(q, req.body, { new: true, upsert: true });
      res.json(doc);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete(basePath + '/:id', async (req, res) => {
    try {
      const q = /^[0-9a-fA-F]{24}$/.test(req.params.id)
        ? { _id: req.params.id } : { localId: req.params.id };
      const out = await Model.deleteOne(q);
      res.json({ ok: true, deleted: out.deletedCount });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });
}

crud('/visitors',     Visitor,     'visitTime');
crud('/pickup-drops', PickupDrop,  'scheduled');
crud('/appointments', Appointment, 'date');

module.exports = router;
