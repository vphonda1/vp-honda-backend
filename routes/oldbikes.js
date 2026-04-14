const router = require('express').Router();
const mongoose = require('mongoose');

const oldBikeSchema = new mongoose.Schema({
  exchangeCustName: String, exchangeFathName: String,
  exchangeCustMob: String, exchangeCustAadhar: String,
  exchangeCustAddress: String, exchangeDate: String,
  regOwnerName: String, regFatherName: String, regOwnerMob: String,
  veh: String, mdl: String, regNo: String,
  engineNo: String, chassisNo: String, color: String, year: String,
  psPrice: Number, exchangeNotes: String,
  status: { type: String, default: 'Available' },
  buyerName: String, buyerFather: String, buyerMob: String,
  buyerAadhar: String, buyerAddress: String,
  slPrice: Number, sellDate: String, sellNotes: String,
  custName: String, custMob: String,
}, { timestamps: true, strict: false });

const OldBike = mongoose.models.OldBike || mongoose.model('OldBike', oldBikeSchema);

router.get('/', async (req, res) => {
  try { res.json(await OldBike.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => {
  try {
    const bikes = req.body.bikes || req.body;
    if (!Array.isArray(bikes)) return res.status(400).json({ error: 'Array required' });
    await OldBike.deleteMany({});
    if (bikes.length > 0) await OldBike.insertMany(bikes);
    res.json({ success: true, count: bikes.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await OldBike.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await OldBike.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;