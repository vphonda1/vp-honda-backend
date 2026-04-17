const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const Invoice = require('../models/Invoice');

// PDF TEXT EXTRACTION — pdfjs-dist Node.js + pdf-parse fallback
const extractTextFromPDF = async (pdfBuffer) => {
  // Method 1: pdfjs-dist (best for Excel PDFs, no worker in Node.js)
  try {
    const pdfjs = await import('pdfjs-dist');
    const uint8 = new Uint8Array(pdfBuffer);
    const pdf = await pdfjs.getDocument({ data: uint8, useSystemFonts: true, verbosity: 0 }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map(i => i.str).join(' ') + '\n';
    }
    if (text.trim().length > 20) {
      console.log(`✅ pdfjs-dist: ${text.length} chars`);
      return text;
    }
    throw new Error('empty text');
  } catch (e1) {
    console.warn('⚠️ pdfjs-dist failed:', e1.message);
  }

  // Method 2: pdf-parse fallback
  try {
    const PDFParser = require('pdf-parse');
    const data = await PDFParser(pdfBuffer);
    if (data.text && data.text.trim().length > 20) {
      console.log(`✅ pdf-parse: ${data.text.length} chars`);
      return data.text;
    }
    throw new Error('empty text');
  } catch (e2) {
    throw new Error('PDF text extract failed: ' + e2.message);
  }
};

// GET /api/invoices
router.get('/', async (req, res) => {
  try { res.json(await Invoice.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/invoices/:id
router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findById(req.params.id);
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices — upsert (no duplicate key errors)
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const invNo = body.invoiceNumber;
    let inv;
    if (invNo) {
      inv = await Invoice.findOneAndUpdate(
        { invoiceNumber: String(invNo) },
        { $set: body },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      inv = await Invoice.create(body);
    }
    res.status(201).json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PUT /api/invoices/:id
router.put('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/))
      inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!inv)
      inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/clear — type: 'vehicle' | 'service' | 'all'
router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    let result;
    if (type === 'vehicle') result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else result = await Invoice.deleteMany({});
    console.log(`🗑️ Cleared ${result.deletedCount} (type:${type})`);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/sync
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.invoices || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Invoice.deleteMany({});
    if (list.length > 0) await Invoice.insertMany(list);
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/parse-pdf — return full raw text to frontend
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 ${req.file.originalname} (${req.file.size} bytes)`);
    const text = await extractTextFromPDF(req.file.buffer);
    res.json({ success: true, text, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ parse-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;