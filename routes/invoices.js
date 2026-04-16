const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const PDFParser = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');
const Invoice = require('../models/Invoice');

// ===================== CONFIG =====================
const OCR_API_KEY = 'K85340860888957'; // आपकी OCR key

// ===================== HELPER: Extract text from PDF (native) =====================
const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await PDFParser(pdfBuffer);
    return data.text;
  } catch (err) {
    console.warn('⚠️ PDF-parse failed:', err.message);
    return null; // Return null, we'll try OCR
  }
};

// ===================== HELPER: Extract text using OCR (fallback) =====================
const extractTextUsingOCR = async (pdfBuffer, filename) => {
  try {
    console.log(`🔄 Trying OCR for: ${filename}`);
    
    const form = new FormData();
    form.append('file', pdfBuffer, { filename });
    form.append('apikey', OCR_API_KEY);
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true');

    const response = await axios.post('https://api.ocr.space/parse/image', form, {
      headers: form.getHeaders(),
      timeout: 120000
    });

    if (response.data.IsErroredOnProcessing) {
      throw new Error(response.data.ErrorMessage?.[0] || 'OCR failed');
    }

    const rawText = response.data.ParsedResults.map(r => r.ParsedText).join('\n');
    const cleanText = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    
    if (cleanText && cleanText.trim().length > 50) {
      console.log(`✅ OCR extracted ${cleanText.length} chars`);
      return cleanText;
    }
    
    return null;
  } catch (err) {
    console.error('❌ OCR error:', err.message);
    return null;
  }
};

// ===================== SMART TEXT EXTRACTION =====================
const smartExtractText = async (pdfBuffer, filename) => {
  console.log(`📄 Smart extracting: ${filename}`);
  
  // Try native PDF parsing first (fast)
  let text = await extractTextFromPDF(pdfBuffer);
  
  if (text && text.trim().length > 50) {
    console.log(`✅ Native extraction worked (${text.length} chars)`);
    return { text, method: 'native' };
  }
  
  // Fallback to OCR
  console.log(`⚠️ Native failed, trying OCR...`);
  text = await extractTextUsingOCR(pdfBuffer, filename);
  
  if (text && text.trim().length > 50) {
    console.log(`✅ OCR extraction worked (${text.length} chars)`);
    return { text, method: 'ocr' };
  }
  
  throw new Error('Could not extract text from PDF (both native and OCR failed)');
};

