// ════════════════════════════════════════════════════════════════════════════
// routes/storage.js — MongoDB की जगह कहाँ भर रही है, यह ठीक-ठीक बताने वाला tool
// ════════════════════════════════════════════════════════════════════════════
// क्यों बना:
//   MongoDB Atlas ने चेतावनी भेजी कि vp-honda cluster की 35% से कम जगह बची है.
//   Atlas सिर्फ़ collection-वार आकार दिखाता है — यह नहीं बताता कि किस *field*
//   में bytes पड़े हैं. यह tool वही बताता है, बिना कुछ मिटाए.
//
// इस्तेमाल (browser में सीधे खोलें):
//   /api/storage/report          → हर collection का आकार + सबसे भारी fields
//   /api/storage/inspect/<name>  → उस collection के सबसे भारी 5 documents
//   /api/storage/empty           → खाली पड़े collections (जगह घेर रहे हैं)
//
// मिटाने वाले काम जान-बूझकर POST रखे हैं और confirm माँगते हैं, ताकि गलती से
// browser में खुलकर कुछ मिट न जाए.
// ════════════════════════════════════════════════════════════════════════════
const router   = require('express').Router();
const mongoose = require('mongoose');

// कौन सा collection किस app का — एक ही cluster में दो apps चल रहे हैं
const VP_HONDA = new Set([
  'invoices','messages','servicedatas','salarypayments','parts','documents','sales',
  'appnotifications','vehicles','oldbikes','sessions','quotations','notificationlogs',
  'followups','pushsubscriptions','jobcards','salaryentities','users','staffs',
  'attendances','shopsettings','counters','customers','partconsumptions','paymentreceipts',
  'paymenttrackers','staffincentives','staffpenalties','vpdocuments','reminders',
  'visitors','pickupdrops','appointments','paymenttxns','servicecustomers',
  'newcustomers','genericdatas','parttransactions','penalties','penaltytrackers',
  'otpverifications',
]);
const FINANCE_ERP = new Set([
  'applications','emischedules','loans','cibillogs','cibilreports','repossessions',
  'branches','payments','emicollections','customerotps','verificationtokens',
  'backups','bankstatements','collectiontrackers','completeapplications','drafts',
  'financecompanies','auditlogs','investigations',
]);

const mb = b => (b / 1048576).toFixed(2) + ' MB';
const kb = b => b >= 1048576 ? mb(b) : (b / 1024).toFixed(1) + ' kB';

/** किसी document में कौन सा field कितने bytes ले रहा है */
function fieldSizes(doc, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(doc || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      out[key] = (out[key] || 0) + v.length;
      // base64 की पहचान — यही असली जगह-खाऊ होता है
      if (v.length > 5000 && /^data:|^[A-Za-z0-9+/=\s]{5000,}$/.test(v.slice(0, 6000))) {
        out[key + '  ⚠️BASE64'] = (out[key + '  ⚠️BASE64'] || 0) + v.length;
      }
    } else if (Buffer.isBuffer(v)) {
      out[key + '  ⚠️BINARY'] = (out[key + '  ⚠️BINARY'] || 0) + v.length;
    } else if (Array.isArray(v)) {
      v.slice(0, 50).forEach(item => {
        if (typeof item === 'string') out[key + '[]'] = (out[key + '[]'] || 0) + item.length;
        else if (item && typeof item === 'object') fieldSizes(item, key + '[]', out);
      });
    } else if (typeof v === 'object') {
      fieldSizes(v, key, out);
    }
  }
  return out;
}

