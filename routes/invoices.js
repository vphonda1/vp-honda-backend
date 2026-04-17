const router  = require('express').Router();
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
const path    = require('path');
const Invoice = require('../models/Invoice');

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION
// Uses pdfjs-dist@3.11.174 legacy CommonJS build (no ESM issues)
// Install: npm install pdfjs-dist@3.11.174
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer) => {
  // ── Method 1: pdfjs-dist v3 legacy (CommonJS, handles Excel PDFs) ──
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const cMapUrl  = path.join(pdfjsDir, 'cmaps') + path.sep;
    const stdFonts = path.join(pdfjsDir, 'standard_fonts') + path.sep;

    const uint8 = new Uint8Array(pdfBuffer);
    const pdf   = await pdfjsLib.getDocument({
      data: uint8,
      cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: stdFonts,
      verbosity: 0,
    }).promise;

    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      text += tc.items.map(i => i.str).join(' ') + '\n';
    }

    if (text.trim().length > 10) {
      console.log(`✅ pdfjs-dist: ${text.length} chars`);
      return text;
    }
    throw new Error('pdfjs returned empty text');

  } catch (e1) {
    console.warn('⚠️ pdfjs-dist/legacy failed:', e1.message);
  }

  // ── Method 2: pdf-parse fallback ──
  try {
    const PDFParser = require('pdf-parse');
    const data = await PDFParser(pdfBuffer);
    if (data.text && data.text.trim().length > 10) {
      console.log(`✅ pdf-parse: ${data.text.length} chars`);
      return data.text;
    }
    throw new Error('pdf-parse returned empty text');
  } catch (e2) {
    console.error('❌ Both extractors failed:', e2.message);
    throw new Error('PDF se text extract nahi hua: ' + e2.message);
  }
};

// ════════════════════════════════════════════════════════════
// GET /api/invoices
// ════════════════════════════════════════════════════════════
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

// POST /api/invoices — upsert by invoiceNumber
router.post('/', async (req, res) => {
  try {
    const body  = req.body;
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
    if (type === 'vehicle')      result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else                         result = await Invoice.deleteMany({});
    console.log(`🗑️ Cleared ${result.deletedCount} (type: ${type})`);
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

// ════════════════════════════════════════════════════════════
// POST /api/invoices/parse-pdf — returns full raw text
// ════════════════════════════════════════════════════════════
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