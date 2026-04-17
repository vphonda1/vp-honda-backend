const router  = require('express').Router();
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });
const path    = require('path');
const fs      = require('fs');
const Invoice = require('../models/Invoice');

// ════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION (आपका मौजूदा कोड – वही रहेगा)
// ════════════════════════════════════════════════════════════
class LocalCMapReader { /* ... वही रहेगा ... */ }

const extractTextFromPDF = async (pdfBuffer) => { /* ... वही रहेगा ... */ };
const extractRaw = (buf) => { /* ... वही रहेगा ... */ };

// ════════════════════════════════════════════════════════════
// ✅ नया SMART PARSER – यह फंक्शन जोड़ें (पुराने कोड में नहीं था)
// ════════════════════════════════════════════════════════════
function parseInvoiceFromText(text) {
  const clean = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  
  let invoiceNo = '';
  const invMatch = clean.match(/(?:Invoice|Invoice No|#)\s*[#:]?\s*([A-Z0-9-]+)/i);
  if (invMatch) invoiceNo = invMatch[1];
  
  let customer = '';
  const custMatch = clean.match(/(?:CLIENT|Customer|Name)[:\s]*([A-Z\s]+?)(?=\d|\n|Vehicle|Reg)/i);
  if (custMatch) customer = custMatch[1].trim();
  
  let vehicle = '', regNo = '';
  const vehMatch = clean.match(/Vehicle[:\s]*([^\n]+)/i);
  if (vehMatch) vehicle = vehMatch[1].trim();
  const regMatch = clean.match(/Reg(?:istration)?\s*No[:\s]*([A-Z0-9]+)/i);
  if (regMatch) regNo = regMatch[1];
  
  let date = '';
  const dateMatch = clean.match(/Date[:\s]*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) date = dateMatch[1];
  
  let type = 'Service';
  if (clean.match(/Vehicle\s+Sale|New\s+Vehicle/i)) type = 'Vehicle';
  
  // Parts extraction – सारे parts के लिए
  const parts = [];
  const lines = text.split(/\r?\n/);
  let inTable = false;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (/Part\s*No|Sr\.|S\.No|Item/i.test(line)) { inTable = true; continue; }
    if (inTable && /Total|Subtotal|Tax|Grand|Payable/i.test(line)) break;
    if (inTable) {
      const partMatch = line.match(/^(\d+)\s+([A-Z0-9\-]+)\s+(.+?)\s+(\d+)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+[₹]?([\d,]+(?:\.\d{2})?)\s+(\d+)%/);
      if (partMatch) {
        parts.push({
          partNo: partMatch[2],
          description: partMatch[3].trim(),
          quantity: parseInt(partMatch[4]),
          mrp: parseFloat(partMatch[5].replace(/,/g, '')),
          taxable: parseFloat(partMatch[6].replace(/,/g, '')),
          gst: parseInt(partMatch[7])
        });
      } else {
        // फॉलबैक सरल पार्स
        const tokens = line.split(/\s+/);
        if (tokens.length >= 5 && /^[A-Z0-9\-]+$/.test(tokens[1])) {
          let qtyIdx = tokens.findIndex(t => !isNaN(t) && t.length < 4);
          if (qtyIdx === -1) qtyIdx = 3;
          const partNo = tokens[1];
          const desc = tokens.slice(2, qtyIdx).join(' ');
          const qty = parseInt(tokens[qtyIdx]);
          const priceIdx = tokens.findIndex(t => t.startsWith('₹') || t.match(/[\d,]+\.\d{2}/));
          let mrp = 0;
          if (priceIdx !== -1) mrp = parseFloat(tokens[priceIdx].replace(/[₹,]/g, ''));
          parts.push({ partNo, description: desc, quantity: qty, mrp, taxable: 0, gst: 18 });
        }
      }
    }
  }
  
  let total = 0;
  let totalMatch = clean.match(/Total\s+Payable\s+Amount[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Grand\s+Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)/i);
  if (!totalMatch) totalMatch = clean.match(/Total[:\s]*[₹]?([\d,]+(?:\.\d{2})?)(?=\s|$)/i);
  if (totalMatch) total = parseFloat(totalMatch[1].replace(/,/g, ''));
  if (total === 0 && parts.length) total = parts.reduce((sum, p) => sum + (p.mrp * p.quantity), 0);
  
  return { invoiceNumber: invoiceNo, customerName: customer, vehicleNumber: vehicle, regNo, date, invoiceType: type, totalAmount: total, parts };
}

// ════════════════════════════════════════════════════════════
// ROUTES (आपके सभी पुराने routes ज्यों के त्यों रहेंगे)
// ════════════════════════════════════════════════════════════
router.get('/', async (req, res) => { /* ... वही ... */ });
router.get('/:id', async (req, res) => { /* ... वही ... */ });
router.post('/', async (req, res) => { /* ... वही ... */ });
router.put('/:id', async (req, res) => { /* ... वही ... */ });
router.delete('/:id', async (req, res) => { /* ... वही ... */ });
router.post('/clear', async (req, res) => { /* ... वही ... */ });
router.post('/sync', async (req, res) => { /* ... वही ... */ });

// ⭐ बस इस एक route को बदलना है – पहले सिर्फ raw text return होता था, अब structured data
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' });
    console.log(`\n📄 ${req.file.originalname} (${req.file.size} bytes)`);
    const rawText = await extractTextFromPDF(req.file.buffer);
    const invoiceData = parseInvoiceFromText(rawText);
    res.json({ success: true, data: invoiceData, filename: req.file.originalname });
  } catch (err) {
    console.error('❌ parse-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;