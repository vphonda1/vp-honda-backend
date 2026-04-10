const router = require('express').Router();
const ServiceCustomer = require('../models/ServiceCustomer');

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    res.json(await ServiceCustomer.find().sort({ createdAt: -1 }).limit(limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await ServiceCustomer.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const c = await ServiceCustomer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(c);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await ServiceCustomer.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
