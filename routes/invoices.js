const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const path = require('path');
const fs = require('fs');
const Invoice = require('../models/Invoice');

class LocalCMapReader {
  constructor({ baseUrl, isCompressed }) {
    this._dir = baseUrl;
    this._compressed = isCompressed;
  }
  async fetch({ name }) {
    const file = path.join(this._dir, name + (this._compressed ? '.bcmap' : ''));
    const data = fs.readFileSync(file);
    return {
      cMapData: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      compressionType: this._compressed ? 1 : 0,
    };
  }
}

const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const cmapDir = path.join(pdfjsDir, 'cmaps');
    const uint8 = new Uint8Array(pdfBuffer);
    const pdf = await pdfjsLib.getDocument({
      data: uint8,
      CMapReaderFactory: LocalCMapReader,
      cMapUrl: cmapDir,
      cMapPacked: true,
      verbosity: 0,
    }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map(i => i.str).join(' ') + '\n';
    }
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length > 20) {
      console.log(`✅ pdfjs: ${clean.length} chars`);
      return text;
    }
    throw new Error('pdfjs empty');
  } catch (e1) {
    console.warn('⚠️ pdfjs failed:', e1.message);
  }

  try {
    const PDFParser = require('pdf-parse');
    const data = await PDFParser(pdfBuffer);
    const clean = (data.text || '').replace(/\s+/g, ' ').trim();
    if (clean.length > 20) {
      console.log(`✅ pdf-parse: ${clean.length} chars`);
      return data.text;
    }
    throw new Error('pdf-parse empty');
  } catch (e2) {
    console.warn('⚠️ pdf-parse failed:', e2.message);
  }

  try {
    const rawText = extractRaw(pdfBuffer);
    if (rawText.length > 20) {
      console.log(`✅ raw: ${rawText.length} chars`);
      return rawText;
    }
    throw new Error('raw empty');
  } catch (e3) {
    console.error('❌ All methods failed:', e3.message);
    throw new Error('PDF se text extract nahi hua');
  }
};

const extractRaw = (buf) => {
  const zlib = require('zlib');
  let out = '', pos = 0;
  while (pos < buf.length) {
    let si = -1, searchPos = pos;
    while (searchPos < buf.length) {
      const idx = buf.indexOf('stream', searchPos);
      if (idx === -1) break;
      const before = buf.slice(Math.max(0, idx-3), idx).toString('ascii');
      if (!before.includes('end')) { si = idx; break; }
      searchPos = idx + 6;
    }
    if (si === -1) break;
    let ds = si + 6;
    if (buf[ds] === 0x0D) ds++;
    if (buf[ds] === 0x0A) ds++;
    const ei = buf.indexOf('endstream', ds);
    if (ei === -1) break;
    const raw = buf.slice(ds, ei);
    let content = '';
    try { content = zlib.inflateSync(raw).toString('latin1'); }
    catch { try { content = zlib.inflateRawSync(raw).toString('latin1'); }
    catch { content = raw.toString('latin1'); } }
    const blocks = content.match(/BT[\s\S]*?ET/g) || [];
    for (const block of blocks) {
      for (const m of block.matchAll(/\(([^)]*)\)\s*(?:Tj|')/g)) out += m[1] + ' ';
      for (const m of block.matchAll(/<([0-9A-Fa-f]{2,})>\s*(?:Tj|')/g)) {
        const h = m[1];
        if (h.length % 4 === 0) {
          for (let i = 0; i < h.length; i += 4) {
            const c = parseInt(h.slice(i, i+4), 16);
            if (c > 31 && c < 0xFFFD) out += String.fromCodePoint(c);
          }
        } else {
          for (let i = 0; i < h.length; i += 2) {
            const c = parseInt(h.slice(i, i+2), 16);
            if (c > 31) out += String.fromCharCode(c);
          }
        }
        out += ' ';
      }
      for (const m of block.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const s of m[1].matchAll(/\(([^)]*)\)/g)) out += s[1];
        for (const h of m[1].matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
          for (let i = 0; i < h[1].length; i += 4) {
            const c = parseInt(h[1].slice(i, i+4), 16);
            if (c > 31 && c < 0xFFFD) out += String.fromCodePoint(c);
          }
        }
        out += ' ';
      }
    }
    pos = ei + 9;
  }
  return out.trim();
};

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
    const body = req.body, invNo = body.invoiceNumber;
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
    if (type === 'vehicle') result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else result = await Invoice.deleteMany({});
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

// ✅ KEY FIX: text return करो, data नहीं — frontend parseVPHondaInvoice() parse करेगा
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 ${req.file.originalname} (${req.file.size} bytes)`);
    const text = await extractTextFromPDF(req.file.buffer);
    res.json({ success: true, text: text, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ parse-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;