const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

// Payment Schema
const paymentSchema = new mongoose.Schema({
  applicationId: { type: String },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  customerName: { type: String },
  mobile: { type: String },
  vehicleModel: { type: String },
  loanAmount: { type: Number, default: 0 },
  emiAmount: { type: Number, default: 0 },
  tenure: { type: Number, default: 0 },
  emisPaid: { type: Number, default: 0 },
  emisRemaining: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  totalRemaining: { type: Number, default: 0 },
  lastPaymentDate: { type: Date },
  lastPaymentAmount: { type: Number, default: 0 },
  nextDueDate: { type: Date },
  status: { type: String, default: 'active' }, // active, overdue, completed, defaulted
  paymentHistory: [{
    date: { type: Date, default: Date.now },
    amount: { type: Number },
    mode: { type: String }, // cash, upi, nach, cheque
    reference: { type: String },
    notes: { type: String },
    recordedBy: { type: String }
  }],
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema)

// JWT Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ success: false, error: 'No token' })
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'vp-honda-secret-key-2026-production-strong-key')
    req.user = decoded
    next()
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

// GET all payments
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Phase 20: पन्ने (pagination) — पहले हर बार 500 रिकॉर्ड एक साथ आते थे।
    // पुराने pages बिना कुछ भेजे वही 500 पाते रहेंगे (कुछ टूटेगा नहीं),
    // और ?page=2&limit=100 भेजने पर पन्नों में मिलेंगे।
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500', 10) || 500))
    const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1)
    const [payments, total] = await Promise.all([
      Payment.find().sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Payment.countDocuments()
    ])
    res.json({
      success: true, payments, count: payments.length,
      total, page, pages: Math.ceil(total / limit) || 1
    })
  } catch (err) {
    res.json({ success: true, payments: [], count: 0 })
  }
})

// GET single payment
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
    if (!payment) return res.json({ success: true, payment: null })
    res.json({ success: true, payment })
  } catch (err) {
    res.json({ success: true, payment: null })
  }
})

// GET payments by customer
router.get('/customer/:customerId', authMiddleware, async (req, res) => {
  try {
    const payments = await Payment.find({ customerId: req.params.customerId })
    res.json({ success: true, payments })
  } catch (err) {
    res.json({ success: true, payments: [] })
  }
})

// POST create payment record
router.post('/', authMiddleware, async (req, res) => {
  try {
    const payment = new Payment({
      ...req.body,
      createdBy: req.user.username || 'admin'
    })
    await payment.save()
    res.json({ success: true, payment })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// POST record EMI payment
router.post('/:id/record', authMiddleware, async (req, res) => {
  try {
    const { amount, mode, reference, notes } = req.body
    const payment = await Payment.findById(req.params.id)
    
    if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' })
    
    payment.paymentHistory.push({
      date: new Date(),
      amount,
      mode: mode || 'cash',
      reference,
      notes,
      recordedBy: req.user.username || 'admin'
    })
    
    payment.totalPaid = (payment.totalPaid || 0) + amount
    payment.emisPaid = (payment.emisPaid || 0) + 1
    payment.emisRemaining = Math.max(0, (payment.tenure || 0) - payment.emisPaid)
    payment.lastPaymentDate = new Date()
    payment.lastPaymentAmount = amount
    payment.updatedAt = new Date()
    
    if (payment.emisRemaining === 0) payment.status = 'completed'
    
    await payment.save()
    res.json({ success: true, payment })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// PATCH update payment
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    )
    res.json({ success: true, payment })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// DELETE payment
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Payment.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'Payment deleted' })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

module.exports = router