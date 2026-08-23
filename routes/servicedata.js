// routes/servicedata.js — Service Data Cross-Device Sync
// server.js में add करें:
//   app.use('/api/service-data', require('./routes/servicedata'));

const router   = require('express').Router();
const mongoose = require('mongoose');

let ServiceData;
try { ServiceData = mongoose.model('ServiceData'); } catch {
  ServiceData = mongoose.model('ServiceData', new mongoose.Schema({
    regNo:              { type: String, index: true, unique: true },
    customerName:       String, phone: String, vehicle: String,
    purchaseDate:       String,
    firstServiceDate:   String, firstServiceKm:   String,
    secondServiceDate:  String, secondServiceKm:  String,
    thirdServiceDate:   String, thirdServiceKm:   String,
    fourthServiceDate:  String, fourthServiceKm:  String,
    fifthServiceDate:   String, fifthServiceKm:   String,
    sixthServiceDate:   String, sixthServiceKm:   String,
    seventhServiceDate: String, seventhServiceKm: String,
    pendingAmount:      Number, paymentDueDate:    String,
    insuranceDate:      String, rtoDoneDate:       String,
    lastRemarks:        String,
    // ⭐ reminder बंद / snooze की स्थिति — key = reminder id (जैसे "svc-2nd-MP04XX1234")
    reminderState:      { type: Object, default: {} },
    paymentReceivedDate:String,
    insuranceStartDate: String,
    insuranceRenewed:   Boolean,
  }, { timestamps: true, strict: false }));
}


// ════════════════════════════════════════════════════════════════════════════
// डुप्लिकेट record जोड़ने का logic (frontend के src/utils/vehicleIdentity.js
// जैसा ही — दोनों जगह एक ही नियम चलें इसलिए यहाँ दोहराया गया है)
// ════════════════════════════════════════════════════════════════════════════
const normKey     = k => String(k || '').trim().toUpperCase();
const REG_RE      = /^[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4}$/;
const OBJECTID_RE = /^[0-9A-F]{24}$/;

const isRealRegNo = (k) => {
  const s = normKey(k);
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'NA') return false;
  if (s.startsWith('IMPORTED-') || s.startsWith('NO_REG_') || s.startsWith('TEMP-') || s.startsWith('AUTO-')) return false;
  if (OBJECTID_RE.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  return REG_RE.test(s);
};

const phoneKey = p => String(p || '').replace(/\D/g, '').slice(-10);
const nameKey  = n => String(n || '').replace(/^\d+\s*/, '').toLowerCase().replace(/[^a-z\u0900-\u097F]/g, '');

const identityOf = (rec) => {
  const reg = normKey(rec.regNo);
  if (isRealRegNo(reg)) return `REG:${reg}`;
  const ph = phoneKey(rec.phone);
  const vh = String(rec.vehicle || '').toLowerCase().replace(/\s+/g, '');
  if (ph) return `PH:${ph}|${vh}`;
  const nm = nameKey(rec.customerName);
  if (nm) return `NM:${nm}|${vh}`;
  return `KEY:${reg}`;
};

const DATE_FIELDS = new Set(['purchaseDate','firstServiceDate','secondServiceDate','thirdServiceDate',
  'fourthServiceDate','fifthServiceDate','sixthServiceDate','seventhServiceDate',
  'insuranceDate','rtoDoneDate','insuranceStartDate','insuranceRenewalDate','paymentReceivedDate']);
const SKIP_FIELDS = new Set(['_id','__v','createdAt','updatedAt','regNo']);

const richness = (rec) => Object.entries(rec || {})
  .filter(([k, v]) => !SKIP_FIELDS.has(k) && k !== 'reminderState' && v !== undefined && v !== null && v !== '' && v !== 0).length;

const newerDate = (a, b) => {
  if (!a) return b; if (!b) return a;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da)) return b; if (isNaN(db)) return a;
  return db > da ? b : a;
};

