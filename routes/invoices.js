const router  = require('express').Router();
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
const path    = require('path');
const Invoice = require('../models/Invoice');

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION
// pdfjs-dist@3.11.174 with NodeCMapReaderFactory
// This is REQUIRED for Excel PDF font encoding (Identity-H)
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer) => {

  // ── Method 1: pdfjs-dist legacy + NodeCMapReaderFactory ──
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));

    // NodeCMapReaderFactory reads local cmap files — decodes Excel fonts
    const { NodeCMapReaderFactory, NodeStandardFontDataFactory } = pdfjsLib;

    const cMapUrl      = path.join(pdfjsDir, 'cmaps')          + '/';
    const stdFontUrl   = path.join(pdfjsDir, 'standard_fonts') + '/';

    const uint8 = new Uint8Array(pdfBuffer);
    const pdf   = await pdfjsLib.getDocument({
      data:                    uint8,
      CMapReaderFactory:       NodeCMapReaderFactory,
      cMapUrl:                 cMapUrl,
      cMapPacked:              true,
      StandardFontDataFactory: NodeStandardFontDataFactory,
      standardFontDataUrl:     stdFontUrl,
      verbosity:               0,
    }).promise;

    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc   = await page.getTextContent();
      text += tc.items.map(i => i.str).join(' ') + '\n';
    }

    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length > 20) {
      console.log(`✅ pdfjs NodeCMap: ${clean.length} chars`);
      return text;
    }
    throw new Error('pdfjs returned empty/short text');

  } catch (e1) {
    console.warn('⚠️ pdfjs/legacy failed:', e1.message);
  }

  // ── Method 2: pdf-parse fallback ──
  try {
    const PDFParser = require('pdf-parse');
    const data = await PDFParser(pdfBuffer);
    const clean = (data.text || '').replace(/\s+/g, ' ').trim();
    if (clean.length > 20) {
      console.log(`✅ pdf-parse: ${clean.length} chars`);
      return data.text;
    }
    throw new Error('pdf-parse returned empty text');
  } catch (e2) {
    console.warn('⚠️ pdf-parse failed:', e2.message);
  }

  // ── Method 3: Raw binary extraction (last resort) ──
  try {
    const text = extractTextRaw(pdfBuffer);
    if (text.length > 20) {
      console.log(`✅ raw extraction: ${text.length} chars`);
      return text;
    }
    throw new Error('raw extraction empty');
  } catch (e3) {
    console.error('❌ All methods failed:', e3.message);
    throw new Error('PDF se text extract nahi hua');
  }
};

// Raw binary PDF text extractor (handles compressed streams)
const extractTextRaw = (pdfBuffer) => {
  const zlib = require('zlib');
  let allText = '';
  let pos = 0;

  while (pos < pdfBuffer.length) {
    const si = pdfBuffer.indexOf('stream', pos);
    if (si === -1) break;

    let ds = si + 6;
    if (pdfBuffer[ds] === 0x0D) ds++;
    if (pdfBuffer[ds] === 0x0A) ds++;

    const ei = pdfBuffer.indexOf('endstream', ds);
    if (ei === -1) break;

    const streamData = pdfBuffer.slice(ds, ei);
    let content = '';

    try { content = zlib.inflateSync(streamData).toString('latin1'); }
    catch { try { content = zlib.inflateRawSync(streamData).toString('latin1'); }
    catch { content = streamData.toString('latin1'); } }

    const blocks = content.match(/BT[\s\S]*?ET/g) || [];
    for (const block of blocks) {
      // String literals: (text)Tj
      for (const m of block.matchAll(/\(([^)]*)\)\s*(?:Tj|')/g))
        allText += m[1] + ' ';
      // Hex: <hex>Tj — handles Identity-H Unicode
      for (const m of block.matchAll(/<([0-9A-Fa-f]{4,})>\s*(?:Tj|')/g)) {
        const hex = m[1];
        for (let i = 0; i < hex.length; i += 4) {
          const code = parseInt(hex.slice(i, i+4), 16);
          if (code > 31) allText += String.fromCodePoint(code);
        }
        allText += ' ';
      }
      // TJ arrays
      for (const m of block.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const s of m[1].matchAll(/\(([^)]*)\)/g)) allText += s[1];
        for (const h of m[1].matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
          const hex = h[1];
          for (let i = 0; i < hex.length; i += 4) {
            const code = parseInt(hex.slice(i, i+4), 16);
            if (code > 31) allText += String.fromCodePoint(code);
          }
        }
        allText += ' ';
      }
    }
    pos = ei + 9;
  }
  return allText.trim();
};

// ══════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════

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
    if (list.length > 0) await Invoice.insertMany(list);
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/invoices/parse-pdf
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