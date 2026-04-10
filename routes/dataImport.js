const router = require('express').Router();
const multer = require('multer');
const Customer = require('../models/Customer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/import-vehicle-data — Bulk import from frontend
router.post('/import-vehicle-data', upload.single('file'), async (req, res) => {
  try {
    // Frontend sends JSON data in body
    let records = [];
    if (req.body.customers) {
      records = Array.isArray(req.body.customers) ? req.body.customers : JSON.parse(req.body.customers);
    } else if (req.body.data) {
      records = Array.isArray(req.body.data) ? req.body.data : JSON.parse(req.body.data);
    }

    if (!records.length) return res.status(400).json({ error: 'No data to import' });

    let imported = 0, errors = 0;
    for (const rec of records) {
      try {
        await Customer.create(rec);
        imported++;
      } catch (err) {
        errors++;
        console.error('Import row error:', err.message);
      }
    }

    res.json({ success: true, imported, errors, total: records.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export-customer-data — Export all customers as JSON
router.get('/export-customer-data', async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
