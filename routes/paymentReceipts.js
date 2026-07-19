// routes/paymentReceipts.js — VP Honda Payment Receipts
const express = require('express');
const router  = express.Router();
const PR      = require('../models/PaymentReceipt');

// Auto receipt number counter
let counter = 0;
async function getReceiptNo() {
  if (!counter) {
    const last = await PR.findOne().sort({ createdAt: -1 }).select('receiptNumber');
    const match = last?.receiptNumber?.match(/(\d+)$/);
    counter = match ? parseInt(match[1]) : 0;
  }
  counter++;
  return `VPH/REC/${new Date().getFullYear()}/${String(counter).padStart(4,'0')}`;
}

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.customerId) filter.customerId = req.query.customerId;
    if (req.query.paymentType) filter.paymentType = req.query.paymentType;
    const data = await PR.find(filter).sort({ receiptDate: -1 }).lean();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await PR.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.receiptNumber) body.receiptNumber = await getReceiptNo();
    const doc = new PR(body);
    await doc.save();
    res.status(201).json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await PR.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
