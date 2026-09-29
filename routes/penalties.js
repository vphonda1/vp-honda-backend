const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

// Penalty Schema
const penaltySchema = new mongoose.Schema({
  applicationId: { type: String },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  customerName: { type: String },
  mobile: { type: String },
  vehicleModel: { type: String },
  penaltyType: { type: String, default: 'late_emi' }, // late_emi, bounce_charge, repossession, legal
  amount: { type: Number, default: 0 },
  reason: { type: String },
  status: { type: String, default: 'pending' }, // pending, paid, waived, in_dispute
  // For late EMI
  emiMonth: { type: String },
  daysLate: { type: Number, default: 0 },
  // For repossession
  isRepossessed: { type: Boolean, default: false },
  repossessionDate: { type: Date },
  repossessionLocation: { type: String },
  repossessionOfficer: { type: String },
  // For legal
  legalNoticeDate: { type: Date },
  legalNoticeNumber: { type: String },
  caseStatus: { type: String },
  // Resolution
  paymentDate: { type: Date },
  paymentMode: { type: String },
  paymentReference: { type: String },
  waivedBy: { type: String },
  waivedReason: { type: String },
  // Notes
  notes: { type: String },
  documents: [{ type: String }], // base64 images
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const Penalty = mongoose.models.Penalty || mongoose.model('Penalty', penaltySchema)

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

// GET all penalties
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Phase 20: पन्ने (pagination) — पहले हर बार 500 रिकॉर्ड एक साथ आते थे।
    // पुराने pages बिना कुछ भेजे वही 500 पाते रहेंगे (कुछ टूटेगा नहीं),
    // और ?page=2&limit=100 भेजने पर पन्नों में मिलेंगे।
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500', 10) || 500))
    const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1)
    const [penalties, total] = await Promise.all([
      Penalty.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Penalty.countDocuments()
    ])
    res.json({
      success: true, penalties, count: penalties.length,
      total, page, pages: Math.ceil(total / limit) || 1
    })
  } catch (err) {
    res.json({ success: true, penalties: [], count: 0 })
  }
})

// GET single
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const penalty = await Penalty.findById(req.params.id)
    if (!penalty) return res.json({ success: true, penalty: null })
    res.json({ success: true, penalty })
  } catch (err) {
    res.json({ success: true, penalty: null })
  }
})

// GET by customer
router.get('/customer/:customerId', authMiddleware, async (req, res) => {
  try {
    const penalties = await Penalty.find({ customerId: req.params.customerId })
    res.json({ success: true, penalties })
  } catch (err) {
    res.json({ success: true, penalties: [] })
  }
})

// GET repossessions only
router.get('/type/repossession', authMiddleware, async (req, res) => {
  try {
    const penalties = await Penalty.find({ penaltyType: 'repossession' }).sort({ createdAt: -1 })
    res.json({ success: true, penalties })
  } catch (err) {
    res.json({ success: true, penalties: [] })
  }
})

// POST create
router.post('/', authMiddleware, async (req, res) => {
  try {
    const penalty = new Penalty({
      ...req.body,
      createdBy: req.user.username || 'admin'
    })
    await penalty.save()
    res.json({ success: true, penalty })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// PATCH update
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const penalty = await Penalty.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    )
    res.json({ success: true, penalty })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// PATCH waive penalty
router.patch('/:id/waive', authMiddleware, async (req, res) => {
  try {
    const { reason } = req.body
    const penalty = await Penalty.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'waived',
        waivedBy: req.user.username || 'admin',
        waivedReason: reason || 'Approved by admin',
        updatedAt: new Date()
      },
      { new: true }
    )
    res.json({ success: true, penalty })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// DELETE
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Penalty.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'Penalty deleted' })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

module.exports = router