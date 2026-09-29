const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')

// SMS Log Schema
const smsLogSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  customerName: { type: String },
  mobile: { type: String },
  message: { type: String },
  templateType: { type: String }, // welcome, emi_due, emi_overdue, etc
  status: { type: String, default: 'demo' }, // sent, demo, failed
  gateway: { type: String, default: 'demo' }, // msg91, demo
  sentBy: { type: String },
  sentAt: { type: Date, default: Date.now },
  cost: { type: Number, default: 0 }
})

const SMSLog = mongoose.models.SMSLog || mongoose.model('SMSLog', smsLogSchema)

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

// GET all SMS logs
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Phase 20: पन्ने (pagination) — पहले हर बार 500 रिकॉर्ड एक साथ आते थे।
    // पुराने pages बिना कुछ भेजे वही 500 पाते रहेंगे (कुछ टूटेगा नहीं),
    // और ?page=2&limit=100 भेजने पर पन्नों में मिलेंगे।
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '500', 10) || 500))
    const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1)
    const [logs, total] = await Promise.all([
      SMSLog.find().sort({ sentAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SMSLog.countDocuments()
    ])
    res.json({
      success: true, logs, count: logs.length,
      total, page, pages: Math.ceil(total / limit) || 1
    })
  } catch (err) {
    res.json({ success: true, logs: [], count: 0 })
  }
})

// GET by customer
router.get('/customer/:customerId', authMiddleware, async (req, res) => {
  try {
    const logs = await SMSLog.find({ customerId: req.params.customerId }).sort({ sentAt: -1 })
    res.json({ success: true, logs })
  } catch (err) {
    res.json({ success: true, logs: [] })
  }
})

// POST send SMS (demo mode - actually opens WhatsApp/SMS)
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { mobile, message, customerId, customerName, templateType } = req.body
    
    // Log it (demo mode - no real SMS sent)
    const log = new SMSLog({
      customerId,
      customerName,
      mobile,
      message,
      templateType: templateType || 'manual',
      status: 'demo',
      gateway: 'demo',
      sentBy: req.user.username || 'admin'
    })
    await log.save()
    
    res.json({ 
      success: true, 
      log,
      message: 'SMS logged (Demo mode - Real SMS via MSG91 coming soon)',
      whatsappLink: `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}`
    })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// POST bulk send
router.post('/bulk-send', authMiddleware, async (req, res) => {
  try {
    const { customers, message, templateType } = req.body
    
    if (!customers || !Array.isArray(customers)) {
      return res.status(400).json({ success: false, error: 'Customers array required' })
    }
    
    const logs = []
    for (const c of customers) {
      const personalizedMsg = message
        .replace('{name}', c.name || '')
        .replace('{vehicle}', c.vehicle || '')
        .replace('{emi}', c.emi || '')
      
      const log = new SMSLog({
        customerId: c.customerId,
        customerName: c.name,
        mobile: c.mobile,
        message: personalizedMsg,
        templateType: templateType || 'bulk',
        status: 'demo',
        gateway: 'demo',
        sentBy: req.user.username || 'admin'
      })
      await log.save()
      logs.push(log)
    }
    
    res.json({ 
      success: true, 
      sent: logs.length,
      logs,
      message: `${logs.length} SMS logged (Demo mode)`
    })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// GET SMS stats
router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const total = await SMSLog.countDocuments()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayCount = await SMSLog.countDocuments({ sentAt: { $gte: today } })
    
    res.json({ 
      success: true, 
      stats: {
        total,
        today: todayCount,
        gateway: 'Demo Mode',
        cost: 0
      }
    })
  } catch (err) {
    res.json({ success: true, stats: { total: 0, today: 0, gateway: 'Demo', cost: 0 } })
  }
})

// DELETE log
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await SMSLog.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'Log deleted' })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

module.exports = router