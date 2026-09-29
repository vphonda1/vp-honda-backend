const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

// Generic Data Schema (handles all extra features)
const genericDataSchema = new mongoose.Schema({
  collectionType: { type: String, required: true }, // type of data
  customerId: { type: mongoose.Schema.Types.ObjectId },
  customerName: { type: String },
  mobile: { type: String },
  data: { type: Object, default: {} }, // flexible JSON data
  status: { type: String, default: 'active' },
  createdBy: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

const GenericData = mongoose.models.GenericData || mongoose.model('GenericData', genericDataSchema)

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

// Factory function to create CRUD routes for any collection type
function createCRUDRoutes(collectionType) {
  const subRouter = express.Router()
  
  // GET all
  subRouter.get('/', authMiddleware, async (req, res) => {
    try {
      // Phase 20: पन्ने (pagination) — ?page=2&limit=100 भेजने पर।
      // कुछ न भेजें तो पहले जैसा (500 तक) ही मिलता है।
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500', 10) || 500))
      const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1)
      const [items, total] = await Promise.all([
        GenericData.find({ collectionType }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        GenericData.countDocuments({ collectionType })
      ])
      // Return data with proper key name
      const responseKey = collectionType  // e.g., "reports", "templates"
      res.json({ 
        success: true, 
        [responseKey]: items, 
        items,
        count: items.length,
        total, page, pages: Math.ceil(total / limit) || 1
      })
    } catch (err) {
      res.json({ 
        success: true, 
        [collectionType]: [], 
        items: [],
        count: 0 
      })
    }
  })
  
  // GET single
  subRouter.get('/:id', authMiddleware, async (req, res) => {
    try {
      const item = await GenericData.findById(req.params.id)
      res.json({ success: true, item: item || null })
    } catch (err) {
      res.json({ success: true, item: null })
    }
  })
  
  // POST create
  subRouter.post('/', authMiddleware, async (req, res) => {
    try {
      const item = new GenericData({
        collectionType,
        ...req.body,
        data: req.body,
        createdBy: req.user.username || 'admin'
      })
      await item.save()
      res.json({ success: true, item })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message })
    }
  })
  
  // PATCH update
  subRouter.patch('/:id', authMiddleware, async (req, res) => {
    try {
      const item = await GenericData.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true }
      )
      res.json({ success: true, item })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message })
    }
  })
  
  // DELETE
  subRouter.delete('/:id', authMiddleware, async (req, res) => {
    try {
      await GenericData.findByIdAndDelete(req.params.id)
      res.json({ success: true, message: 'Deleted' })
    } catch (err) {
      res.status(400).json({ success: false, error: err.message })
    }
  })
  
  return subRouter
}

// Export factory function
module.exports = createCRUDRoutes