// ===================== PARSE INVOICE FROM TEXT =====================
const parseInvoiceFromText = (rawText, filename) => {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  
  // ===== CUSTOMER NAME: From filename =====
  let customerName = filename
    .replace(/\.pdf$/i, '')
    .replace(/^[_\d\-]+/, '')
    .split(/[_\-]/)
    .filter(p => p.length > 2)
    .map(p => p.trim())
    .join(' ')
    .toUpperCase()
    .slice(0, 60);

  if (!customerName || customerName.length < 2) {
    customerName = 'CUSTOMER';
  }

  // ===== INVOICE NUMBER & DATE =====
  let invoiceNumber = '';
  let invoiceDate = new Date().toISOString().split('T')[0];
  
  const invPatterns = [
    /Invoice\s*(?:No\.?|#)?\s*:?\s*(\d{6,})/i,
    /Invoice\s*No\s*:?\s*(\d+)/i,
    /#\s*(\d{6,})/,
    /(\d{6,})/
  ];
  
  for (const pattern of invPatterns) {
    const match = text.match(pattern);
    if (match) {
      invoiceNumber = match[1];
      break;
    }
  }

  if (!invoiceNumber) {
    invoiceNumber = String(Math.floor(Math.random() * 900000 + 100000));
  }

  // ===== DATE: Proper validation =====
  const datePatterns = [
    /[Ii]nvoice\s*[Dd]ate\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /[Dd]ate\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      let day = parseInt(match[1]);
      let month = parseInt(match[2]);
      let year = parseInt(match[3]);
      
      if (year < 100) {
        year = year > 30 ? 1900 + year : 2000 + year;
      }

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        const d = new Date(year, month - 1, day);
        invoiceDate = d.toISOString().split('T')[0];
        break;
      }
    }
  }

  // ===== VEHICLE & REG NO =====
  let vehicle = '';
  let regNo = '';

  const vehiclePatterns = [
    /[Vv]ehicle\s*(?:[Mm]odel)?\s*:?\s*([A-Z0-9\s]{4,30})/,
    /[Mm]odel\s*:?\s*([A-Z0-9\s]{4,30})/,
    /(SP125|Hero|Activa|Shine|Hornet|CD110|CB350|XF3R|Vento|Splendor|100|150|200|250|300)\s*([A-Z0-9\s]{0,20})?/i
  ];

  for (const pattern of vehiclePatterns) {
    const match = text.match(pattern);
    if (match) {
      vehicle = (match[1] + ' ' + (match[2] || '')).trim().slice(0, 40);
      break;
    }
  }

  const regPattern = /([A-Z]{2}\d{2}[A-Z]{1,3}\d{4})/i;
  const regMatch = text.match(regPattern);
  if (regMatch) {
    regNo = regMatch[1].toUpperCase();
  }

  // ===== PHONE =====
  let customerPhone = '';
  const phoneMatch = text.match(/\b(\d{10})\b/);
  if (phoneMatch) {
    customerPhone = phoneMatch[1];
  }

  // ===== PARTS PARSING =====
  const items = [];
  const lines = rawText.split('\n');
  let inPartsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (/Part\s*No|Description|Qty|MRP|Taxable|HSN|SAC/i.test(line)) {
      inPartsSection = true;
      continue;
    }

    if (inPartsSection && /Subtotal|Total|TAX SUMMARY|₹/i.test(line) && !line.match(/^[A-Z0-9]/)) {
      inPartsSection = false;
      continue;
    }

    if (inPartsSection && line.length > 10) {
      const parts = line.split(/\s{2,}/);
      
      if (parts.length >= 4) {
        const partNo = parts[0];
        const description = parts[1] || '';
        const qty = parseInt(parts[2]) || 1;
        const mrp = parseFloat(parts[3]) || 0;
        const taxableAmt = parseFloat(parts[4]) || mrp;
        
        let sgst = 0, cgst = 0, gstRate = 0;
        
        if (parts.length > 5) {
          sgst = parseFloat(parts[5]) || 0;
        }
        if (parts.length > 6) {
          cgst = parseFloat(parts[6]) || 0;
        }

        const gstAmount = sgst + cgst;
        
        if (taxableAmt > 0 && gstAmount > 0) {
          gstRate = Math.round((gstAmount / taxableAmt) * 100);
        } else if (sgst > 0) {
          gstRate = sgst * 2;
        }

        if (partNo && partNo.match(/^[A-Z0-9]/)) {
          items.push({
            partNo,
            description: description.slice(0, 40),
            qty,
            mrp: Math.round(mrp * 100) / 100,
            taxableAmount: Math.round(taxableAmt * 100) / 100,
            sgst: Math.round(sgst * 100) / 100,
            cgst: Math.round(cgst * 100) / 100,
            gstRate: gstRate || 0,
            gstAmount: Math.round(gstAmount * 100) / 100,
            total: Math.round((taxableAmt + gstAmount) * 100) / 100
          });
        }
      }
    }
  }

  // ===== TOTALS =====
  let subtotal = 0;
  let totalGST = 0;
  let grandTotal = 0;

  const subtotalMatch = text.match(/Subtotal\s*:?\s*₹?\s*([\d,]+\.?\d*)/i);
  const gstMatch = text.match(/(?:Total\s+)?(?:GST|IGST|SGST|CGST)\s*:?\s*₹?\s*([\d,]+\.?\d*)/i);
  const totalMatch = text.match(/(?:Grand\s+)?Total\s*:?\s*₹?\s*([\d,]+\.?\d*)/i);

  if (subtotalMatch) subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ''));
  if (gstMatch) totalGST = parseFloat(gstMatch[1].replace(/,/g, ''));
  if (totalMatch) grandTotal = parseFloat(totalMatch[1].replace(/,/g, ''));

  // Recalculate from items
  if (items.length > 0) {
    const itemSubtotal = items.reduce((sum, item) => sum + item.taxableAmount, 0);
    const itemGST = items.reduce((sum, item) => sum + (item.sgst + item.cgst), 0);

    if (subtotal === 0) subtotal = itemSubtotal;
    if (totalGST === 0) totalGST = itemGST;
  }

  if (grandTotal === 0 && subtotal > 0) {
    grandTotal = subtotal + totalGST;
  }

  // ===== INVOICE TYPE DETECTION =====
  let invoiceType = 'service';
  if (/Vehicle|Purchase|Purchase Date/i.test(text)) {
    invoiceType = 'vehicle';
  }

  let serviceNumber = null;
  const svcMatch = text.match(/(\d+)(?:st|nd|rd|th)\s+Service/i);
  if (svcMatch) {
    serviceNumber = parseInt(svcMatch[1]);
  }

  return {
    invoiceNumber,
    invoiceType,
    invoiceDate,
    customerName,
    customerPhone,
    vehicle,
    regNo,
    serviceNumber,
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    totalGST: Math.round(totalGST * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
    importedFrom: filename,
    importedAt: new Date().toISOString(),
    status: 'Active'
  };
};

