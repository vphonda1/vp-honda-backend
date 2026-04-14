const router = require('express').Router();
const Customer = require('../models/Customer');

// GET all customers
router.get('/sync',  (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — Add single customer
router.post('/', async (req, res) => {
  try {
    // Upsert: if same name+phone exists, update; otherwise create
    const { customerName, phone, name } = req.body;
    const cName = customerName || name || '';
    const cPhone = phone || '';
    
    if (cName && cPhone) {
      const existing = await Customer.findOne({ 
        $or: [
          { customerName: cName, phone: cPhone },
          { name: cName, phone: cPhone },
        ]
      });
      if (existing) {
        Object.assign(existing, req.body);
        await existing.save();
        return res.json(existing);
      }
    }
    
    const customer = await Customer.create(req.body);
    res.status(201).json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /sync — Bulk replace all customers (Excel import)
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.customers || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    
    // Delete ALL existing customers and insert fresh
    await Customer.deleteMany({});
    
    if (list.length > 0) {
      await Customer.insertMany(list, { ordered: false });
    }
    
    res.json({ success: true, count: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — Update customer
router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — Delete customer
router.delete('/:id', async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;