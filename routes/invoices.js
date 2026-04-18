const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const Invoice = require('../models/Invoice');
const pdfParse = require('pdf-parse');

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION – केवल pdf-parse (सबसे विश्वसनीय)
// ════════════════════════════════════════════════════════════
const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await pdfParse(pdfBuffer);
    const text = data.text || '';
    if (text.trim().length > 20) {
      console.log(`✅ pdf-parse: ${text.length} chars`);
      return text;
    }
    throw new Error('Empty text');
  } catch (err) {
    console.error('❌ pdf-parse failed:', err.message);
    throw new Error('PDF se text extract nahi hua');
  }
};

// ════════════════════════════════════════════════════════════
// SMART PARSER – दोनों लेआउट सपोर्ट करता है
// ════════════════════════════════════════════════════════════
function parseInvoiceFromText(text) {
  if (!text || typeof text !== 'string') {
    console.error('Invalid text input');
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
  // 6. PARTS EXTRACTION – दो अलग-अलग तरीके
  // ════════════════════════════════════════════════════════════
  const parts = [];
  
  // Method A: सिंपल टेबल (Part No, Description, Qty, MRP, Taxable, GST%)
  const simpleTableRegex = /^(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+(\d+)%/gm;
  let match;
  while ((match = simpleTableRegex.exec(clean)) !== null) {
    parts.push({
      partNo: match[2],
      description: match[3].trim(),
      quantity: parseInt(match[4]),
      mrp: parseFloat(match[5].replace(/,/g, '')),
      taxable: parseFloat(match[6].replace(/,/g, '')),
      gst: parseInt(match[7])
    });
  }
  
  // Method B: डिटेल्ड टेबल (Description, HSIN/SAC, Rate, Amount, GST%, ...)
  // यहाँ "Amount" कॉलम taxable amount होता है
  if (parts.length === 0) {
    // लाइन-बाय-लाइन पार्सिंग
    const lines = text.split(/\r?\n/);
    let inTable = false;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      // टेबल की शुरुआत
      if (/Description\s+HSIN\/SAC|Parts\s+\/|\bSr\.\b/i.test(line)) {
        inTable = true;
        continue;
      }
      if (inTable && /Total|Tax|Grand|Payable|Invoice Value/i.test(line)) break;
      if (inTable) {
        // पैटर्न: Description, कोड, Rate, Amount, GST%, ...
        const tokens = line.split(/\s+/);
        // कम से कम 5 टोकन होने चाहिए और दूसरा टोकन नंबर हो (HSIN/SAC)
        if (tokens.length >= 5 && /^\d+$/.test(tokens[1])) {
          const description = tokens[0];
          const hsin = tokens[1];
          const rate = parseFloat(tokens[2]);
          const amount = parseFloat(tokens[3].replace(/,/g, ''));
          let gst = 18; // default
          // GST rate ढूंढो (अगर मौजूद है)
          for (let i = 4; i < tokens.length; i++) {
            if (tokens[i].includes('%') || tokens[i].match(/^\d+$/)) {
              gst = parseInt(tokens[i].replace('%', ''));
              break;
            }
          }
          parts.push({
            partNo: hsin,        // HSIN code को partNo के रूप में
            description: description,
            quantity: 1,         // डिटेल्ड टेबल में qty अलग नहीं दिखता, मान लें 1
            mrp: amount,         // यहाँ amount ही MRP (या taxable)
            taxable: amount,
            gst: gst
          });
        }
      }
    }
  }
  
  // अगर अभी भी कोई part नहीं मिला, तो CONSUMABLE जैसी लाइनों के लिए फॉलबैक
  if (parts.length === 0) {
    const fallbackRegex = /([A-Z0-9\-]+)\s+([A-Za-z\s]+?)\s+(\d+)\s+[₹]?([\d,]+(?:\.\d{2})?)/g;
    let fMatch;
    while ((fMatch = fallbackRegex.exec(clean)) !== null) {
      parts.push({
        partNo: fMatch[1],
        description: fMatch[2].trim(),
        quantity: parseInt(fMatch[3]),
        mrp: parseFloat(fMatch[4].replace(/,/g, '')),
        taxable: parseFloat(fMatch[4].replace(/,/g, '')),
        gst: 18
      });
    }
  }
  
  // ════════════════════════════════════════════════════════════
  // 7. TOTAL AMOUNT – पहले "Total Payable Amount" फिर "Grand Total"
  // ════════════════════════════════════════════════════════════
  let total = 0;
  let totalMatch = clean.match(/Total\s+Payable\s+Amount[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Invoice Value\s*\(in Figure\)[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Grand\s+Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)(?=\s|$)/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(/,/g, ''));
  
  // अगर total नहीं मिला तो parts से calculate करें
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
// ROUTES (आपके सभी पुराने routes ज्यों के त्यों)
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

// ⭐ PDF PARSE ROUTE – अब सही डेटा देगा
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