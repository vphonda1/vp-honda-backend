const router = require('express').Router();

// In-memory store backed by a JSON file approach
// For simplicity, we'll use a lightweight MongoDB model
let Staff;
try {
  const mongoose = require('mongoose');
  const staffSchema = new mongoose.Schema({
    staffId: { type: Number },
    name: { type: String, default: '' },
    father: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    aadharNo: { type: String, default: '' },
    panNo: { type: String, default: '' },
    position: { type: String, default: 'Mechanic' },
    monthlySalary: { type: Number, default: 0 },
    joinDate: { type: String, default: '' },
    bankAccount: { type: String, default: '' },
    ifscCode: { type: String, default: '' },
    bankName: { type: String, default: '' },
    bankBranch: { type: String, default: '' },
    pin: { type: String, default: '1234' },
    active: { type: Boolean, default: true },
  }, { timestamps: true, strict: false });
  Staff = mongoose.model('Staff', staffSchema);
} catch(e) { console.error('Staff model error:', e.message); }

// GET all staff (for login page — returns name, id, position, pin)
router.get('/', async (req, res) => {
  try {
    if (!Staff) return res.json([]);
    const staff = await Staff.find({ active: { $ne: false } }).sort({ createdAt: -1 });
    res.json(staff.map(s => ({
      id: s.staffId || s._id,
      name: s.name,
      father: s.father,
      phone: s.phone,
      email: s.email,
      position: s.position,
      monthlySalary: s.monthlySalary,
      joinDate: s.joinDate,
      pin: s.pin || '1234',
      aadharNo: s.aadharNo,
      panNo: s.panNo,
      bankAccount: s.bankAccount,
      ifscCode: s.ifscCode,
      bankName: s.bankName,
      bankBranch: s.bankBranch,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — Sync all staff (bulk replace)
router.post('/sync', async (req, res) => {
  try {
    if (!Staff) return res.status(500).json({ error: 'DB not available' });
    const staffList = req.body.staffList || req.body;
    if (!Array.isArray(staffList)) return res.status(400).json({ error: 'staffList array required' });

    // Clear existing and insert all
    await Staff.deleteMany({});
    const docs = staffList.map(s => ({
      staffId: s.id,
      name: s.name || '',
      father: s.father || '',
      phone: s.phone || '',
      email: s.email || '',
      aadharNo: s.aadharNo || '',
      panNo: s.panNo || '',
      position: s.position || 'Mechanic',
      monthlySalary: s.monthlySalary || 0,
      joinDate: s.joinDate || '',
      bankAccount: s.bankAccount || '',
      ifscCode: s.ifscCode || '',
      bankName: s.bankName || '',
      bankBranch: s.bankBranch || '',
      pin: s.pin || '1234',
      active: true,
    }));
    await Staff.insertMany(docs);
    res.json({ success: true, count: docs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT — Update PIN (staff self-service)
router.put('/change-pin', async (req, res) => {
  try {
    if (!Staff) return res.status(500).json({ error: 'DB not available' });
    const { staffId, oldPin, newPin } = req.body;
    const staff = await Staff.findOne({ staffId: staffId });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    if (staff.pin !== oldPin) return res.status(403).json({ error: 'Wrong old PIN' });
    staff.pin = newPin;
    await staff.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT — Admin reset PIN
router.put('/reset-pin', async (req, res) => {
  try {
    if (!Staff) return res.status(500).json({ error: 'DB not available' });
    const { staffId, newPin } = req.body;
    const staff = await Staff.findOne({ staffId: staffId });
    if (!staff) return res.status(404).json({ error: 'Staff not found' });
    staff.pin = newPin || '1234';
    await staff.save();
    res.json({ success: true, newPin: staff.pin });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
