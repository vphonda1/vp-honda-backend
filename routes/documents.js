// routes/documents.js — VP Honda Document Vault API
// 🆕 VERSION-2026-08-17: PUT route जोड़ा (compressed PDF से replace करने के लिए)
//    + पुरानी बड़ी file Cloudinary से अपने-आप delete (storage नहीं भरेगा)
const express  = require('express');
const router   = express.Router();
const VpDoc    = require('../models/VpDocument');

// ── Cloudinary (वैकल्पिक) ─────────────────────────────────────────────────────
// अगर cloudinary package install है और env में keys हैं, तभी पुरानी file delete होगी।
// नहीं है तो कुछ नहीं टूटेगा — बस purani file Cloudinary पर पड़ी रहेगी।
let cloudinary = null;
try {
  if (process.env.CLOUDINARY_API_SECRET) {
    cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('[documents] Cloudinary cleanup ready');
  }
} catch (e) {
  console.log('[documents] Cloudinary cleanup off:', e.message);
}

// Cloudinary URL से public_id निकालें
// जैसे: https://res.cloudinary.com/xx/image/upload/v1712/vp-honda-docs/abc.pdf
//   →   { publicId: 'vp-honda-docs/abc', resourceType: 'image' }
function parseCloudinaryUrl(url) {
  try {
    if (!url || !url.includes('res.cloudinary.com')) return null;
    const m = url.match(/\/(image|raw|video)\/upload\/(.+)$/);
    if (!m) return null;
    let path = m[2]
      .replace(/^v\d+\//, '')            // version हटाएं
      .replace(/^[^/]*[,_][^/]*\//, '')  // transformation हो तो हटाएं
      .replace(/\.[a-zA-Z0-9]+$/, '');   // extension हटाएं
    return { publicId: path, resourceType: m[1] };
  } catch { return null; }
}

async function destroyAsset(url) {
  if (!cloudinary || !url) return false;
  const p = parseCloudinaryUrl(url);
  if (!p) return false;
  try {
    const r = await cloudinary.uploader.destroy(p.publicId, { resource_type: p.resourceType, invalidate: true });
    console.log('[documents] purani file delete:', p.publicId, r.result);
    return r.result === 'ok';
  } catch (e) {
    console.warn('[documents] delete fail:', e.message);
    return false;
  }
}

// ── GET all (fileData के बिना — list तेज़ रहे) ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const docs = await VpDoc.find({})
      .select('-fileData')  // fileData exclude (large base64)
      .sort({ createdAt: -1 })
      .lean();
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET single (fileData के साथ) ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await VpDoc.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST save ────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const doc = new VpDoc(req.body);
    await doc.save();
    const { fileData, ...rest } = doc.toObject();
    res.status(201).json(rest);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── 🆕 PUT update ────────────────────────────────────────────────────────────
// इसी से compressed (छोटी) PDF पुरानी बड़ी file की जगह ले लेती है।
// body में oldFileUrl आए तो वो file Cloudinary से भी हटा दी जाती है।
router.put('/:id', async (req, res) => {
  try {
    const { oldFileUrl, ...updates } = req.body || {};

    // सिर्फ इन्हीं fields को बदलने दें (सुरक्षा)
    const allowed = [
      'fileUrl', 'fileData', 'fileType', 'fileName', 'storageType', 'compressedKB',
      'customerName', 'customerPhone', 'aadharNo', 'vehicleModel', 'chassisNo',
      'nomineeName', 'hypothecation', 'docType', 'docTypeLabel', 'expiryDate', 'notes',
    ];
    const $set = {};
    for (const k of allowed) if (updates[k] !== undefined) $set[k] = updates[k];
    if (!Object.keys($set).length) return res.status(400).json({ error: 'कुछ update करने को नहीं मिला' });
    $set.updatedAt = new Date();

    const doc = await VpDoc.findByIdAndUpdate(req.params.id, { $set }, { new: true })
      .select('-fileData')
      .lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // ✅ पुरानी बड़ी file हटाएं — तभी, जब नई file सचमुच अलग हो
    if (oldFileUrl && $set.fileUrl && oldFileUrl !== $set.fileUrl) {
      destroyAsset(oldFileUrl).catch(() => {});   // background में, response रोके बिना
    }

    res.json(doc);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const doc = await VpDoc.findById(req.params.id).select('fileUrl').lean();
    await VpDoc.findByIdAndDelete(req.params.id);
    if (doc?.fileUrl) destroyAsset(doc.fileUrl).catch(() => {});  // Cloudinary से भी हटे
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