/** सारे records देखकर बताओ किसे किसमें जोड़ना है */
function planMerge(docs) {
  const buckets = new Map();
  for (const d of docs) {
    const key = normKey(d.regNo);
    if (!key || key === 'NO_REG_') continue;
    const id = identityOf({ ...d, regNo: key });
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push({ ...d, regNo: key, _origKey: d.regNo });
  }

  // दूसरा दौर — कचरा-key वाला bucket उसी ग्राहक के असली reg no वाले bucket में
  // (frontend के vehicleIdentity.js जैसा ही नियम)
  const regBuckets = [...buckets.entries()].filter(([id]) => id.startsWith('REG:'));
  for (const [id, list] of [...buckets.entries()]) {
    if (id.startsWith('REG:')) continue;
    const ph = phoneKey(list[0].phone);
    if (!ph) continue;
    const vh = String(list[0].vehicle || '').toLowerCase().replace(/\s+/g, '');
    const hits = regBuckets.filter(([, rl]) => {
      if (phoneKey(rl[0].phone) !== ph) return false;
      const rv = String(rl[0].vehicle || '').toLowerCase().replace(/\s+/g, '');
      return !vh || !rv || rv === vh;
    });
    if (hits.length === 1) { hits[0][1].push(...list); buckets.delete(id); }
  }

  const plan = [];
  for (const [, list] of buckets) {
    if (list.length < 2 && normKey(list[0]._origKey) === list[0]._origKey) continue;
    list.sort((a, b) => {
      const ra = isRealRegNo(a.regNo) ? 1 : 0, rb = isRealRegNo(b.regNo) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return richness(b) - richness(a);
    });
    const primary = list[0];
    const merged = {};
    for (const [k, v] of Object.entries(primary)) {
      if (SKIP_FIELDS.has(k) || k === '_origKey') continue;
      merged[k] = v;
    }
    for (let i = 1; i < list.length; i++) {
      for (const [f, v] of Object.entries(list[i])) {
        if (SKIP_FIELDS.has(f) || f === '_origKey') continue;
        if (v === undefined || v === null || v === '') continue;
        if (f === 'reminderState') { merged.reminderState = { ...(v || {}), ...(merged.reminderState || {}) }; continue; }
        if (DATE_FIELDS.has(f)) { merged[f] = newerDate(merged[f], v); continue; }
        if (f === 'pendingAmount') { merged[f] = Math.max(Number(merged[f] || 0), Number(v || 0)); continue; }
        if (merged[f] === undefined || merged[f] === '' || merged[f] === null) merged[f] = v;
      }
    }
    plan.push({
      keep: primary.regNo,
      keepIsRealReg: isRealRegNo(primary.regNo),
      dropKeys: [...new Set(list.slice(1).map(x => x._origKey).concat(
        normKey(primary._origKey) !== primary._origKey ? [primary._origKey] : []))]
        .filter(k => k !== primary.regNo),
      customerName: merged.customerName || '—',
      vehicle: merged.vehicle || '',
      phone: merged.phone || '',
      merged,
    });
  }
  return plan;
}

