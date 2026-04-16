const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const axios = require('axios');
const FormData = require('form-data');

const OCR_API_KEY = 'K85340860888957';  // आपकी दी हुई key

router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    console.log(`📄 Processing: ${req.file.originalname}`);
    
    const form = new FormData();
    form.append('file', req.file.buffer, { filename: req.file.originalname });
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

    let rawText = response.data.ParsedResults.map(r => r.ParsedText).join('\n');
    // साफ़ करें: extra spaces, multiple newlines
    let cleanText = rawText.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    
    if (!cleanText || cleanText.trim().length < 50) {
      return res.status(400).json({ error: 'OCR could not extract enough text' });
    }

    console.log(`✅ OCR extracted ${cleanText.length} chars`);
    // यहाँ raw text भी log करें (debugging के लिए)
    console.log('First 500 chars:', cleanText.slice(0,500));
    
    res.json({ text: cleanText, length: cleanText.length });
    
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;