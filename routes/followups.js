// routes/followups.js — Follow-up log MongoDB route
// server.js में add करो: app.use('/api/follow-ups', require('./routes/followups'));

const router = require('express').Router();
const mongoose = require('mongoose');

let FollowUp;
try { FollowUp = mongoose.model('FollowUp'); } catch {
  FollowUp = mongoose.model('FollowUp', new mongoose.Schema({
    reminderId:   { type: String, index: true },
    customerName: { type: String, default: '' },
    phone:        { type: String, default: '' },
    regNo:        { type: String, default: '' },
    date:         { type: String, default: '' },
    status:       { type: String, default: 'called' },
    note:         { type: String, default: '' },
    nextCallDate: { type: String, default: null },
    by:           { type: String, default: 'Admin' },
  }, { timestamps: true }));
}

// GET all follow-ups (for cross-device sync)
router.get('/', async (req, res) => {
  try {
    const list = await FollowUp.find().sort({ date: -1 }).limit(2000);
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET follow-ups for specific reminderId
router.get('/:reminderId', async (req, res) => {
  try {
    const list = await FollowUp.find({ reminderId: req.params.reminderId }).sort({ date: 1 });
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST — save a follow-up entry
router.post('/', async (req, res) => {
  try {
    const entry = await FollowUp.create(req.body);
    res.status(201).json(entry);
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// DELETE all follow-ups for a reminderId
router.delete('/:reminderId', async (req, res) => {
  try {
    await FollowUp.deleteMany({ reminderId: req.params.reminderId });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;