const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const PDFParser = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');
const Invoice = require('../models/Invoice');

// ===================== CONFIG =====================
const OCR_API_KEY = 'K85340860888957';

// ===================== HELPER: Extract text from PDF (native) =====================
const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await PDFParser(pdfBuffer);
    return data.text;
  } catch (err) {
    console.warn('⚠️ PDF-parse failed:', err.message);
    return null;
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
  
  let text = await extractTextFromPDF(pdfBuffer);
  
  if (text && text.trim().length > 50) {
    console.log(`✅ Native extraction worked (${text.length} chars)`);
    return { text, method: 'native' };
  }
  
  console.log(`⚠️ Native failed, trying OCR...`);
  text = await extractTextUsingOCR(pdfBuffer, filename);
  
  if (text && text.trim().length > 50) {
    console.log(`✅ OCR extraction worked (${text.length} chars)`);
    return { text, method: 'ocr' };
  }
  
  throw new Error('Could not extract text from PDF (both native and OCR failed)');
};

// ===================== PARSE INVOICE FROM TEXT - FIXED =====================
const parseInvoiceFromText = (rawText, filename) => {
  const text = rawText.replace(/\r\n/g, '\n');
  const flat = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  console.log(`\n🔍 Parsing: ${filename}`);
  
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

  // ===== INVOICE NUMBER =====
  let invoiceNumber = '';
  const invPatterns = [
    /Invoice\s*No\s*[:-]?\s*(\d{3,})/i,
    /Invoice\s*#\s*(\d+)/i,
    /INV\s*(\d+)/i,
  ];
  
  for (const pattern of invPatterns) {
    const match = flat.match(pattern);
    if (match) {
      invoiceNumber = match[1];
      break;
    }
  }

  if (!invoiceNumber) {
    invoiceNumber = String(Math.floor(Math.random() * 900000 + 100000));
  }

  // ===== DATE: Proper validation =====
  let invoiceDate = new Date().toISOString().split('T')[0];
  const datePatterns = [
    /Invoice\s*Date\s*[:-]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
    /Date\s*[:-]?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = flat.match(pattern);
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

  // ===== VEHICLE: Model No ===== (✅ FIX #1)
  let vehicle = '';
  const vehiclePatterns = [
    /Model\s*No\s*[:-]?\s*([A-Z0-9 ]{4,40}?)(?=\s+(?:Colour|Color|Model\s*Code|Engine|Frame|Jobcard))/i,
    /Model\s*Code?\s*[:-]?\s*([A-Z0-9 ]{3,30})/i,
    /(SP125|Shine|Activa|Hornet|CB350|XF3R|CD110|100|150)\s+([A-Z0-9 ]{0,20})?/i,
  ];

  for (const pattern of vehiclePatterns) {
    const match = flat.match(pattern);
    if (match) {
      vehicle = (match[1] + ' ' + (match[2] || '')).trim().toUpperCase().slice(0, 40);
      break;
    }
  }

  // ===== REG NO: Veh Number ===== (✅ FIX #2)
  let regNo = '';
  const regPatterns = [
    /Veh(?:icle)?\s*Number\s*[:-]?\s*([A-Z]{2}\s*\d{2}\s*[A-Z]{1,3}\s*\d{4})/i,
    /Registration\s*[:-]?\s*([A-Z]{2}\d{2}[A-Z]{1,3}\d{4})/i,
    /\b([A-Z]{2}\d{2}[A-Z]{1,3}\d{4})\b/,
  ];

  for (const pattern of regPatterns) {
    const match = flat.match(pattern);
    if (match) {
      regNo = match[1].replace(/\s+/g, '').toUpperCase();
      break;
    }
  }

  // ===== PHONE =====
  let customerPhone = '';
  const phoneMatch = flat.match(/\b([6-9]\d{9})\b/);
  if (phoneMatch) {
    customerPhone = phoneMatch[1];
  }

  // ===== AMOUNT: Total Invoice Value ===== (✅ FIX #3)
  let grandTotal = 0;
  const amountPatterns = [
    /Total\s*Invoice\s*Value\s*\([Ii]n\s*[Ff]igure\)\s*[₹Rs.\s]*([\d,]+\.?\d*)/i,
    /Invoice\s*Value\s*[₹Rs.\s]*([\d,]+\.?\d*)/i,
    /Grand\s*Total\s*[₹Rs.\s]*([\d,]+\.?\d*)/i,
    /Total\s*[₹Rs.\s]+([\d,]+\.?\d*)/i,
  ];

  for (const pattern of amountPatterns) {
    const match = flat.match(pattern);
    if (match) {
      const amt = match[1].replace(/,/g, '');
      const parsed = parseFloat(amt) || 0;
      if (parsed > 0) {
        grandTotal = parsed;
        break;
      }
    }
  }

  // ===== PARTS/ITEMS ===== (✅ FIX #4)
  const items = [];
  const lines = text.split('\n');
  
  // Part number patterns
  const partNoPattern = /^(\d+)\s+([A-Z0-9\-]+)\s+(.{1,50}?)\s+(\d+\.?\d*)\s+/gm;
  let match;

  while ((match = partNoPattern.exec(flat)) !== null) {
    const srNo = match[1];
    const partNo = match[2];
    const description = match[3]?.trim() || '';
    
    // Skip noise
    if (/^(GSTIN|BCYPD|VPHONDA|STATE|PHONE|EMAIL|TOTAL|HSN|SAC|SGST|CGST|IGST)/i.test(partNo)) {
      continue;
    }

    items.push({
      partNo: partNo.slice(0, 20),
      description: description.slice(0, 50),
      qty: 1,
      mrp: 0,
      taxableAmount: 0,
      sgst: 0,
      cgst: 0,
      gstRate: 9,
      total: 0
    });
  }

  // If no items found, try different pattern
  if (items.length === 0) {
    const partLines = text.split('\n').filter(l => 
      /^\d+\s+[A-Z0-9\-]/.test(l.trim()) && 
      !/TOTAL|TAX|GST|Invoice/.test(l)
    );

    partLines.slice(0, 10).forEach((line, idx) => {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 2) {
        items.push({
          partNo: parts[1]?.slice(0, 20) || `PART${idx}`,
          description: parts[2]?.slice(0, 50) || 'Service Item',
          qty: 1,
          mrp: 0,
          taxableAmount: 0,
          sgst: 0,
          cgst: 0,
          gstRate: 9,
          total: 0
        });
      }
    });
  }

  // ===== INVOICE TYPE DETECTION =====
  let invoiceType = 'service';
  if (/Vehicle|Purchase|Sale|Showroom|Price/i.test(flat)) {
    invoiceType = 'vehicle';
  }

  let serviceNumber = null;
  const svcMatch = flat.match(/(\d+)\s*(?:st|nd|rd|th)\s+Service/i);
  if (svcMatch) {
    serviceNumber = parseInt(svcMatch[1]);
  }

  const result = {
    invoiceNumber,
    invoiceType,
    invoiceDate,
    customerName,
    customerPhone,
    vehicle,
    regNo,
    serviceNumber,
    items,
    subtotal: Math.round(grandTotal * 100) / 100,
    totalGST: 0,
    grandTotal: Math.round(grandTotal * 100) / 100,
    importedFrom: filename,
    importedAt: new Date().toISOString(),
    status: 'Active'
  };

  console.log(`✅ Parsed:`);
  console.log(`   Invoice: ${result.invoiceNumber}`);
  console.log(`   Customer: ${result.customerName}`);
  console.log(`   Vehicle: ${result.vehicle}`);
  console.log(`   Reg No: ${result.regNo}`);
  console.log(`   Amount: ₹${result.grandTotal}`);
  console.log(`   Parts: ${result.items.length}`);

  return result;
};

// ===================== ROUTES =====================

router.get('/', async (req, res) => {
  try {
    res.json(await Invoice.find().sort({ createdAt: -1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.post('/', async (req, res) => {
  try {
    res.status(201).json(await Invoice.create(req.body));
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
    if (!inv) inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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

router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    console.log(`\n📄 Processing: ${req.file.originalname}`);
    
    const { text, method } = await smartExtractText(req.file.buffer, req.file.originalname);
    
    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'PDF में insufficient data है' });
    }

    const parsed = parseInvoiceFromText(text, req.file.originalname);

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