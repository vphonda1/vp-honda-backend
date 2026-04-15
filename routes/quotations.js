const router = require('express').Router();
const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema({
  quotationNo: String,
  customerName: String,
  fatherName: String,
  phone: String,
  address: String,
  vehicleModel: String,
  variant: String,
  color: String,
  status: { type: String, default: 'Hot' },
  followUpDate: String,
  notes: String,
  items: [{ name: String, amount: Number }],
  totalAmount: Number,
  discount: Number,
  finalAmount: Number,
  salesmanName: String,
  salesmanPhone: String,
  createdBy: String,
  createdAt: String,
  updatedAt: String,
}, { timestamps: true, strict: false });

const Quotation = mongoose.models.Quotation || mongoose.model('Quotation', quotationSchema);

router.get('/', async (req, res) => {
  try { res.json(await Quotation.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Quotation.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const q = await Quotation.findOneAndUpdate(
      { $or: [{ _id: req.params.id }, { quotationNo: req.params.id }] },
      req.body, { new: true }
    );
    res.json(q || { error: 'Not found' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Quotation.findOneAndDelete(
      { $or: [{ _id: req.params.id }, { quotationNo: req.params.id }] }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => {
  try {
    const list = req.body.quotations || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Quotation.deleteMany({});
    if (list.length > 0) await Quotation.insertMany(list);
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;