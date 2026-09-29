const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

// Investigation Schema
const investigationSchema = new mongoose.Schema({
  applicationId: { type: String },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  customerName: { type: String },
  mobile: { type: String },
  address: { type: String },
  investigationType: { type: String, default: 'residence' }, // residence, office, business
  assignedTo: { type: String },
  assignedDate: { type: Date, default: Date.now },
  visitDate: { type: Date },
  visitTime: { type: String },
  status: { type: String, default: 'pending' }, // pending, in-progress, completed, failed
  result: { type: String }, // positive, negative, neutral
  findings: { type: String },
  // Residence verification
  residenceVerified: { type: Boolean, default: false },
  yearsAtAddress: { type: String },
  residenceType: { type: String }, // owned, rented
  familyMembers: { type: Number, default: 0 },
  neighborConfirmation: { type: Boolean, default: false },
  // Office verification
  officeVerified: { type: Boolean, default: false },
  designation: { type: String },
  monthlyIncome: { type: Number, default: 0 },
  workingSince: { type: String },
  employerConfirmation: { type: Boolean, default: false },
  // Documents
  photos: [{ type: String }], // base64 images
  documents: { type: Object, default: {} },
  notes: { type: String },
  remarks: { type: String },
  // Recommendation
  recommendation: { type: String }, // approve, reject, hold, more-info
  riskRating: { type: String, default: 'low' }, // low, medium, high
  createdBy: { type: String },
  completedBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const Investigation = mongoose.models.Investigation || mongoose.model('Investigation', investigationSchema)

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

// GET all investigations
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Phase 20: पन्ने (pagination) — पहले हर बार 500 रिकॉर्ड एक साथ आते थे।
    // पुराने pages बिना कुछ भेजे वही 500 पाते रहेंगे (कुछ टूटेगा नहीं),
    // और ?page=2&limit=100 भेजने पर पन्नों में मिलेंगे।
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500', 10) || 500))
    const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1)
    const [investigations, total] = await Promise.all([
      Investigation.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Investigation.countDocuments()
    ])
    res.json({
      success: true, investigations, count: investigations.length,
      total, page, pages: Math.ceil(total / limit) || 1
    })
  } catch (err) {
    res.json({ success: true, investigations: [], count: 0 })
  }
})

// GET single
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const investigation = await Investigation.findById(req.params.id)
    if (!investigation) return res.json({ success: true, investigation: null })
    res.json({ success: true, investigation })
  } catch (err) {
    res.json({ success: true, investigation: null })
  }
})

// GET by customer
router.get('/customer/:customerId', authMiddleware, async (req, res) => {
  try {
    const investigations = await Investigation.find({ customerId: req.params.customerId })
    res.json({ success: true, investigations })
  } catch (err) {
    res.json({ success: true, investigations: [] })
  }
})

// POST create
router.post('/', authMiddleware, async (req, res) => {
  try {
    const investigation = new Investigation({
      ...req.body,
      createdBy: req.user.username || 'admin'
    })
    await investigation.save()
    res.json({ success: true, investigation })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// PATCH update
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const investigation = await Investigation.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    )
    res.json({ success: true, investigation })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// PATCH complete investigation
router.patch('/:id/complete', authMiddleware, async (req, res) => {
  try {
    const investigation = await Investigation.findByIdAndUpdate(
      req.params.id,
      { 
        ...req.body, 
        status: 'completed',
        completedBy: req.user.username || 'admin',
        updatedAt: new Date()
      },
      { new: true }
    )
    res.json({ success: true, investigation })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// DELETE
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Investigation.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'Investigation deleted' })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

module.exports = router