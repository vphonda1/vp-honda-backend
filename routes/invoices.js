const router = require('express').Router();
const mongoose = require('mongoose');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Invoice Model
let Invoice;
try { Invoice = mongoose.model('Invoice'); } catch {
  Invoice = mongoose.model('Invoice', new mongoose.Schema({
    invoiceNumber: { type: String, index: true },
    invoiceType: { type: String, default: 'service' },
    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    customerId: { type: String, default: '' },
    vehicle: { type: String, default: '' },
    regNo: { type: String, default: '' },
    items: [{ type: mongoose.Schema.Types.Mixed }],
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
  }, { timestamps: true, strict: false }));
}

// ═══ PDF TEXT EXTRACTION (parse-pdf) ═══
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });
    console.log('Processing:', req.file.originalname);
    
    let text = '';
    try {
      const PDFParser = require('pdf-parse');
      const data = await PDFParser(req.file.buffer);
      text = data.text;
    } catch (err) {
      console.log('pdf-parse failed:', err.message);
    }
    
    if (!text || text.trim().length < 50) {
      // OCR fallback
      try {
        const axios = require('axios');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname });
        form.append('apikey', 'K85340860888957');
        form.append('language', 'eng');
        form.append('isOverlayRequired', 'false');
        const ocrRes = await axios.post('https://api.ocr.space/parse/image', form, { headers: form.getHeaders(), timeout: 120000 });
        if (!ocrRes.data.IsErroredOnProcessing) {
          text = ocrRes.data.ParsedResults.map(r => r.ParsedText).join('\n');
        }
      } catch (ocrErr) { console.log('OCR failed:', ocrErr.message); }
    }
    
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'PDF se text extract nahi ho paya' });
    }
    
    res.json({ success: true, text, extractionMethod: 'native', filename: req.file.originalname });
  } catch (err) {
    console.error('PDF Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ CRUD ═══
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
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) inv = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!inv) inv = await Invoice.findOneAndUpdate({ invoiceNumber: req.params.id }, req.body, { new: true });
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

// ═══ CLEAR & SYNC ═══
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
    if (list.length) await Invoice.insertMany(list, { ordered: false });
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;