// GET all service records
router.get('/', async (req, res) => {
  try { res.json(await ServiceData.find().lean()); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

// POST bulk upsert — sync entire customerServiceData object from any device
router.post('/sync', async (req, res) => {
  try {
    const data = req.body; // { regNo: {...}, regNo2: {...} }
    const ops = Object.entries(data).map(([regNo, val]) => ({
      updateOne: {
        filter: { regNo },
        update: { $set: { ...val, regNo } },
        upsert: true,
      }
    }));
    if (ops.length) await ServiceData.bulkWrite(ops);
    res.json({ success: true, synced: ops.length });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// PUT upsert single record (when service is marked done)
router.put('/:regNo', async (req, res) => {
  try {
    const doc = await ServiceData.findOneAndUpdate(
      { regNo: req.params.regNo },
      { $set: { ...req.body, regNo: req.params.regNo } },
      { upsert: true, new: true }
    );
    res.json(doc);
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// DELETE single record by regNo or customerId (called by DiagnosticPage Auto-Fix)
router.delete('/:key', async (req, res) => {
  try {
    const result = await ServiceData.deleteOne({
      $or: [
        { regNo: req.params.key },
        { customerId: req.params.key },
      ]
    });
    res.json({ success: true, deleted: result.deletedCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ⭐ NEW — PATCH /api/service-data/:regNo/reminder-state
// एक reminder को "पूरा हुआ" / "बाद में" mark करता है.
// पूरा reminderState object replace करने के बजाय सिर्फ़ एक key set करता है, ताकि
// दो devices एक साथ अलग-अलग reminder बंद करें तो एक-दूसरे को मिटाएँ नहीं.
// body: { rid: "svc-2nd-MP04XX1234", closedAt: "...", snoozeUntil: "...", reason: "..." }
router.patch('/:regNo/reminder-state', async (req, res) => {
  try {
    const { rid, ...state } = req.body || {};
    if (!rid) return res.status(400).json({ error: 'rid required' });
    const doc = await ServiceData.findOneAndUpdate(
      { regNo: req.params.regNo },
      { $set: { [`reminderState.${rid}`]: { ...state, updatedAt: new Date() }, regNo: req.params.regNo } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, regNo: req.params.regNo, rid, reminderState: doc.reminderState });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ⭐ NEW — DELETE reminder state (बंद किया हुआ reminder वापस चालू करें)
router.delete('/:regNo/reminder-state/:rid', async (req, res) => {
  try {
    await ServiceData.updateOne(
      { regNo: req.params.regNo },
      { $unset: { [`reminderState.${req.params.rid}`]: '' } }
    );
    res.json({ ok: true });
  } catch(err) { res.status(400).json({ error: err.message }); }
});


// ⭐ GET /api/service-data/duplicates — सिर्फ़ दिखाता है, कुछ बदलता नहीं (preview)
// एक ही गाड़ी के कितने record पड़े हैं — imported-…, ObjectId और case वाले duplicate.
router.get('/duplicates', async (req, res) => {
  try {
    const docs = await ServiceData.find().lean();
    const plan = planMerge(docs).filter(p => p.dropKeys.length > 0);
    res.json({
      ok: true,
      totalRecords: docs.length,
      junkKeyRecords: docs.filter(d => !isRealRegNo(d.regNo)).length,
      duplicateGroups: plan.length,
      recordsToRemove: plan.reduce((n, p) => n + p.dropKeys.length, 0),
      groups: plan.slice(0, 100).map(p => ({
        keep: p.keep, keepIsRealReg: p.keepIsRealReg,
        dropKeys: p.dropKeys, customerName: p.customerName, vehicle: p.vehicle,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ⭐ POST /api/service-data/dedupe — सचमुच जोड़कर duplicate हटाता है
// ⚠️ कोई जानकारी मिटती नहीं: सारे records के fields एक में जोड़े जाते हैं और
//    तारीख़ों में हमेशा नई तारीख़ रखी जाती है, ताकि कोई हुई सर्विस न छूटे.
router.post('/dedupe', async (req, res) => {
  try {
    const docs = await ServiceData.find().lean();
    const plan = planMerge(docs).filter(p => p.dropKeys.length > 0);
    if (!plan.length) return res.json({ ok: true, merged: 0, removed: 0, message: 'कोई duplicate नहीं मिला' });

    let removed = 0;
    for (const p of plan) {
      const keys = p.dropKeys.filter(k => normKey(k) !== p.keep || k !== p.keep);
      if (keys.length) {
        const r = await ServiceData.deleteMany({ regNo: { $in: keys } });
        removed += r.deletedCount || 0;
      }
      await ServiceData.findOneAndUpdate(
        { regNo: p.keep },
        { $set: { ...p.merged, regNo: p.keep } },
        { upsert: true, new: true }
      );
    }
    res.json({
      ok: true,
      merged: plan.length,
      removed,
      message: `${plan.length} गाड़ियों के ${removed} डुप्लिकेट record जोड़कर हटा दिए`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;