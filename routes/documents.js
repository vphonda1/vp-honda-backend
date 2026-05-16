// routes/documents.js — VP Honda Document Vault (MongoDB)
const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');

// ── Schema ────────────────────────────────────────────────────────────────────
const DocSchema = new mongoose.Schema({
  folder:        { type: String, required: true, index: true },
  customerName:  { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  aadharNo:      { type: String, default: '' },
  vehicleModel:  { type: String, default: '' },
  chassisNo:     { type: String, default: '' },
  nomineeName:   { type: String, default: '' },      // ✅ Nominee
  hypothecation: { type: String, default: '' },      // ✅ Bank/Financer
  docType:       { type: String, required: true },
  docTypeLabel:  { type: String, default: '' },
  docIcon:       { type: String, default: '📄' },
  expiryDate:    { type: String, default: '' },
  notes:         { type: String, default: '' },
  fileData:      { type: String, required: true },   // ✅ base64 (image/pdf/video)
  fileType:      { type: String, default: 'image' }, // ✅ 'image' | 'pdf' | 'video'
  fileName:      { type: String, default: '' },
  fileSize:      { type: String, default: '' },
  savedAt:       { type: Date, default: Date.now },
}, { timestamps: true });

const Doc = mongoose.models.VPDocument || mongoose.model('VPDocument', DocSchema);

// ── GET /api/documents — list (without fileData for performance) ──────────────
router.get('/', async (req, res) => {
  try {
    const { folder, customerName } = req.query;
    const query = {};
    if (folder)       query.folder       = folder;
    if (customerName) query.customerName = new RegExp(customerName, 'i');

    // Exclude fileData from list — fetch individually when needed
    const docs = await Doc.find(query)
      .sort({ savedAt: -1 })
      .select('-fileData')
      .lean();

    // Map _id → id for frontend compatibility
    res.json(docs.map(d => ({ ...d, id: d._id.toString() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/documents/:id — single with fileData ─────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await Doc.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ...doc, id: doc._id.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/documents — save ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { customerName, fileData, docType } = req.body;
    if (!customerName) return res.status(400).json({ error: 'customerName required' });
    if (!fileData)     return res.status(400).json({ error: 'fileData required' });

    // Calculate file size
    const sizeKB = Math.round(fileData.length * 0.75 / 1024);
    const doc = await Doc.create({ ...req.body, fileSize: `${sizeKB} KB` });

    console.log(`[Docs] Saved: ${doc.docTypeLabel} for ${doc.customerName} (${sizeKB}KB) [${doc.fileType}]`);

    // Return without fileData (client already has it)
    const { fileData: _, ...rest } = doc.toObject();
    res.status(201).json({ ...rest, id: doc._id.toString() });
  } catch (err) {
    console.error('[Docs] Save error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await Doc.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/documents/stats/summary ──────────────────────────────────────────
router.get('/stats/summary', async (req, res) => {
  try {
    const total     = await Doc.countDocuments();
    const customers = (await Doc.distinct('customerName')).length;
    res.json({ total, customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;