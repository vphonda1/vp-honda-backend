const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');

router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF' });
    const buffer = req.file.buffer;

    // 1. पहले pdf-parse से कोशिश
    let text = '';
    try {
      const data = await pdfParse(buffer);
      text = data.text;
    } catch(e) { console.warn('pdf-parse failed:', e.message); }

    // 2. अगर टेक्स्ट कम है तो OCR.space का उपयोग करें
    if (!text || text.trim().length < 100) {
      console.log('Using OCR.space...');
      const form = new FormData();
      form.append('file', buffer, { filename: req.file.originalname });
      form.append('apikey', 'K85340860888957'); // ← यहाँ अपनी API key लगाएँ
      form.append('language', 'hin');
      const response = await axios.post('https://api.ocr.space/parse/image', form, {
        headers: form.getHeaders(),
        timeout: 60000
      });
      if (response.data.IsErroredOnProcessing) throw new Error(response.data.ErrorMessage?.[0]);
      text = response.data.ParsedResults.map(r => r.ParsedText).join('\n');
    }

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'No text extracted' });
    }

    res.json({ text, length: text.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;