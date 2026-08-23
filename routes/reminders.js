const router   = require('express').Router();
const Reminder = require('../models/Reminder');

// ── सारे manual reminders (status से filter कर सकते हैं) ──────────────────
router.get('/', async (req, res) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.assignedTo) q.assignedTo = req.query.assignedTo;
    res.json(await Reminder.find(q).sort({ dueDate: 1, createdAt: -1 }).lean());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    let r = null;
    if (/^[0-9a-fA-F]{24}$/.test(req.params.id)) r = await Reminder.findById(req.params.id).lean();
    if (!r) r = await Reminder.findOne({ invoiceId: req.params.id }).lean();
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── नया manual reminder ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!req.body?.title) return res.status(400).json({ error: 'title ज़रूरी है' });
    res.status(201).json(await Reminder.create({ ...req.body, type: req.body.type || 'manual' }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await Reminder.findByIdAndUpdate(req.params.id, req.body, { new: true })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ── ⭐ एक tap में पूरा हुआ ──────────────────────────────────────────────────
router.patch('/:id/complete', async (req, res) => {
  try {
    const r = await Reminder.findByIdAndUpdate(req.params.id, {
      $set: {
        status: 'completed',
        completedAt: new Date().toISOString(),
        completedBy: req.body?.by || '',
        snoozeUntil: null,
      },
    }, { new: true });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── ⭐ बाद में (कल / 3 दिन / अपनी तारीख़) ────────────────────────────────────
router.patch('/:id/snooze', async (req, res) => {
  try {
    const { until } = req.body || {};
    if (!until) return res.status(400).json({ error: 'until (YYYY-MM-DD) ज़रूरी है' });
    const r = await Reminder.findByIdAndUpdate(req.params.id,
      // notifiedRungs साफ़ — नई तारीख़ पर notification फिर से चलेंगी
      { $set: { snoozeUntil: until, notifiedRungs: [] } }, { new: true });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── वापस चालू ──────────────────────────────────────────────────────────────
router.patch('/:id/reopen', async (req, res) => {
  try {
    const r = await Reminder.findByIdAndUpdate(req.params.id,
      { $set: { status: 'pending', completedAt: null, snoozeUntil: null, notifiedRungs: [] } }, { new: true });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const out = await Reminder.deleteOne({ _id: req.params.id });
    res.json({ ok: true, deleted: out.deletedCount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
