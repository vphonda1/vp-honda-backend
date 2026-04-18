const router = require('express').Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const PDFParser = require('pdf-parse');
const axios = require('axios');
const FormData = require('form-data');

const OCR_API_KEY = 'K85340860888957';

// Native PDF text extraction
const extractTextFromPDF = async (pdfBuffer) => {
  try {
    const data = await PDFParser(pdfBuffer);
    return data.text;
  } catch (err) {
    console.warn('PDF-parse failed:', err.message);
    return null;
  }
};

// OCR fallback for scanned PDFs
const extractTextUsingOCR = async (pdfBuffer, filename) => {
  try {
    console.log(`OCR trying: ${filename}`);
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
      console.log(`OCR extracted ${cleanText.length} chars`);
      return cleanText;
    }
    return null;
  } catch (err) {
    console.error('OCR error:', err.message);
    return null;
  }
};

// Smart extraction: try native first, then OCR
const smartExtractText = async (pdfBuffer, filename) => {
  let text = await extractTextFromPDF(pdfBuffer);
  
  if (text && text.trim().length > 50) {
    return { text, method: 'native' };
  }
  
  console.log('Native failed, trying OCR...');
  text = await extractTextUsingOCR(pdfBuffer, filename);
  
  if (text && text.trim().length > 50) {
    return { text, method: 'ocr' };
  }
  
  throw new Error('Could not extract text from PDF');
};

// ROUTE: Extract text from PDF (frontend will parse)
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file' });

    console.log(`Processing: ${req.file.originalname}`);
    const { text, method } = await smartExtractText(req.file.buffer, req.file.originalname);
    
    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'PDF में insufficient data' });
    }

    res.json({
      success: true,
      text: text,
      extractionMethod: method,
      filename: req.file.originalname
    });

  } catch (err) {
    console.error('PDF Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;