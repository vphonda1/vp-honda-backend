const router  = require('express').Router();
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
const path    = require('path');
const fs      = require('fs');
const Invoice = require('../models/Invoice');

// ════════════════════════════════════════════════════════════
// LocalCMapReader — reads .bcmap files from pdfjs-dist package
// Required for Excel PDF Identity-H font decoding
// ════════════════════════════════════════════════════════════
class LocalCMapReader {
  constructor({ baseUrl, isCompressed }) {
    this._dir        = baseUrl;
    this._compressed = isCompressed;
  }
  async fetch({ name }) {
    const file = path.join(this._dir, name + (this._compressed ? '.bcmap' : ''));
    const data = fs.readFileSync(file);
    return {
      cMapData:        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      compressionType: this._compressed ? 1 : 0,
    };
  }
}

// ════════════════════════════════════════════════════════════
// Garbled text detector — pdf-parse often returns garbage
// for Excel PDFs with Identity-H font encoding
// ════════════════════════════════════════════════════════════
const isGarbled = (text) => {
  if (!text || text.trim().length < 30) return true;
  // Must contain recognizable invoice keywords
  const keywords = /invoice|hsn|part|honda|total|gst|cgst|sgst|customer|vehicle|narsinghgarh|vphonda|bhopal|₹/i;
  if (keywords.test(text)) return false;
  // Check Latin character ratio — garbled text has very low ratio
  const latin = (text.match(/[a-zA-Z0-9]/g) || []).length;
  return (latin / text.length) < 0.25;
};

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION — 3 methods, best to worst
// Method 1: pdfjs-dist + LocalCMapReader (best for Excel PDFs)
// Method 2: pdf-parse (fallback, works for simple PDFs)
// Method 3: OCR via ocr.space API (last resort)
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer, filename) => {

  // ── Method 1: pdfjs-dist with LocalCMapReader ─────────────────────────────
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsDir  = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const cmapDir   = path.join(pdfjsDir, 'cmaps');

    const uint8 = new Uint8Array(pdfBuffer);
    const pdf   = await pdfjsLib.getDocument({
      data:              uint8,
      CMapReaderFactory: LocalCMapReader,
      cMapUrl:           cmapDir,
      cMapPacked:        true,
      verbosity:         0,
    }).promise;

    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      text += tc.items.map(i => i.str).join(' ') + '\n';
    }

    if (text.trim().length > 50 && !isGarbled(text)) {
      console.log(`✅ pdfjs-dist: ${text.length} chars from ${filename}`);
      return text;
    }
    console.log(`⚠️ pdfjs-dist returned garbled/short text, trying pdf-parse...`);
  } catch (e1) {
    console.warn('⚠️ pdfjs-dist failed:', e1.message);
  }

  // ── Method 2: pdf-parse ───────────────────────────────────────────────────
  try {
    const PDFParser = require('pdf-parse');
    const data = await PDFParser(pdfBuffer);
    if (data.text && data.text.trim().length > 50 && !isGarbled(data.text)) {
      console.log(`✅ pdf-parse: ${data.text.length} chars from ${filename}`);
      return data.text;
    }
    console.log(`⚠️ pdf-parse returned garbled/short text, trying OCR...`);
  } catch (e2) {
    console.warn('⚠️ pdf-parse failed:', e2.message);
  }

  // ── Method 3: OCR via ocr.space ──────────────────────────────────────────
  try {
    const axios    = require('axios');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', pdfBuffer, { filename });
    form.append('apikey', 'K85340860888957');
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true');

    const res = await axios.post('https://api.ocr.space/parse/image', form, {
      headers: form.getHeaders(),
      timeout: 120000,
    });

    if (!res.data.IsErroredOnProcessing) {
      const ocrText = res.data.ParsedResults.map(r => r.ParsedText).join('\n');
      if (ocrText && ocrText.trim().length > 50) {
        console.log(`✅ OCR: ${ocrText.length} chars from ${filename}`);
        return ocrText;
      }
    }
  } catch (e3) {
    console.warn('⚠️ OCR failed:', e3.message);
  }

  throw new Error('PDF se text extract nahi hua (all 3 methods failed)');
};

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  try { res.json(await Invoice.find().sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findById(req.params.id);
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    delete body._id;
    const invNo = body.invoiceNumber;
    let inv;
    if (invNo) {
      inv = await Invoice.findOneAndUpdate(
        { invoiceNumber: String(invNo) },
        { $set: body },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else { inv = await Invoice.create(body); }
    res.status(201).json(inv);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

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

router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    let result;
    if (type === 'vehicle')      result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else                         result = await Invoice.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => {
  try {
    const list = req.body.invoices || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Invoice.deleteMany({});
    if (list.length) await Invoice.insertMany(list, { ordered: false });
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════
// POST /api/invoices/parse-pdf
// Returns full raw text → frontend parseVPHondaInvoice() parses it
// ════════════════════════════════════════════════════════════
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 ${req.file.originalname} (${req.file.size} bytes)`);

    const text = await extractTextFromPDF(req.file.buffer, req.file.originalname);
    res.json({ success: true, text, filename: req.file.originalname });

  } catch (err) {
    console.error('❌ parse-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;