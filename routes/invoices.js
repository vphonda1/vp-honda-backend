const router = require('express').Router();
const Invoice = require('../models/Invoice');

router.get('/', async (req, res) => {
  try { res.json(await Invoice.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findById(req.params.id);
    }
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Invoice.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await Invoice.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Bulk sync (for cross-device sync) ─────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.invoices || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Invoice.deleteMany({});
    if (list.length > 0) await Invoice.insertMany(list);
    res.json({ success: true, count: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;