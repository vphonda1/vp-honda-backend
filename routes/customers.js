const router = require('express').Router();
const Customer = require('../models/Customer');

router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { customerName, phone, name } = req.body;
    const cName = customerName || name || '';
    const cPhone = phone || '';
    if (cName && cPhone) {
      const existing = await Customer.findOne({ 
        $or: [
          { customerName: cName, phone: cPhone },
          { name: cName, phone: cPhone },
        ]
      });
      if (existing) {
        Object.assign(existing, req.body);
        await existing.save();
        return res.json(existing);
      }
    }
    const customer = await Customer.create(req.body);
    res.status(201).json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛡️ /sync — पूरी customer list बदलता है (पहले सब मिटाकर नई लिस्ट डालता है)।
//    सुरक्षा (नया):
//    1) हर sync से पहले पुरानी लिस्ट का backup (collection: customer_backups, आख़िरी 8 रखे जाते हैं)
//    2) अगर नई लिस्ट पुरानी से आधे से ज़्यादा छोटी हो (और पुरानी में 5+ customers हों) तो
//       तब तक रोक देता है जब तक body में force:true न हो — ताकि कोई दूसरा पेज/पुराना
//       local data गलती से सारे customers न मिटा दे। Customer Management पेज force:true भेजता है।
//    3) अगर डालते समय सब fail हो जाए तो backup से अपने-आप वापस
// ─────────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const BACKUP_KEEP = 8;
const backupCol = () => mongoose.connection.collection('customer_backups');

async function takeBackup(reason) {
  const existing = await Customer.find({}).lean();
  if (!existing.length) return { count: 0, id: null };
  const r = await backupCol().insertOne({ savedAt: new Date(), count: existing.length, reason, customers: existing });
  const old = await backupCol().find({}, { projection: { _id: 1 } }).sort({ savedAt: -1 }).skip(BACKUP_KEEP).toArray();
  if (old.length) await backupCol().deleteMany({ _id: { $in: old.map(o => o._id) } });
  return { count: existing.length, id: r.insertedId };
}

router.post('/sync', async (req, res) => {
  try {
    const list = req.body.customers || req.body;
    const force = req.body && req.body.force === true;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });

    const existingCount = await Customer.countDocuments({});
    if (!force && existingCount >= 5 && list.length < existingCount * 0.5) {
      console.warn(`🛡️ /sync रोका: database में ${existingCount} customers, आने वाली लिस्ट सिर्फ़ ${list.length} की (force नहीं)`);
      return res.status(409).json({
        error: `सुरक्षा: database में ${existingCount} customers हैं, नई लिस्ट सिर्फ़ ${list.length} की है — नहीं बदला गया।`,
        existing: existingCount, incoming: list.length,
      });
    }

    const backup = existingCount > 0 ? await takeBackup(force ? 'sync-force' : 'sync') : { count: 0, id: null };
    await Customer.deleteMany({});
    try {
      if (list.length > 0) await Customer.insertMany(list, { ordered: false });
    } catch (insErr) {
      const nowCount = await Customer.countDocuments({});
      if (nowCount === 0 && backup.id) {
        const b = await backupCol().findOne({ _id: backup.id });
        if (b && b.customers && b.customers.length) await Customer.insertMany(b.customers, { ordered: false });
        console.error('❌ /sync insert fail — backup से वापस किया:', insErr.message);
        return res.status(500).json({ error: 'Insert fail हुआ, पुराना data वापस रखा गया: ' + insErr.message });
      }
      console.warn('⚠️ /sync partial insert:', insErr.message);
    }
    res.json({ success: true, count: await Customer.countDocuments({}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// backup की लिस्ट देखें:   GET  /api/customers/backups
router.get('/backups', async (req, res) => {
  try {
    const rows = await backupCol().find({}, { projection: { customers: 0 } }).sort({ savedAt: -1 }).toArray();
    res.json(rows.map(r => ({ id: r._id, savedAt: r.savedAt, count: r.count, reason: r.reason })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// किसी backup से वापस लाएँ:   POST /api/customers/restore/<id>   (वापस लाने से पहले मौजूदा का भी backup बनता है)
router.post('/restore/:id', async (req, res) => {
  try {
    const b = await backupCol().findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
    if (!b || !Array.isArray(b.customers)) return res.status(404).json({ error: 'Backup नहीं मिला' });
    await takeBackup('before-restore');
    await Customer.deleteMany({});
    await Customer.insertMany(b.customers, { ordered: false });
    res.json({ success: true, restored: b.customers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;