// ===================== ROUTES =====================

// ✅ GET all invoices
router.get('/', async (req, res) => {
  try {
    res.json(await Invoice.find().sort({ createdAt: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET single invoice
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

// ✅ POST new invoice
router.post('/', async (req, res) => {
  try {
    res.status(201).json(await Invoice.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ✅ PUT update invoice
router.put('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    }
    if (!inv) inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ✅ DELETE invoice
router.delete('/:id', async (req, res) => {
  try {
    let inv = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      inv = await Invoice.findByIdAndDelete(req.params.id);
    }
    if (!inv) inv = await Invoice.findOneAndDelete({ invoiceNumber: req.params.id });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST sync
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

// ✅ POST clear by type
router.post('/clear', async (req, res) => {
  try {
    const { type } = req.body;
    if (type === 'vehicle') {
      await Invoice.deleteMany({ invoiceType: 'vehicle' });
    } else if (type === 'service') {
      await Invoice.deleteMany({ invoiceType: 'service' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST parse single PDF (HYBRID)
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    console.log(`\n📄 Processing: ${req.file.originalname}`);
    
    // Smart extraction (tries native first, then OCR)
    const { text, method } = await smartExtractText(req.file.buffer, req.file.originalname);
    
    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'PDF में insufficient data है' });
    }

    const parsed = parseInvoiceFromText(text, req.file.originalname);
    console.log(`✅ Parsed [${method}]: ${parsed.invoiceNumber} | ${parsed.customerName} | ₹${parsed.grandTotal}\n`);

    res.json({
      success: true,
      invoice: parsed,
      extractionMethod: method,
      rawText: text.slice(0, 500)
    });

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST parse multiple PDFs (HYBRID)
router.post('/parse-pdf-batch', upload.array('pdfs'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files' });
    }

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        console.log(`\n📄 Processing: ${file.originalname}`);
        const { text, method } = await smartExtractText(file.buffer, file.originalname);
        const parsed = parseInvoiceFromText(text, file.originalname);
        results.push({...parsed, extractionMethod: method});
        console.log(`✅ Parsed [${method}]: ${parsed.invoiceNumber}`);
      } catch (err) {
        console.error(`❌ ${file.originalname}:`, err.message);
        errors.push({
          filename: file.originalname,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      imported: results.length,
      failed: errors.length,
      invoices: results,
      errors: errors
    });

  } catch (err) {
    console.error('❌ Batch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;