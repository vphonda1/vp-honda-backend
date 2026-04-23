// ════════════════════════════════════════════════════════════
// routes/followups.js — Cross-device Follow-up Sync
// ════════════════════════════════════════════════════════════
// server.js में add करें:
//   app.use('/api/follow-ups', require('./routes/followups'));
// ════════════════════════════════════════════════════════════

const router    = require('express').Router();
const mongoose  = require('mongoose');

let FollowUp;
try { FollowUp = mongoose.model('FollowUp'); } catch {
  FollowUp = mongoose.model('FollowUp', new mongoose.Schema({
    reminderId:   { type: String, index: true },
    customerName: { type: String, default: '' },
    phone:        { type: String, default: '' },
    regNo:        { type: String, default: '', index: true },
    date:         { type: String, default: '' },
    status:       { type: String, default: 'called' },
    note:         { type: String, default: '' },
    nextCallDate: { type: String, default: null },
    by:           { type: String, default: 'Admin' },
  }, { timestamps: true }));
}

// GET all follow-ups — used for cross-device sync on every loadAll()
router.get('/', async (req, res) => {
  try {
    const list = await FollowUp.find()
      .sort({ date: -1 })
      .limit(5000)
      .lean();
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET follow-ups for a specific reminder
router.get('/:reminderId', async (req, res) => {
  try {
    const list = await FollowUp.find({ reminderId: req.params.reminderId })
      .sort({ date: 1 })
      .lean();
    res.json(list);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST — save new follow-up (called from any device)
router.post('/', async (req, res) => {
  try {
    const entry = await FollowUp.create(req.body);
    res.status(201).json(entry);
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// DELETE all for a reminderId (when service is marked done)
router.delete('/:reminderId', async (req, res) => {
  try {
    const r = await FollowUp.deleteMany({ reminderId: req.params.reminderId });
    res.json({ success: true, deleted: r.deletedCount });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;