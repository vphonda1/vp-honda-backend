const router   = require('express').Router();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ ज़रूरी सुधार — `customers` collection खाली हो गया था
// ════════════════════════════════════════════════════════════════════════════
// MongoDB में `customers` में 0 documents बचे थे, जबकि असली ग्राहक
// `servicedatas` (872) और `invoices` (845) में हैं.
//
// इसका असर सिर्फ़ एक page पर नहीं था — ये 8 जगह `/api/customers` पर टिकी हैं:
//   DocumentVault (नाम टाइप करने पर dropdown), UniversalSearch, PaymentTracker,
//   VehDashboard, CustomerServiceProfile, CustomerServiceDataManager,
//   RemindersPage, CustomerManagement
// खाली list का मतलब था — dropdown कभी दिखता ही नहीं, खोज कुछ नहीं ढूँढती.
//
// अब: `customers` में जो है वह तो मिलता ही है, साथ में `servicedatas` और
// `invoices` से भी ग्राहक निकालकर जोड़ दिए जाते हैं. phone (आख़िरी 10 अंक) से
// पहचान होती है इसलिए एक ही ग्राहक दो बार नहीं आता.
// ════════════════════════════════════════════════════════════════════════════

const phoneKey = p => String(p || '').replace(/\D/g, '').slice(-10);
const nameKey  = n => String(n || '').replace(/^\d+\s*/, '').trim().toLowerCase();

/** ग्राहक की पहचान — phone हो तो वही, वरना नाम */
const identity = (name, phone) => phoneKey(phone) || nameKey(name);

router.get('/', async (req, res) => {
  try {
    const merged = new Map();

    const put = (rec, source) => {
      const id = identity(rec.customerName, rec.phone);
      if (!id) return;
      const old = merged.get(id);
      if (!old) { merged.set(id, { ...rec, _sources: [source] }); return; }
      // पहले से है — जो खाना खाली हो उसे भर दो (कुछ खोए नहीं)
      for (const [k, v] of Object.entries(rec)) {
        if (v !== undefined && v !== null && v !== '' &&
            (old[k] === undefined || old[k] === null || old[k] === '')) old[k] = v;
      }
      if (!old._sources.includes(source)) old._sources.push(source);
    };

    // 1️⃣ असली customers collection (जो भी बचा हो) — इसे सबसे ज़्यादा भरोसेमंद मानो
    const real = await Customer.find().sort({ createdAt: -1 }).lean();
    real.forEach(c => put({
      _id: c._id, customerName: c.customerName || c.name || '',
      name: c.customerName || c.name || '',
      phone: c.phone || c.mobileNo || '', alternatePhone: c.alternatePhone || '',
      aadhar: c.aadhar || c.aadharNo || '', registrationNo: c.registrationNo || c.regNo || '',
      vehicleModel: c.vehicleModel || '', chassisNo: c.chassisNo || '',
      address: c.address || '', createdAt: c.createdAt,
      ...c,
    }, 'customers'));

    const db = mongoose.connection.db;

    // 2️⃣ servicedatas — सबसे भरी हुई collection
    try {
      const sd = await db.collection('servicedatas').find({}, { projection: {
        regNo:1, customerName:1, phone:1, vehicle:1, chassisNo:1, aadhar:1,
        purchaseDate:1, address:1,
      } }).toArray();
      sd.forEach(d => put({
        customerName: d.customerName || '', name: d.customerName || '',
        phone: d.phone || '', registrationNo: d.regNo || '',
        vehicleModel: d.vehicle || '', chassisNo: d.chassisNo || '',
        aadhar: d.aadhar || '', address: d.address || '',
        createdAt: d.purchaseDate || null,
      }, 'servicedatas'));
    } catch {}

    // 3️⃣ invoices — जिनका service record नहीं बना, वे भी मिल जाएँ
    try {
      const inv = await db.collection('invoices').find({}, { projection: {
        customerName:1, customerPhone:1, phone:1, regNo:1, vehicle:1,
        vehicleModel:1, chassisNo:1, invoiceDate:1, customerAddress:1,
      } }).toArray();
      inv.forEach(i => put({
        customerName: i.customerName || '', name: i.customerName || '',
        phone: i.customerPhone || i.phone || '', registrationNo: i.regNo || '',
        vehicleModel: i.vehicle || i.vehicleModel || '', chassisNo: i.chassisNo || '',
        address: i.customerAddress || '', createdAt: i.invoiceDate || null,
      }, 'invoices'));
    } catch {}

    const out = [...merged.values()]
      .filter(c => (c.customerName || '').trim())
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── कहाँ से कितने ग्राहक आ रहे हैं — जाँचने के लिए ──────────────────────────
router.get('/sources', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const count = async n => { try { return await db.collection(n).countDocuments(); } catch { return 0; } };
    const inCustomers = await Customer.countDocuments();
    res.json({
      ok: true,
      customers_collection: inCustomers,
      servicedatas: await count('servicedatas'),
      invoices: await count('invoices'),
      नोट: inCustomers === 0
        ? '⚠️ customers collection खाली है — नाम अब servicedatas + invoices से आ रहे हैं'
        : 'customers collection में डेटा मौजूद है',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

router.post('/sync', async (req, res) => {
  try {
    const list = req.body.customers || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Customer.deleteMany({});
    if (list.length > 0) await Customer.insertMany(list, { ordered: false });
    res.json({ success: true, count: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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