// ── 1. पूरी रिपोर्ट ─────────────────────────────────────────────────────────
router.get('/report', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const cols = await db.listCollections().toArray();
    const rows = [];
    let totalStorage = 0, totalData = 0;

    for (const c of cols) {
      let st;
      try { st = await db.command({ collStats: c.name }); }
      catch { continue; }
      const owner = VP_HONDA.has(c.name) ? 'VP Honda'
                  : FINANCE_ERP.has(c.name) ? 'Finance ERP' : 'अज्ञात';
      totalStorage += st.storageSize || 0;
      totalData    += st.size || 0;
      rows.push({
        collection: c.name,
        owner,
        documents: st.count || 0,
        dataSize: st.size || 0,
        storageSize: st.storageSize || 0,
        indexSize: st.totalIndexSize || 0,
        avgDocSize: st.count ? Math.round((st.size || 0) / st.count) : 0,
      });
    }

    rows.sort((a, b) => b.dataSize - a.dataSize);

    const byOwner = {};
    rows.forEach(r => {
      byOwner[r.owner] = byOwner[r.owner] || { dataSize: 0, storageSize: 0, collections: 0 };
      byOwner[r.owner].dataSize += r.dataSize;
      byOwner[r.owner].storageSize += r.storageSize;
      byOwner[r.owner].collections++;
    });

    res.json({
      ok: true,
      कुल: { data: mb(totalData), storage: mb(totalStorage) },
      किसका_कितना: Object.fromEntries(Object.entries(byOwner).map(([k, v]) => [k, {
        collections: v.collections, data: mb(v.dataSize), storage: mb(v.storageSize),
      }])),
      सबसे_भारी: rows.slice(0, 15).map(r => ({
        collection: r.collection, owner: r.owner, documents: r.documents,
        data: kb(r.dataSize), storage: kb(r.storageSize),
        प्रति_document: kb(r.avgDocSize),
        चेतावनी: r.avgDocSize > 500000 ? '⚠️ हर document बहुत भारी — अंदर base64 फ़ाइलें हो सकती हैं' : undefined,
      })),
      खाली: rows.filter(r => r.documents === 0).map(r => r.collection),
      अगला_कदम: '/api/storage/inspect/<collection-name> खोलकर देखें कि कौन सा field भारी है',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 2. किसी एक collection के अंदर झाँको ─────────────────────────────────────
router.get('/inspect/:name', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const col = db.collection(req.params.name);
    const docs = await col.find({}).limit(200).toArray();
    if (!docs.length) return res.json({ ok: true, collection: req.params.name, documents: 0, संदेश: 'खाली है' });

    const sized = docs.map(d => {
      const json = JSON.stringify(d);
      return { _id: String(d._id), bytes: json.length, doc: d };
    }).sort((a, b) => b.bytes - a.bytes);

    // सबसे भारी 5 documents में कौन से fields जगह खा रहे हैं
    const heavy = sized.slice(0, 5).map(x => {
      const fs = fieldSizes(x.doc);
      const top = Object.entries(fs).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([f, n]) => ({ field: f, size: kb(n), प्रतिशत: Math.round((n / x.bytes) * 100) + '%' }));
      return {
        _id: x._id,
        कुल: kb(x.bytes),
        पहचान: x.doc.applicationNo || x.doc.customerName || x.doc.name || x.doc.regNo || '—',
        भारी_fields: top,
      };
    });

    // पूरे collection में किस field ने सबसे ज़्यादा जगह ली
    const agg = {};
    sized.forEach(x => {
      const fs = fieldSizes(x.doc);
      for (const [f, n] of Object.entries(fs)) agg[f] = (agg[f] || 0) + n;
    });

    res.json({
      ok: true,
      collection: req.params.name,
      जाँचे_गए_documents: docs.length,
      सबसे_भारी_documents: heavy,
      पूरे_collection_में_भारी_fields: Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([f, n]) => ({ field: f, कुल: kb(n) })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 3. खाली collections ─────────────────────────────────────────────────────
router.get('/empty', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const cols = await db.listCollections().toArray();
    const empty = [];
    for (const c of cols) {
      const n = await db.collection(c.name).estimatedDocumentCount();
      if (n === 0) {
        let st = {};
        try { st = await db.command({ collStats: c.name }); } catch {}
        empty.push({
          collection: c.name,
          owner: VP_HONDA.has(c.name) ? 'VP Honda' : FINANCE_ERP.has(c.name) ? 'Finance ERP' : 'अज्ञात',
          storage: kb(st.storageSize || 0),
        });
      }
    }
    res.json({
      ok: true, खाली_collections: empty.length, सूची: empty,
      कैसे_हटाएँ: 'POST /api/storage/drop-empty?confirm=DELETE-EMPTY',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 4. खाली collections हटाओ (confirm ज़रूरी) ────────────────────────────────
// ⚠️ सिर्फ़ वही हटते हैं जिनमें एक भी document नहीं है — कोई डेटा नहीं जाता.
router.post('/drop-empty', async (req, res) => {
  if (req.query.confirm !== 'DELETE-EMPTY') {
    return res.status(400).json({ error: 'सुरक्षा के लिए ?confirm=DELETE-EMPTY लगाना ज़रूरी है' });
  }
  try {
    const db = mongoose.connection.db;
    const cols = await db.listCollections().toArray();
    const dropped = [];
    for (const c of cols) {
      const n = await db.collection(c.name).estimatedDocumentCount();
      if (n === 0) { await db.collection(c.name).drop().catch(() => {}); dropped.push(c.name); }
    }
    res.json({ ok: true, हटाए: dropped.length, सूची: dropped,
      नोट: 'Mongoose इन्हें अगली ज़रूरत पर अपने आप बना लेगा — कुछ टूटेगा नहीं' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 5. compact — मिटाए हुए documents की खाली जगह वापस लो ────────────────────
router.post('/compact/:name', async (req, res) => {
  if (req.query.confirm !== 'COMPACT') {
    return res.status(400).json({ error: '?confirm=COMPACT लगाना ज़रूरी है' });
  }
  try {
    const out = await mongoose.connection.db.command({ compact: req.params.name });
    res.json({ ok: true, collection: req.params.name, result: out });
  } catch (err) {
    res.status(500).json({ error: err.message,
      नोट: 'M0 (free) tier पर compact नहीं चलता. वहाँ documents मिटाने पर जगह अपने आप धीरे-धीरे वापस मिलती है.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 6. ⭐ DOCUMENT VAULT की जाँच — यही VP Honda का सबसे बड़ा जगह-खाऊ है
// ════════════════════════════════════════════════════════════════════════════
// `vpdocuments` में हर file दो तरह से रह सकती है:
//   fileUrl   → Cloudinary पर (MongoDB में सिर्फ़ ~200 bytes का link)
//   fileData  → base64 (पूरी file MongoDB के अंदर — यही जगह खाता है)
//
// Cloudinary पर migrate करते समय पुराने records का `fileData` हटाया नहीं गया
// था. यानी बहुत सी files **दो जगह** पड़ी हैं — Cloudinary पर भी, और base64
// में भी. वह base64 अब बेकार है, सिर्फ़ जगह खा रहा है.
router.get('/vault-audit', async (req, res) => {
  try {
    const col = mongoose.connection.db.collection('vpdocuments');
    const docs = await col.find({}, {
      projection: { fileUrl: 1, fileType: 1, fileName: 1, folder: 1, customerName: 1,
                    storageType: 1, savedAt: 1, fileDataLen: { $strLenCP: { $ifNull: ['$fileData', ''] } } },
    }).toArray().catch(async () => {
      // पुराने MongoDB में $strLenCP projection न चले तो एक-एक करके नापो
      const all = await col.find({}).toArray();
      return all.map(d => ({ ...d, fileDataLen: (d.fileData || '').length }));
    });

    let safeToStrip = 0, safeBytes = 0;      // Cloudinary पर है + base64 भी है
    let onlyBase64  = 0, onlyBytes = 0;      // सिर्फ़ base64 — पहले upload करना होगा
    let onlyCloud   = 0, empty = 0;
    const strippable = [];

    for (const d of docs) {
      const hasUrl = !!(d.fileUrl && String(d.fileUrl).includes('res.cloudinary.com'));
      const len = d.fileDataLen || 0;
      if (hasUrl && len > 0) {
        safeToStrip++; safeBytes += len;
        if (strippable.length < 20) strippable.push({
          _id: String(d._id), file: d.fileName || '—', folder: d.folder || '—',
          customer: d.customerName || '—', base64: kb(len),
        });
      }
      else if (!hasUrl && len > 0) { onlyBase64++; onlyBytes += len; }
      else if (hasUrl) onlyCloud++;
      else empty++;
    }

    res.json({
      ok: true,
      कुल_documents: docs.length,
      सुरक्षित_हटाने_योग्य: {
        documents: safeToStrip,
        जगह: kb(safeBytes),
        मतलब: 'ये files Cloudinary पर भी हैं और base64 में भी. base64 हटाना पूरी तरह सुरक्षित है.',
      },
      सिर्फ़_base64_में: {
        documents: onlyBase64,
        जगह: kb(onlyBytes),
        मतलब: 'इन्हें पहले Cloudinary पर भेजना होगा, तभी base64 हटाया जा सकता है. अभी मत छेड़ें.',
      },
      सिर्फ़_Cloudinary_पर: onlyCloud,
      खाली: empty,
      नमूना: strippable,
      कैसे_हटाएँ: safeToStrip > 0
        ? 'POST /api/storage/vault-strip?confirm=STRIP-DUPLICATE-BASE64'
        : 'अभी कुछ सुरक्षित हटाने योग्य नहीं है',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 7. ⭐ दोहरा पड़ा base64 हटाओ (सिर्फ़ वहीं जहाँ Cloudinary URL मौजूद है) ──
// ⚠️ यह सिर्फ़ `fileData` field हटाता है, वह भी सिर्फ़ उन documents से जिनका
//    `fileUrl` Cloudinary का असली URL है. file ख़ुद Cloudinary पर सुरक्षित रहती है.
router.post('/vault-strip', async (req, res) => {
  if (req.query.confirm !== 'STRIP-DUPLICATE-BASE64') {
    return res.status(400).json({ error: 'सुरक्षा के लिए ?confirm=STRIP-DUPLICATE-BASE64 लगाना ज़रूरी है' });
  }
  try {
    const col = mongoose.connection.db.collection('vpdocuments');
    const out = await col.updateMany(
      {
        fileUrl: { $regex: 'res\\.cloudinary\\.com' },
        fileData: { $exists: true, $ne: null, $ne: '' },
      },
      { $unset: { fileData: '' }, $set: { storageType: 'cloudinary' } }
    );
    res.json({
      ok: true,
      साफ़_किए: out.modifiedCount,
      नोट: 'files Cloudinary पर सुरक्षित हैं — सिर्फ़ MongoDB वाली दोहरी copy हटी है.',
      अगला: 'Atlas पर जगह घटने में कुछ मिनट लग सकते हैं (M0 पर compact नहीं चलता).',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 8. auditlogs की जाँच (यह collection VP Honda का नहीं है) ─────────────────
// VP Honda के पूरे code में 'auditlog' शब्द कहीं नहीं है — यह Finance ERP का है.
// यहाँ सिर्फ़ पढ़कर बताते हैं कि इतनी जगह क्यों जा रही है. कुछ मिटाते नहीं.
router.get('/auditlog-audit', async (req, res) => {
  try {
    const col = mongoose.connection.db.collection('auditlogs');
    const total = await col.estimatedDocumentCount();
    if (!total) return res.json({ ok: true, documents: 0, संदेश: 'खाली है' });

    const sample = await col.find({}).sort({ _id: -1 }).limit(30).toArray();
    const sized = sample.map(d => ({ d, bytes: JSON.stringify(d).length }))
                        .sort((a, b) => b.bytes - a.bytes);

    const agg = {};
    sized.forEach(x => {
      for (const [f, n] of Object.entries(fieldSizes(x.d))) agg[f] = (agg[f] || 0) + n;
    });

    const oldest = await col.find({}).sort({ _id: 1 }).limit(1).toArray();
    const newest = await col.find({}).sort({ _id: -1 }).limit(1).toArray();

    res.json({
      ok: true,
      documents: total,
      मालिक: 'Finance ERP (VP Honda के code में auditlog कहीं नहीं है)',
      सबसे_भारी_entry: kb(sized[0]?.bytes || 0),
      औसत_entry: kb(sized.reduce((n, x) => n + x.bytes, 0) / (sized.length || 1)),
      सबसे_पुराना: oldest[0]?.createdAt || oldest[0]?._id?.getTimestamp?.() || '—',
      सबसे_नया:   newest[0]?.createdAt || newest[0]?._id?.getTimestamp?.() || '—',
      जगह_खाने_वाले_fields: Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([f, n]) => ({ field: f, नमूने_में: kb(n) })),
      सलाह: 'अगर किसी field में पूरा document snapshot (base64 समेत) भरा जा रहा है, ' +
            'तो audit log में सिर्फ़ बदले हुए fields के नाम रखें — पूरी copy नहीं.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message, नोट: 'auditlogs collection शायद मौजूद नहीं' });
  }
});

module.exports = router;
