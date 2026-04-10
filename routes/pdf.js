const router = require('express').Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/parse-pdf — Extract text from uploaded PDF
router.post('/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const result = await pdfParse(req.file.buffer);
    const text = result.text || '';

    // Extract customer name from filename if present
    let customerName = '';
    const origName = req.file.originalname || '';
    const nameMatch = origName.match(/_\d+_([A-Z_]+)\./);
    if (nameMatch) customerName = nameMatch[1].replace(/_/g, ' ').trim();

    res.json({
      text,
      pages: result.numpages,
      customerName,
      filename: origName,
    });
  } catch (err) {
    console.error('PDF parse error:', err.message);
    res.status(500).json({ error: 'PDF parsing failed: ' + err.message });
  }
});

module.exports = router;
