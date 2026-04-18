const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const Invoice = require('../models/Invoice');
const PDFParser = require('pdf2json');

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION – pdf2json (काम करेगा Render पर)
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = (pdfBuffer) => {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', errData => {
      console.error('pdf2json error:', errData.parserError);
      reject(new Error('PDF parse failed: ' + errData.parserError));
    });
    pdfParser.on('pdfParser_dataReady', pdfData => {
      let text = '';
      for (const page of pdfData.Pages) {
        for (const textItem of page.Texts) {
          const decoded = decodeURIComponent(textItem.R[0].T);
          text += decoded + ' ';
        }
        text += '\n';
      }
      if (text.trim().length > 20) {
        console.log(`✅ pdf2json: ${text.length} chars extracted`);
        resolve(text);
      } else {
        reject(new Error('No text found in PDF'));
      }
    });
    pdfParser.parseBuffer(pdfBuffer);
  });
};

// ════════════════════════════════════════════════════════════
// INVOICE DATA PARSER – सारे parts और सही total निकालेगा
// ════════════════════════════════════════════════════════════
function parseInvoiceFromText(text) {
  if (!text || typeof text !== 'string') {
    console.error('Invalid text input to parser');
    return {};
  }
  
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
  
  // 6. PARTS – दो तरीके
  const parts = [];
  
  // Method A: Simple table (Part No, Description, Qty, MRP, Taxable, GST%)
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
  
  // Method B: Detailed table (Description, HSIN/SAC, Rate, Amount, GST...)
  if (parts.length === 0) {
    const lines = text.split(/\r?\n/);
    let inDetail = false;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (/Description\s+HSIN\/SAC|Sr\.|S\.No|Parts\/Items/i.test(line)) {
        inDetail = true;
        continue;
      }
      if (inDetail && /Total|Subtotal|Tax|Grand|Payable|Invoice Value/i.test(line)) break;
      if (inDetail) {
        const tokens = line.split(/\s+/);
        if (tokens.length >= 4 && /^\d+$/.test(tokens[1])) {
          const description = tokens[0];
          const hsinCode = tokens[1];
          const rate = parseFloat(tokens[2]);
          let amount = parseFloat(tokens[3].replace(/,/g, ''));
          let gst = 18;
          for (let i = 4; i < tokens.length; i++) {
            if (tokens[i].includes('%')) {
              gst = parseInt(tokens[i].replace('%', ''));
              break;
            }
          }
          parts.push({
            partNo: hsinCode,
            description: description,
            quantity: 1,
            mrp: amount,
            taxable: amount,
            gst: gst
          });
        }
      }
    }
  }
  
  // 7. TOTAL AMOUNT
  let total = 0;
  let totalMatch = clean.match(/Total\s+Payable\s+Amount[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Invoice Value\s*\(in Figure\)[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Grand\s+Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)(?=\s|$)/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(/,/g, ''));
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
// ROUTES – CRUD Operations
// ════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findById(req.params.id);
    if (!inv) inv = await Invoice.findOne({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    }
    if (!inv) {
      inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
    }
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    let result;
    if (type === 'vehicle') result = await Invoice.deleteMany({ invoiceType: 'vehicle' });
    else if (type === 'service') result = await Invoice.deleteMany({ invoiceType: 'service' });
    else result = await Invoice.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ⭐ PDF PARSE ROUTE – अब पूरी तरह काम करेगा
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 Processing: ${req.file.originalname} (${req.file.size} bytes)`);
    const rawText = await extractTextFromPDF(req.file.buffer);
    const invoiceData = parseInvoiceFromText(rawText);
    res.json({ success: true, data: invoiceData, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ parse-pdf error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;