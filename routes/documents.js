// routes/documents.js
const express = require('express');
const router = express.Router();
const Document = require('../models/Document');

// GET all documents (latest first)
router.get('/', async (req, res) => {
  try {
    const docs = await Document.find().sort({ savedAt: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new document
router.post('/', async (req, res) => {
  try {
    const doc = new Document(req.body);
    await doc.save();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE document by id
router.delete('/:id', async (req, res) => {
  try {
    await Document.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;