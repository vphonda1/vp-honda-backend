const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const path = require('path');
const fs = require('fs');
const Invoice = require('../models/Invoice');

// ════════════════════════════════════════════════════════════
// CUSTOM CMapReaderFactory (pdfjs-dist के लिए)
// ════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION – आपका मूल 3-मेथड फॉलबैक (काम करता है)
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer) => {
  // Method 1: pdfjs-dist
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

  // Method 2: pdf-parse
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

  // Method 3: Raw binary
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
    let si = -1;
    let searchPos = pos;
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

// ════════════════════════════════════════════════════════════
// बेहतर PARSER – अब 8 पार्ट्स और सही टैक्सेबल अमाउंट निकालेगा
// ════════════════════════════════════════════════════════════
function parseInvoiceFromText(text) {
  if (!text || typeof text !== 'string') {
    console.error('Invalid text input to parser');
    return {};
  }
  
  // Normalize
  const clean = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  
  // 1. Invoice Number
  let invoiceNo = '';
  const invMatch = clean.match(/(?:Invoice|Invoice No|#)\s*[#:]?\s*([A-Z0-9-]+)/i);
  if (invMatch) invoiceNo = invMatch[1];
  
  // 2. Customer Name
  let customer = '';
  const custMatch = clean.match(/(?:CLIENT|Customer|Name)[:\s]*([A-Z\s]+?)(?=\d|\n|Vehicle|Reg)/i);
  if (custMatch) customer = custMatch[1].trim();
  
  // 3. Vehicle & Reg No
  let vehicle = '', regNo = '';
  const vehMatch = clean.match(/Vehicle[:\s]*([^\n]+)/i);
  if (vehMatch) vehicle = vehMatch[1].trim();
  const regMatch = clean.match(/Reg(?:istration)?\s*No[:\s]*([A-Z0-9]+)/i);
  if (regMatch) regNo = regMatch[1];
  
  // 4. Date
  let date = '';
  const dateMatch = clean.match(/Date[:\s]*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) date = dateMatch[1];
  
  // 5. Type
  let type = 'Service';
  if (clean.match(/Vehicle\s+Sale|New\s+Vehicle/i)) type = 'Vehicle';
  
  // ════════════════════════════════════════════════════════════
  // 6. PARTS – दो तरीके: सिंपल टेबल और डिटेल्ड टेबल
  // ════════════════════════════════════════════════════════════
  const parts = [];
  
  // तरीका A: सिंपल टेबल (जैसे पहली PDF)
  const simpleRegex = /^(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+(\d+)%/gm;
  let match;
  while ((match = simpleRegex.exec(clean)) !== null) {
    parts.push({
      partNo: match[2],
      description: match[3].trim(),
      quantity: parseInt(match[4]),
      mrp: parseFloat(match[5].replace(/,/g, '')),
      taxable: parseFloat(match[6].replace(/,/g, '')),
      gst: parseInt(match[7])
    });
  }
  
  // तरीका B: डिटेल्ड टेबल (जैसे दूसरी PDF – जहाँ टैक्सेबल अमाउंट अलग कॉलम में है)
  if (parts.length === 0) {
    // लाइन बाय लाइन पार्स करें
    const lines = text.split(/\r?\n/);
    let inDetailTable = false;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (/Description\s+HSIN\/SAC|Sr\.|S\.No|Parts\/Items/i.test(line)) {
        inDetailTable = true;
        continue;
      }
      if (inDetailTable && /Total|Subtotal|Tax|Grand|Payable|Invoice Value/i.test(line)) break;
      if (inDetailTable) {
        // पैटर्न: Description (शब्द) + कोड (संख्या) + Rate + Amount + GST...
        const tokens = line.split(/\s+/);
        if (tokens.length >= 4 && /^\d+$/.test(tokens[1])) {
          const description = tokens[0];
          const hsinCode = tokens[1];
          const rate = parseFloat(tokens[2]);
          let amount = parseFloat(tokens[3].replace(/,/g, ''));
          let gst = 18;
          // GST ढूंढें (अगर मौजूद है)
          for (let i = 4; i < tokens.length; i++) {
            if (tokens[i].includes('%')) {
              gst = parseInt(tokens[i].replace('%', ''));
              break;
            }
          }
          parts.push({
            partNo: hsinCode,
            description: description,
            quantity: 1, // डिटेल्ड टेबल में qty साफ नहीं, मान लें 1
            mrp: amount,
            taxable: amount, // यहाँ amount ही टैक्सेबल है
            gst: gst
          });
        }
      }
    }
  }
  
  // ════════════════════════════════════════════════════════════
  // 7. TOTAL AMOUNT – प्राथमिकता से
  // ════════════════════════════════════════════════════════════
  let total = 0;
  let totalMatch = clean.match(/Total\s+Payable\s+Amount[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Invoice Value\s*\(in Figure\)[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Grand\s+Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)(?=\s|$)/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(/,/g, ''));
  
  // अगर total नहीं मिला तो parts से कैलकुलेट करें
  if (total === 0 && parts.length) {
    total = parts.reduce((sum, p) => sum + (p.mrp * p.quantity), 0);
  }
  
  return {
    invoiceNumber: invoiceNo,
    customerName: customer,
    vehicleNumber: vehicle,
    regNo: regNo,
    date: date,
    invoiceType: type,
    totalAmount: total,
    parts: parts
  };
}

// ════════════════════════════════════════════════════════════
// ROUTES – आपके मूल routes (ज्यों के त्यों)
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

// ⭐ PDF PARSE ROUTE – अब structured data return करेगा
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 Processing: ${req.file.originalname}`);
    const rawText = await extractTextFromPDF(req.file.buffer);
    const invoiceData = parseInvoiceFromText(rawText);
    res.json({ success: true, data: invoiceData, filename: req.file.originalname });
  } catch (err) {
    console.error('Parse error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;