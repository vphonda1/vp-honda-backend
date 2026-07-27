// routes/staffModules.js — VP Honda Penalty + Incentive + Leaderboard
const express   = require('express');
const router    = express.Router();
const Penalty   = require('../models/StaffPenalty');
const Incentive = require('../models/StaffIncentive');

// ── PENALTIES ──────────────────────────────────────────────────────────────
router.get('/penalties', async (req, res) => {
  try {
    const q = {};
    if (req.query.staffName) q.staffName = req.query.staffName;
    if (req.query.month)     q.month = +req.query.month;
    if (req.query.year)      q.year  = +req.query.year;
    const data = await Penalty.find(q).sort({ date: -1 }).lean();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/penalties', async (req, res) => {
  try {
    const d = new Date(req.body.date || new Date());
    const doc = new Penalty({ ...req.body, month: d.getMonth()+1, year: d.getFullYear() });
    await doc.save();
    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/penalties/:id', async (req, res) => {
  try { await Penalty.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── INCENTIVES ─────────────────────────────────────────────────────────────
router.get('/incentives', async (req, res) => {
  try {
    const q = {};
    if (req.query.staffName) q.staffName = req.query.staffName;
    if (req.query.month)     q.month = +req.query.month;
    if (req.query.year)      q.year  = +req.query.year;
    const data = await Incentive.find(q).sort({ date: -1 }).lean();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/incentives', async (req, res) => {
  try {
    const d = new Date(req.body.date || new Date());
    const amount = req.body.amount || (req.body.units * req.body.perUnit);
    const doc = new Incentive({ ...req.body, amount, month: d.getMonth()+1, year: d.getFullYear() });
    await doc.save();
    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/incentives/:id', async (req, res) => {
  try { await Incentive.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── LEADERBOARD (current month) ────────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const now = new Date();
    const m = req.query.month ? +req.query.month : now.getMonth()+1;
    const y = req.query.year  ? +req.query.year  : now.getFullYear();
    const [incentives, penalties] = await Promise.all([
      Incentive.find({ month: m, year: y }).lean(),
      Penalty.find({ month: m, year: y }).lean(),
    ]);
    // Group by staff
    const staffMap = {};
    incentives.forEach(i => {
      if (!staffMap[i.staffName]) staffMap[i.staffName] = { name:i.staffName, incentiveTotal:0, penaltyTotal:0, byCategory:{}, incentives:[], penalties:[] };
      staffMap[i.staffName].incentiveTotal += i.amount;
      staffMap[i.staffName].byCategory[i.category] = (staffMap[i.staffName].byCategory[i.category]||0) + i.amount;
      staffMap[i.staffName].incentives.push(i);
    });
    penalties.forEach(p => {
      if (!staffMap[p.staffName]) staffMap[p.staffName] = { name:p.staffName, incentiveTotal:0, penaltyTotal:0, byCategory:{}, incentives:[], penalties:[] };
      staffMap[p.staffName].penaltyTotal += p.amount;
      staffMap[p.staffName].penalties.push(p);
    });
    const board = Object.values(staffMap)
      .map(s => ({ ...s, netScore: s.incentiveTotal - s.penaltyTotal }))
      .sort((a,b) => b.netScore - a.netScore)
      .map((s, i) => ({ ...s, rank: i+1 }));
    res.json({ month: m, year: y, leaderboard: board });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SALARY SUMMARY (for a staff in a month) ──────────────────────────────
router.get('/salary-summary', async (req, res) => {
  try {
    const { staffName, month, year } = req.query;
    if (!staffName) return res.status(400).json({ error: 'staffName required' });
    const m = month ? +month : new Date().getMonth()+1;
    const y = year  ? +year  : new Date().getFullYear();
    const [penalties, incentives] = await Promise.all([
      Penalty.find({ staffName, month: m, year: y }).lean(),
      Incentive.find({ staffName, month: m, year: y }).lean(),
    ]);
    const penaltyTotal   = penalties.reduce((s,p)=>s+p.amount,0);
    const incentiveTotal = incentives.reduce((s,i)=>s+i.amount,0);
    res.json({ staffName, month: m, year: y, penaltyTotal, incentiveTotal, penalties, incentives });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
