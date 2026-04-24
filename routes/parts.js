// routes/parts.js — Parts inventory + stock consumption
const router = require('express').Router();
const Part = require('../models/Part');
const PartConsumption = require('../models/PartConsumption');

// ── Helper: calculate effective stock ────────────────────────────────────────
const getStock = (p) => Number(p.stock || p.quantity || 0);

// ── GET all parts with low-stock flag ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const parts = await Part.find().sort({ createdAt: -1 }).lean();
    const enriched = parts.map(p => ({
      ...p,
      effectiveStock: getStock(p),
      isLowStock: getStock(p) <= (p.minStock || 0) && (p.minStock || 0) > 0,
      isOutOfStock: getStock(p) <= 0,
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET single part ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const p = await Part.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ ...p, effectiveStock: getStock(p) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CREATE ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try { res.status(201).json(await Part.create(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ── UPDATE ───────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const p = await Part.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── DELETE ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try { await Part.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CRITICAL: STOCK CONSUMPTION when invoice is created
// POST /api/parts/consume
// Body: {
//   invoiceId, invoiceNumber, customerId, customerName, regNo, consumedBy,
//   parts: [{ partId | partNumber | partName, quantity, unitPrice }]
// }
// Returns: { success, deducted, alerts: [...low-stock warnings] }
// ════════════════════════════════════════════════════════════════════════════
router.post('/consume', async (req, res) => {
  try {
    const { invoiceId, invoiceNumber, customerId, customerName, regNo, consumedBy, parts } = req.body;
    if (!Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: 'parts array required' });
    }

    const deducted = [];
    const alerts = [];
    const errors = [];

    for (const item of parts) {
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;

      // Find part by id, then partNumber, then partName
      let part = null;
      if (item.partId)        part = await Part.findById(item.partId).catch(() => null);
      if (!part && item.partNumber) part = await Part.findOne({ partNumber: item.partNumber });
      if (!part && item.partName)   part = await Part.findOne({ partName: item.partName });

      if (!part) {
        errors.push(`Part not found: ${item.partName || item.partNumber}`);
        continue;
      }

      const stockBefore = getStock(part);
      const stockAfter = Math.max(0, stockBefore - qty);

      // Deduct
      part.stock = stockAfter;
      part.quantity = stockAfter;
      await part.save();

      // Audit log
      await PartConsumption.create({
        partId: part._id.toString(),
        partNumber: part.partNumber || '',
        partName: part.partName || '',
        quantity: qty,
        invoiceId: invoiceId || '',
        invoiceNumber: invoiceNumber || '',
        customerId: customerId || '',
        customerName: customerName || '',
        regNo: regNo || '',
        consumedBy: consumedBy || 'System',
        unitPrice: Number(item.unitPrice || part.salePrice || part.unitPrice || 0),
        totalValue: qty * Number(item.unitPrice || part.salePrice || part.unitPrice || 0),
        stockBefore,
        stockAfter,
      });

      deducted.push({
        partName: part.partName,
        partNumber: part.partNumber,
        qty,
        stockBefore,
        stockAfter,
      });

      // Low-stock alert
      const minStock = Number(part.minStock || 0);
      if (minStock > 0 && stockAfter <= minStock) {
        alerts.push({
          partName: part.partName,
          partNumber: part.partNumber,
          currentStock: stockAfter,
          minStock,
          severity: stockAfter === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        });
      }
    }

    res.json({ success: true, deducted, alerts, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RESTORE STOCK when invoice is deleted/cancelled
// POST /api/parts/restore
// Body: { invoiceId } — restores all parts from this invoice
// ════════════════════════════════════════════════════════════════════════════
router.post('/restore', async (req, res) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId required' });

    const consumptions = await PartConsumption.find({ invoiceId, reverted: { $ne: true } });
    if (consumptions.length === 0) {
      return res.json({ success: true, restored: 0, message: 'No consumption records for this invoice' });
    }

    const restored = [];
    for (const c of consumptions) {
      const part = await Part.findById(c.partId);
      if (!part) continue;
      const newStock = getStock(part) + c.quantity;
      part.stock = newStock;
      part.quantity = newStock;
      await part.save();
      c.reverted = true;
      await c.save();
      restored.push({ partName: c.partName, qty: c.quantity, newStock });
    }
    res.json({ success: true, restored: restored.length, items: restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CONSUMPTION HISTORY
// GET /api/parts/history/all       → all consumptions (last 500)
// GET /api/parts/history/:partId   → specific part history
// GET /api/parts/history/invoice/:invoiceId → which parts were used in this invoice
// ════════════════════════════════════════════════════════════════════════════
router.get('/history/all', async (req, res) => {
  try {
    const list = await PartConsumption.find({ reverted: { $ne: true } })
      .sort({ consumedAt: -1 }).limit(500).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history/invoice/:invoiceId', async (req, res) => {
  try {
    const list = await PartConsumption.find({ invoiceId: req.params.invoiceId }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/history/:partId', async (req, res) => {
  try {
    const list = await PartConsumption.find({ partId: req.params.partId })
      .sort({ consumedAt: -1 }).limit(200).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sync from frontend bulk import ───────────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const list = req.body.parts || req.body;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'Array required' });
    await Part.deleteMany({});
    if (list.length) await Part.insertMany(list, { ordered: false });
    res.json({ success: true, count: list.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;