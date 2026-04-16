const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const { fromBuffer } = require('pdf2pic');   // PDF को image में बदलने के लिए

// Optional: pdf2pic के लिए install करें `npm install pdf2pic`
// यदि नहीं लगाना चाहते, तो हम दूसरा तरीका उपयोग करेंगे – नीचे comment में बताया है।

router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });
    const dataBuffer = req.file.buffer;

    // Step 1: Try normal text extraction
    let extractedText = '';
    try {
      const data = await pdfParse(dataBuffer);
      extractedText = data.text;
    } catch (e) {
      console.warn('pdf-parse failed:', e.message);
    }

    // अगर टेक्स्ट बहुत छोटा है (image PDF) तो OCR करें
    if (!extractedText || extractedText.trim().length < 100) {
      console.log('⚠️ Low text content, switching to OCR...');
      
      // PDF को image में बदलने के लिए pdf2pic
      const pdf2pic = require('pdf2pic');
      const options = {
        density: 100,           // DPI
        saveFilename: "temp",
        savePath: "/tmp",       // अस्थायी फ़ोल्डर
        format: "png",
        width: 800,
        height: 600
      };
      const convert = pdf2pic.fromBuffer(dataBuffer, options);
      const pageImages = await convert.bulk(-1); // सभी pages

      let ocrText = '';
      for (const img of pageImages) {
        const { data: { text } } = await Tesseract.recognize(img.path, 'hin+eng', {
          logger: m => console.log(m) // optional
        });
        ocrText += text + '\n';
        // अस्थायी फ़ाइल हटाएँ
        require('fs').unlinkSync(img.path);
      }
      extractedText = ocrText;
    }

    if (!extractedText || extractedText.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract any text from PDF (even with OCR)' });
    }

    console.log(`✅ Extracted ${extractedText.length} chars from ${req.file.originalname}`);
    res.json({ text: extractedText, length: extractedText.length });
  } catch (err) {
    console.error('PDF parse error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;