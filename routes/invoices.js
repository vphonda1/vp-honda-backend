const router = require('express').Router();
const mongoose = require('mongoose');

// Use existing model or create new
let Invoice;
try {
  Invoice = mongoose.model('Invoice');
} catch {
  const invoiceSchema = new mongoose.Schema({
    invoiceNumber: { type: String, index: true },
    invoiceType: { type: String, default: 'service' },
    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    customerId: { type: String, default: '' },
    vehicle: { type: String, default: '' },
    regNo: { type: String, default: '' },
    frameNo: { type: String, default: '' },
    engineNo: { type: String, default: '' },
    invoiceDate: { type: String, default: '' },
    paymentMode: { type: String, default: 'CASH' },
    serviceKm: { type: Number, default: 0 },
    serviceType: { type: String, default: '' },
    serviceNumber: { type: Number, default: null },
    items: [{ type: mongoose.Schema.Types.Mixed }],
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    importedFrom: { type: String, default: '' },
    importedAt: { type: String, default: '' },
    status: { type: String, default: 'Active' },
    source: { type: String, default: '' },
  }, { timestamps: true, strict: false });
  Invoice = mongoose.model('Invoice', invoiceSchema);
}

// GET all
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET by id or invoiceNumber
router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findById(req.params.id);
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — upsert by invoiceNumber
router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    // Remove fields that cause ObjectId cast errors
    delete body._id;
    if (body.customerId && !body.customerId.match(/^[0-9a-fA-F]{24}$/)) {
      // Keep as string, don't let mongoose try to cast
    }
    const invNo = body.invoiceNumber;
    let inv;
    if (invNo) {
      inv = await Invoice.findOneAndUpdate(
        { invoiceNumber: String(invNo) },
        { $set: body },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      inv = await Invoice.create(body);
    }
    res.status(201).json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT
router.put('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!inv) inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /clear — clear by type or all
router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    let result;
    if (type === 'vehicle') result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else result = await Invoice.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /sync — bulk replace
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.invoices || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Invoice.deleteMany({});
    if (list.length) await Invoice.insertMany(list, { ordered: false });
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;