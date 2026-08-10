// routes/documents.js — VP Honda Document Vault API
const express  = require('express');
const router   = express.Router();
const VpDoc    = require('../models/VpDocument');

// GET all (without fileData for performance — load on demand)
router.get('/', async (req, res) => {
  try {
    const docs = await VpDoc.find({})
      .select('-fileData')  // fileData exclude (large base64)
      .sort({ createdAt: -1 })
      .lean();
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET single (with fileData)
router.get('/:id', async (req, res) => {
  try {
    const doc = await VpDoc.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST save
router.post('/', async (req, res) => {
  try {
    const doc = new VpDoc(req.body);
    await doc.save();
    // Return without fileData
    const { fileData, ...rest } = doc.toObject();
    res.status(201).json(rest);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await VpDoc.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
