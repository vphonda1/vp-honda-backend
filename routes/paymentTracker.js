// routes/paymentTracker.js — VP Honda Payment Tracker API
const express = require('express');
const router  = express.Router();
const PT      = require('../models/PaymentTracker');

// GET all (with optional filters)
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.status)     filter.status = req.query.status;
    if (req.query.type)       filter.type   = req.query.type;
    if (req.query.customerId) filter.customerId = req.query.customerId;
    const data = await PT.find(filter).sort({ updatedAt: -1 }).lean();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const doc = await PT.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    // financeAmount auto-compute
    if (!body.financeAmount && body.vehiclePrice && body.downPayment) {
      body.financeAmount = body.vehiclePrice - body.downPayment;
    }
    const doc = new PT(body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST add payment entry
router.post('/:id/payment', async (req, res) => {
  try {
    const { amount, date, mode, note, receivedBy } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
    const doc = await PT.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.entries.push({ amount: +amount, date: date || new Date(), mode: mode || 'cash', note, receivedBy });
    // Auto-update paidEmis for EMI type
    if (doc.type === 'emi' && doc.emiAmount > 0) {
      const totalPaid = doc.entries.reduce((s, e) => s + (e.amount || 0), 0);
      doc.paidEmis = Math.min(doc.totalEmis, Math.floor(totalPaid / doc.emiAmount));
    }
    // Auto-complete if fully paid
    const totalPaid = doc.entries.reduce((s, e) => s + (e.amount || 0), 0);
    const totalDue = doc.type === 'emi' ? doc.emiAmount * doc.totalEmis : doc.pendingAmount;
    if (totalPaid >= totalDue) doc.status = 'completed';
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH update
router.patch('/:id', async (req, res) => {
  try {
    const doc = await PT.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE payment entry
router.delete('/:id/payment/:entryId', async (req, res) => {
  try {
    const doc = await PT.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    doc.entries = doc.entries.filter(e => String(e._id) !== req.params.entryId);
    // Recalculate paidEmis
    if (doc.type === 'emi' && doc.emiAmount > 0) {
      const totalPaid = doc.entries.reduce((s, e) => s + (e.amount || 0), 0);
      doc.paidEmis = Math.floor(totalPaid / doc.emiAmount);
    }
    doc.status = 'active';
    await doc.save();
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE tracker
router.delete('/:id', async (req, res) => {
  try {
    await PT.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET summary stats
router.get('/summary/stats', async (req, res) => {
  try {
    const all = await PT.find({ status: { $ne: 'cancelled' } }).lean();
    const now = new Date(); now.setHours(0,0,0,0);
    let totalDue = 0, totalPaid = 0, overdueCount = 0, overdueAmount = 0, completedCount = 0;
    all.forEach(doc => {
      const paid = doc.entries.reduce((s, e) => s + (e.amount || 0), 0);
      const due  = doc.type === 'emi' ? doc.emiAmount * doc.totalEmis : doc.pendingAmount;
      totalDue  += due;
      totalPaid += paid;
      if (doc.status === 'completed') completedCount++;
      // Overdue: EMI type with overdue installments
      if (doc.type === 'emi' && doc.startDate) {
        const elapsed = Math.floor((now - new Date(doc.startDate)) / (30.44 * 24 * 3600 * 1000));
        const expectedPaid = Math.min(doc.totalEmis, elapsed + 1) * doc.emiAmount;
        if (paid < expectedPaid) {
          overdueCount++;
          overdueAmount += (expectedPaid - paid);
        }
      } else if (doc.type !== 'emi' && (due - paid) > 0) {
        overdueCount++;
        overdueAmount += (due - paid);
      }
    });
    res.json({ totalDue, totalPaid, totalRemaining: totalDue - totalPaid, overdueCount, overdueAmount, completedCount, total: all.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
