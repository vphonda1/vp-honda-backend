const router = require('express').Router();
const Reminder = require('../models/Reminder');

router.get('/', async (req, res) => {
  try { res.json(await Reminder.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    let r = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) r = await Reminder.findById(req.params.id);
    if (!r) r = await Reminder.findOne({ invoiceId: req.params.id });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Reminder.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const r = await Reminder.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
