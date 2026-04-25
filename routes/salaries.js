// routes/salaries.js — Staff salary, advance, bonus tracking
// IMPORTANT: Specific routes (/summary/:staffId, /overview) MUST come before /:id
const router = require('express').Router();
const SalaryPayment = require('../models/SalaryPayment');
const mongoose = require('mongoose');

// Get Staff model (already defined in routes/staff.js)
let Staff;
try { Staff = mongoose.model('Staff'); } catch {}

// ── GET all payments (or filter) ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const q = { cancelled: { $ne: true } };
    if (req.query.staffId)  q.staffId = req.query.staffId;
    if (req.query.type)     q.type    = req.query.type;
    if (req.query.forMonth) q.forMonth = parseInt(req.query.forMonth);
    if (req.query.forYear)  q.forYear  = parseInt(req.query.forYear);
    if (req.query.from || req.query.to) {
      q.paymentDate = {};
      if (req.query.from) q.paymentDate.$gte = req.query.from;
      if (req.query.to)   q.paymentDate.$lte = req.query.to;
    }
    const list = await SalaryPayment.find(q).sort({ paymentDate: -1, createdAt: -1 }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES (must come before /:id to prevent collision)
// ════════════════════════════════════════════════════════════════════════════

// ── Overview of all staff salary status ──────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    const allPayments = await SalaryPayment.find({ cancelled: { $ne: true } }).lean();
    const grouped = {};
    allPayments.forEach(p => {
      if (!grouped[p.staffId]) grouped[p.staffId] = { staffId: p.staffId, staffName: p.staffName, totalPaid: 0, totalAdvance: 0, currentMonthPaid: 0, lastPaymentDate: null };
      const g = grouped[p.staffId];
      const amt = Number(p.amount || 0);
      if (p.type === 'salary')   g.totalPaid    += amt;
      if (p.type === 'advance')  g.totalAdvance += amt;
      if (p.type === 'salary' && p.forMonth === curMonth && p.forYear === curYear) g.currentMonthPaid += amt;
      if (!g.lastPaymentDate || p.paymentDate > g.lastPaymentDate) g.lastPaymentDate = p.paymentDate;
    });
    res.json(Object.values(grouped));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SUMMARY for a staff member ───────────────────────────────────────────────
router.get('/summary/:staffId', async (req, res) => {
  try {
    const all = await SalaryPayment.find({ staffId: req.params.staffId, cancelled: { $ne: true } }).lean();

    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();

    let totalPaid = 0, totalAdvance = 0, totalBonus = 0, totalIncentive = 0, totalDeduction = 0;
    let currentMonthPaid = 0;
    const byMonth = {};

    all.forEach(p => {
      const amt = Number(p.amount || 0);
      if (p.type === 'salary')    totalPaid += amt;
      if (p.type === 'advance')   totalAdvance += amt;
      if (p.type === 'bonus')     totalBonus += amt;
      if (p.type === 'incentive') totalIncentive += amt;
      if (p.type === 'deduction') totalDeduction += amt;
      if (p.forMonth === curMonth && p.forYear === curYear && p.type === 'salary') {
        currentMonthPaid += amt;
      }
      const key = `${p.forYear}-${String(p.forMonth).padStart(2,'0')}`;
      if (!byMonth[key]) byMonth[key] = { month: p.forMonth, year: p.forYear, salary: 0, advance: 0, bonus: 0, incentive: 0, deduction: 0 };
      byMonth[key][p.type] = (byMonth[key][p.type] || 0) + amt;
    });

    // Get monthly salary for advance pending calc
    let monthlySalary = 0;
    if (Staff) {
      try {
        const staff = await Staff.findOne({ $or: [{ staffId: parseInt(req.params.staffId) }, { _id: mongoose.isValidObjectId(req.params.staffId) ? req.params.staffId : null }].filter(Boolean) });
        if (staff) monthlySalary = Number(staff.monthlySalary || 0);
      } catch {}
    }

    const advancePending = totalAdvance - totalDeduction;

    res.json({
      staffId: req.params.staffId,
      monthlySalary,
      totalPaid, totalAdvance, totalBonus, totalIncentive, totalDeduction,
      currentMonthPaid,
      currentMonthDue: Math.max(0, monthlySalary - currentMonthPaid),
      advancePending,
      byMonth: Object.values(byMonth).sort((a,b) => (b.year - a.year) || (b.month - a.month)),
      totalRecords: all.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST new payment ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.paymentDate) body.paymentDate = new Date().toISOString().split('T')[0];
    if (!body.forMonth)    body.forMonth    = new Date().getMonth() + 1;
    if (!body.forYear)     body.forYear     = new Date().getFullYear();
    const p = await SalaryPayment.create(body);
    res.status(201).json(p);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES — must come LAST
// ════════════════════════════════════════════════════════════════════════════

// ── PUT update ───────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const p = await SalaryPayment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE (soft via cancelled flag) ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const p = await SalaryPayment.findByIdAndUpdate(req.params.id, { cancelled: true }, { new: true });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;