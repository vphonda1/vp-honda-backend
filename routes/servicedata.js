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

module.exports = router;