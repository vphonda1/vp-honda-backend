const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const PDFParser = require('pdf-parse');
const Invoice = require('../models/Invoice');

// ══════════════════════════════════════════════════════════════
// HELPER: Extract text from PDF buffer using pdf-parse (native)
// Excel-generated PDFs are text-based — OCR not needed
// ══════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await PDFParser(pdfBuffer);
    return data.text;
  } catch (err) {
    console.warn('⚠️ PDF-parse failed:', err.message);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════
// GET /api/invoices — fetch all invoices, newest first
// ══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/invoices/:id — fetch single invoice by _id or invoiceNumber
// ══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findById(req.params.id);
    }
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/invoices — create or update invoice (upsert by invoiceNumber)
// Prevents duplicate key errors on repeated import
// ══════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const invNo = body.invoiceNumber;
    let inv;
    if (invNo) {
      // Upsert: if same invoiceNumber exists, update it
      inv = await Invoice.findOneAndUpdate(
        { invoiceNumber: String(invNo) },
        { $set: body },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      inv = await Invoice.create(body);
    }
    res.status(201).json(inv);
  } catch (err) {
    console.error('❌ Invoice save error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/invoices/:id — update invoice
// ══════════════════════════════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    }
    if (!inv) inv = await Invoice.findOneAndUpdate(
      { invoiceNumber: req.params.id }, req.body, { new: true }
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// DELETE /api/invoices/:id — delete single invoice
// Accepts MongoDB _id OR invoiceNumber
// ══════════════════════════════════════════════════════════════
router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findByIdAndDelete(req.params.id);
    }
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/invoices/sync — bulk replace all invoices
// ══════════════════════════════════════════════════════════════
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.invoices || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Invoice.deleteMany({});
    if (list.length > 0) await Invoice.insertMany(list);
    res.json({ success: true, count: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/invoices/clear — delete by type: 'vehicle', 'service', or 'all'
// Used by Clear Vehicle / Clear Service / Clear All buttons
// ══════════════════════════════════════════════════════════════
router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    let result;
    if (type === 'vehicle') {
      result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    } else if (type === 'service') {
      result = await Invoice.deleteMany({ invoiceType: 'service' });
    } else {
      // 'all' or any other value → delete everything
      result = await Invoice.deleteMany({});
    }
    console.log(`🗑️ Cleared ${result.deletedCount} invoices (type: ${type})`);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/invoices/parse-pdf — extract raw text from PDF
// Returns full text to frontend for parseVPHondaInvoice() parsing
// Excel-generated PDFs (text-based) — pdf-parse works perfectly
// ══════════════════════════════════════════════════════════════
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    console.log(`\n📄 parse-pdf: ${req.file.originalname} (${req.file.size} bytes)`);

    const text = await extractTextFromPDF(req.file.buffer);

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'PDF से text extract नहीं हुआ' });
    }

    console.log(`✅ Extracted ${text.length} chars from ${req.file.originalname}`);

    // Return FULL raw text — frontend parseVPHondaInvoice() will parse it
    res.json({
      success: true,
      text: text,                        // ← full text, not truncated
      filename: req.file.originalname,
    });

  } catch (err) {
    console.error('❌ parse-pdf error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;