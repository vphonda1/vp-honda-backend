const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');

// अपनी API key यहाँ लगाएँ (मुफ्त key: https://ocr.space/OCRAPI)
const OCR_API_KEY = 'K85340860888957'; // ← यदि काम न करे तो रजिस्टर करें

router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF' });
    const buffer = req.file.buffer;

    // पहले normal pdf-parse से कोशिश
    let text = '';
    try {
      const data = await pdfParse(buffer);
      text = data.text || '';
    } catch(e) { console.warn('pdf-parse failed:', e.message); }

    // अगर टेक्स्ट बहुत कम है (image PDF), तो OCR.space का उपयोग करें
    if (!text || text.trim().length < 100) {
      console.log('🔍 Low text, using OCR.space...');
      const form = new FormData();
      form.append('file', buffer, { filename: req.file.originalname });
      form.append('apikey', OCR_API_KEY);
      form.append('language', 'eng');      // अंग्रेज़ी (parts, numbers)
      form.append('isOverlayRequired', 'false');
      form.append('detectOrientation', 'true');

      const response = await axios.post('https://api.ocr.space/parse/image', form, {
        headers: form.getHeaders(),
        timeout: 120000
      });

      if (response.data.IsErroredOnProcessing) {
        throw new Error(response.data.ErrorMessage?.[0] || 'OCR failed');
      }
      text = response.data.ParsedResults.map(r => r.ParsedText).join('\n');
      console.log('✅ OCR extracted', text.length, 'chars');
    }

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract any text' });
    }

    res.json({ text, length: text.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;