// routes/salaryEntities.js
// IMPORTANT: Specific routes (/reset, /seed, /overview) MUST come before /:id routes
const express = require('express');
const router = express.Router();
const SalaryEntity = require('../models/SalaryEntity');
const SalaryPayment = require('../models/SalaryPayment');

// GET all entities
router.get('/', async (req, res) => {
  try {
    const entities = await SalaryEntity.find().sort({ type: 1, startDate: 1 });
    res.json(entities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SPECIFIC ROUTES (must come before /:id to prevent collision)
// ═══════════════════════════════════════════════════════════════════════════

// GET overview (for dashboard)
router.get('/overview', async (req, res) => {
  try {
    const entities = await SalaryEntity.find();
    const payments = await SalaryPayment.find();

    const overview = entities.map(e => {
      const pays = payments.filter(p => p.staffName === e.name);
      const totalPaid = pays.reduce((s, p) => s + (p.amount || 0), 0);

      const start = new Date(e.startDate);
      const end = e.endDate ? new Date(e.endDate) : new Date();
      const monthsActive = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + (end.getDate() >= start.getDate() ? 1 : 0));
      const expectedTotal = (e.monthlyAmount || 0) * monthsActive;
      const balance = expectedTotal - totalPaid;

      return {
        id: e._id, name: e.name, type: e.type,
        monthlyAmount: e.monthlyAmount,
        startDate: e.startDate, endDate: e.endDate, active: e.active,
        replaces: e.replaces, replacedBy: e.replacedBy,
        paymentCount: pays.length, totalPaid, monthsActive, expectedTotal, balance,
      };
    });

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST full reset — delete ALL entities and seeded payments
router.post('/reset', async (req, res) => {
  try {
    const entCount = await SalaryEntity.countDocuments();
    const payCount = await SalaryPayment.countDocuments({ seeded: true });
    await SalaryEntity.deleteMany({});
    await SalaryPayment.deleteMany({ seeded: true });
    res.json({ success: true, entitiesDeleted: entCount, paymentsDeleted: payCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk seed — used for first-time setup
router.post('/seed', async (req, res) => {
  try {
    const { entities = [], payments = [], overwrite = false } = req.body;

    if (overwrite) {
      await SalaryEntity.deleteMany({});
      await SalaryPayment.deleteMany({ seeded: true });
    }

    const entityResults = [];
    for (const e of entities) {
      const existing = await SalaryEntity.findOne({ name: e.name });
      if (!existing) {
        const ent = await SalaryEntity.create(e);
        entityResults.push(ent);
      }
    }

    let paymentsInserted = 0;
    for (const p of payments) {
      const existing = await SalaryPayment.findOne({
        staffName: p.staffName,
        paymentDate: p.paymentDate,
        amount: p.amount,
      });
      if (!existing) {
        await SalaryPayment.create({ ...p, seeded: true });
        paymentsInserted++;
      }
    }

    res.json({
      success: true,
      entitiesCreated: entityResults.length,
      paymentsInserted,
      totalEntities: await SalaryEntity.countDocuments(),
      totalPayments: await SalaryPayment.countDocuments(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create new entity
router.post('/', async (req, res) => {
  try {
    const { name, type, monthlyAmount, startDate, endDate, replaces, photo, notes } = req.body;
    if (!name || !type || !startDate) return res.status(400).json({ error: 'name, type, startDate required' });

    const existing = await SalaryEntity.findOne({ name });
    if (existing) return res.status(400).json({ error: 'Entity with this name already exists' });

    const entity = new SalaryEntity({
      name, type, monthlyAmount: monthlyAmount || 0, startDate,
      endDate: endDate || null, replaces: replaces || null,
      photo: photo || '', notes: notes || '',
      active: !endDate,
    });
    await entity.save();

    if (replaces) {
      await SalaryEntity.findOneAndUpdate(
        { name: replaces },
        { endDate: startDate, active: false, replacedBy: name }
      );
    }

    res.status(201).json(entity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES — must come LAST
// ═══════════════════════════════════════════════════════════════════════════

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.endDate) updates.active = false;
    const entity = await SalaryEntity.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(entity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const entity = await SalaryEntity.findById(req.params.id);
    if (!entity) return res.status(404).json({ error: 'Not found' });
    await SalaryPayment.deleteMany({ staffName: entity.name });
    await SalaryEntity.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;