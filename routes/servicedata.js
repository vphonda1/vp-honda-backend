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

module.exports = router;