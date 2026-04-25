// routes/attendance.js
const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const ShopSettings = require('../models/ShopSettings');

// Haversine distance calculation (meters)
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // earth radius in meters
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// GET all attendance (with filters)
router.get('/', async (req, res) => {
  try {
    const { staffId, date, fromDate, toDate, month, year } = req.query;
    const query = {};
    if (staffId) query.staffId = staffId;
    if (date) query.date = date;
    if (fromDate && toDate) query.date = { $gte: fromDate, $lte: toDate };
    if (month && year) {
      const mm = String(month).padStart(2,'0');
      query.date = { $regex: `^${year}-${mm}` };
    }
    const records = await Attendance.find(query).sort({ date: -1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET today's attendance for a staff
router.get('/today/:staffId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const att = await Attendance.findOne({ staffId: req.params.staffId, date: today });
    res.json(att || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST check-in (with GPS verification)
router.post('/check-in', async (req, res) => {
  try {
    const { staffId, staffName, lat, lng } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });
    if (lat == null || lng == null) return res.status(400).json({ error: 'GPS location required. Enable location services.' });

    // Get shop settings
    const shop = await ShopSettings.findOne({ key: 'main' }) || { shopLat: null, shopLng: null, allowedRadius: 100 };
    if (!shop.shopLat || !shop.shopLng) {
      return res.status(400).json({ error: 'Shop location not set. Admin को पहले shop GPS set करना होगा।' });
    }

    const distance = calcDistance(lat, lng, shop.shopLat, shop.shopLng);
    const valid = distance <= (shop.allowedRadius || 100);

    if (!valid) {
      return res.status(403).json({
        error: `❌ आप showroom से ${distance}m दूर हैं। Check-in सिर्फ शोरूम के ${shop.allowedRadius}m के अंदर हो सकती है।`,
        distance,
        allowedRadius: shop.allowedRadius,
      });
    }

    // Check if already checked-in today
    const today = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ staffId, date: today });
    if (existing?.checkInTime) {
      return res.status(400).json({ error: 'आज की check-in पहले से हो चुकी है' });
    }

    // Create/update check-in
    const now = new Date();
    const time = now.toTimeString().slice(0, 8); // HH:MM:SS
    const lateAfter = (shop.lateAfter || '09:30').split(':');
    const lateH = parseInt(lateAfter[0]); const lateM = parseInt(lateAfter[1]);
    const isLate = now.getHours() > lateH || (now.getHours() === lateH && now.getMinutes() > lateM);

    const data = {
      staffId, staffName: staffName || '', date: today,
      checkInTime: time, status: 'Present', isLate,
      checkInLat: lat, checkInLng: lng, checkInDistance: distance, checkInValid: true,
    };

    let result;
    if (existing) {
      result = await Attendance.findByIdAndUpdate(existing._id, data, { new: true });
    } else {
      result = await Attendance.create(data);
    }

    res.json({
      success: true,
      attendance: result,
      message: `✅ Check-in सफल! समय: ${time}${isLate ? ' ⚠️ (लेट)' : ''}`,
      distance,
      isLate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST check-out (with GPS verification)
router.post('/check-out', async (req, res) => {
  try {
    const { staffId, lat, lng } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });
    if (lat == null || lng == null) return res.status(400).json({ error: 'GPS location required' });

    const today = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ staffId, date: today });
    if (!existing?.checkInTime) return res.status(400).json({ error: 'पहले Check-in करें' });
    if (existing.checkOutTime) return res.status(400).json({ error: 'Check-out पहले से हो चुकी है' });

    const shop = await ShopSettings.findOne({ key: 'main' }) || { shopLat: null, shopLng: null, allowedRadius: 100 };
    const distance = shop.shopLat ? calcDistance(lat, lng, shop.shopLat, shop.shopLng) : 0;
    const valid = distance <= (shop.allowedRadius || 100);

    if (!valid && shop.shopLat) {
      return res.status(403).json({
        error: `❌ Check-out भी showroom से होगी। आप ${distance}m दूर हैं।`,
        distance, allowedRadius: shop.allowedRadius,
      });
    }

    const now = new Date();
    const time = now.toTimeString().slice(0, 8);

    // Calculate hours worked
    const [ih, im, is] = existing.checkInTime.split(':').map(Number);
    const inMinutes = ih * 60 + im;
    const outMinutes = now.getHours() * 60 + now.getMinutes();
    const hoursWorked = ((outMinutes - inMinutes) / 60).toFixed(2);

    const result = await Attendance.findByIdAndUpdate(existing._id, {
      checkOutTime: time,
      checkOutLat: lat, checkOutLng: lng,
      checkOutDistance: distance, checkOutValid: true,
      hoursWorked: parseFloat(hoursWorked),
    }, { new: true });

    res.json({
      success: true,
      attendance: result,
      message: `✅ Check-out सफल! समय: ${time} • काम: ${hoursWorked} घंटे`,
      hoursWorked,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Shop Settings ───────────────────────────────────────────────────────
// IMPORTANT: These must come BEFORE /:id routes to avoid collision
router.get('/shop/settings', async (req, res) => {
  try {
    let shop = await ShopSettings.findOne({ key: 'main' });
    if (!shop) shop = await ShopSettings.create({ key: 'main' });
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shop/settings', async (req, res) => {
  try {
    const shop = await ShopSettings.findOneAndUpdate(
      { key: 'main' },
      { ...req.body, key: 'main' },
      { new: true, upsert: true }
    );
    res.json(shop);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES — must come LAST so specific paths match first
// ═══════════════════════════════════════════════════════════════════════════
// PUT manual attendance adjustment (admin only)
router.put('/:id', async (req, res) => {
  try {
    const att = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(att);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE attendance record
router.delete('/:id', async (req, res) => {
  try {
    await Attendance.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;