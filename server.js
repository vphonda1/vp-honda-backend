// ═══════════════════════════════════════════════════════════════════════
// server.js  —  Vishesh Finance ERP Backend  v13.0.0  (Phase 1–11)
// ───────────────────────────────────────────────────────────────────────
// यह पूरी file है। पुरानी server.js delete करके यही upload करें।
//
// Phase 1 — सुरक्षा, यूज़र प्रबंधन, permissions, audit log
// Phase 2 — ग्राहक, लोन ledger, EMI engine, भुगतान व रसीद
// Phase 3 — दस्तावेज़ (Cloudinary), CIBIL, बैंक स्टेटमेंट, पात्रता, धोखाधड़ी
// Phase 4 — Real-time sync (Socket.io), Live Activity Feed, रिमाइंडर
// Phase 5 — शाखा प्रबंधन, उन्नत रिपोर्ट, बैकअप/पुनर्स्थापन, स्वचालित जाँच
// Phase 6 — WhatsApp automation, ग्राहक-वार दस्तावेज़, पुराने pages नए backend से जुड़े
// Phase 7 — server-side ड्राफ्ट, फाइनेंस कंपनी तुलना, रसीद सत्यापन (QR), निजी डैशबोर्ड
// Phase 8 — ⚠️ ज़रूरी सुधार: ड्राफ्ट submit होना बंद हो गया था, अब ठीक
// Phase 9 — ⚠️ ज़रूरी सुधार: auto-save submit किए हुए आवेदन को वापस ड्राफ्ट बना देता था
// Phase 10 — ग्राहक की चुनी EMI तारीख, SMS+Email+WhatsApp संदेश, स्मार्ट डैशबोर्ड
// Phase 11 — पुराने स्कैन किए दस्तावेज़ नए केंद्र में दिखाना व cloud पर भेजना
//
// पुराने सभी routes और response keys वैसे ही हैं — frontend नहीं टूटेगा।
// ═══════════════════════════════════════════════════════════════════════

require('dotenv').config()

const http = require('http')
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

const User = require('./models/User')
const {
  authenticate, requirePermission, requireReAuth,
  buildScopeFilter, canAccessRecord, stampCreate, stampUpdate
} = require('./middleware/auth')
const { audit, diffChanges } = require('./middleware/audit')
const { requestId, errorHandler, notFoundHandler, AppError, asyncHandler } = require('./middleware/errorHandler')
const { seedSuperAdmin, migrateLegacyUsers } = require('./scripts/seed')
const realtime = require('./services/realtime')
const Branch = require('./models/Branch')

const app = express()
app.set('trust proxy', 1)

// ═══════════════════════════════════════════════════════════════
// 1. ENVIRONMENT VALIDATION
// ═══════════════════════════════════════════════════════════════
const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('❌ FATAL: MONGODB_URI env variable set नहीं है')
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════
// 2. SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://vphonda-frontend.vercel.app,https://vp-honda-frontend.vercel.app,http://localhost:5173,http://localhost:3000'
).split(',').map(o => o.trim()).filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    if (process.env.ALLOW_ALL_ORIGINS === 'true') return callback(null, true)
    console.warn('⛔ CORS blocked:', origin)
    return callback(new Error('इस origin की अनुमति नहीं है: ' + origin))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Device-Id', 'X-Device-Name',
    'X-ReAuth-Token', 'X-Request-Id', 'X-Job-Key'
  ]
}))

app.use(express.json({ limit: process.env.JSON_LIMIT || '15mb' }))
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_LIMIT || '15mb' }))
app.use(requestId)

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', error: 'बहुत ज़्यादा requests — थोड़ी देर रुकें' }
}))

app.use((req, res, next) => {
  if (req.path !== '/api/health' && req.path !== '/api/jobs/ping') {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} [${req.requestId}]`)
  }
  next()
})

// ═══════════════════════════════════════════════════════════════
// 3. MONGODB
// ═══════════════════════════════════════════════════════════════
mongoose.connect(MONGODB_URI, {
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 15000
})
  .then(async () => {
    console.log('✅ MongoDB connected')
    await migrateLegacyUsers()
    await seedSuperAdmin()
    await Branch.ensureDefault().catch(e => console.log('⚠️  डिफ़ॉल्ट शाखा नहीं बनी:', e.message))
  })
  .catch(err => console.error('❌ MongoDB connection failed:', err.message))

mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'))
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'))

// ═══════════════════════════════════════════════════════════════
// 4. APPLICATION MODEL
// ═══════════════════════════════════════════════════════════════
const applicationSchema = new mongoose.Schema({
  applicationId: { type: String, index: true },
  fullName:  { type: String, index: true },
  mobile:    { type: String, index: true },
  status:    { type: String, default: 'draft', index: true },

  createdBy:        { type: String, index: true },
  createdByName:    { type: String },
  createdByUserId:  { type: String, index: true },
  updatedBy:        { type: String },
  updatedByName:    { type: String },
  updatedByUserId:  { type: String },
  approvedBy:       { type: String },
  approvedByName:   { type: String },
  approvedAt:       { type: Date },
  rejectedBy:       { type: String },
  rejectedByName:   { type: String },
  rejectedAt:       { type: Date },
  assignedTo:       { type: String, index: true },
  assignedToName:   { type: String },
  branchId:         { type: String, default: 'MAIN', index: true },
  branchName:       { type: String },

  customerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },
  loanId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', index: true },
  eligibilityResult:{ type: Object, default: null },
  fraudFlags:       { type: Array, default: [] },

  // ── Phase 10: ग्राहक हर महीने की कौन-सी तारीख को किश्त देगा (1–28) ──
  emiDate:          { type: Number, min: 1, max: 28, default: 5 },
  firstEmiDate:     { type: Date, default: null }
}, { strict: false, timestamps: true })

applicationSchema.index({ status: 1, updatedAt: -1 })
applicationSchema.index({ createdByUserId: 1, updatedAt: -1 })
applicationSchema.index({ branchId: 1, status: 1, updatedAt: -1 })

const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema)

// ═══════════════════════════════════════════════════════════════
// 5. HEALTH / ROOT
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Vishesh Finance ERP API', version: '13.0.0', timestamp: new Date() })
})

app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting']
  res.json({
    success: true,
    status: mongoose.connection.readyState === 1 ? 'healthy' : 'degraded',
    database: states[mongoose.connection.readyState] || 'unknown',
    version: '13.0.0',
    cloudinary: !!process.env.CLOUDINARY_CLOUD_NAME,
    realtime: realtime.isReady(),
    whatsapp: process.env.WHATSAPP_ENABLED === 'true' && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    email: (process.env.EMAIL_PROVIDER || 'none') !== 'none',
    sms: (process.env.SMS_PROVIDER || 'none') !== 'none',
    timestamp: new Date()
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. ROUTE MOUNTING
// ═══════════════════════════════════════════════════════════════
const mount = (path, file, label) => {
  try {
    app.use(path, require(file))
    console.log(`✅ ${label}`)
  } catch (e) {
    console.log(`⚠️  ${label} नहीं मिला: ${e.message}`)
  }
}

// ── Phase 1: प्रमाणीकरण व यूज़र ──
mount('/api/auth',          './routes/auth',       'Auth routes')
mount('/api/users',         './routes/users',      'User routes')
mount('/api/audit-logs',    './routes/auditLogs',  'Audit log routes')
mount('/api/activity-logs', './routes/auditLogs',  'Activity log alias')

// ── Phase 2: ग्राहक, लोन, वसूली ──
mount('/api/customers',   './routes/customers',   'Customer routes')
mount('/api/loans',       './routes/loans',       'Loan routes')
mount('/api/collections', './routes/collections', 'Collection routes')

// ── Phase 3: दस्तावेज़, क्रेडिट, पात्रता ──
mount('/api/documents',      './routes/documents',      'Document routes')
mount('/api/cibil',          './routes/cibil',          'CIBIL routes')
mount('/api/bank-statement', './routes/bankStatement',  'Bank statement routes')
mount('/api/eligibility',    './routes/eligibility',    'Eligibility routes')
mount('/api/fraud',          './routes/fraud',          'Fraud check routes')

// ── Phase 4: सूचनाएँ व jobs ──
// ⚠️ notifications generic से पहले mount होना ज़रूरी है
mount('/api/notifications', './routes/notifications', 'Notification routes')
mount('/api/jobs',          './jobs/dailyRefresh',    'Daily refresh job')
mount('/api/jobs',          './jobs/reminders',       'Reminder job')

// ── Phase 5: शाखा, रिपोर्ट, बैकअप ──
// ⚠️ reports व backup generic से पहले mount होने ज़रूरी हैं
mount('/api/branches', './routes/branches', 'Branch routes')
mount('/api/reports',  './routes/reports',  'Report routes')
mount('/api/backup',   './routes/backup',   'Backup routes')

// ── Phase 6: WhatsApp ──
mount('/api/whatsapp', './routes/whatsapp', 'WhatsApp routes')

// ── Phase 10: स्मार्ट डैशबोर्ड ──
mount('/api/dashboard', './routes/dashboard', 'Dashboard routes')
mount('/api/settings',  './routes/settings',  'Settings routes')

// ── Phase 11: पुराने base64 दस्तावेज़ ──
mount('/api/legacy-documents', './routes/legacyDocuments', 'Legacy document routes')

// ── Phase 7: ड्राफ्ट, फाइनेंस कंपनी, सार्वजनिक सत्यापन ──
mount('/api/drafts',            './routes/drafts',           'Draft routes')
mount('/api/finance-companies', './routes/financeCompanies', 'Finance company routes')
// ⚠️ /api/verify बिना login के खुला है — सिर्फ़ रसीद जाँचने के लिए
mount('/api/verify',            './routes/publicVerify',     'Public verify routes')

// ═══════════════════════════════════════════════════════════════
// 7. APPLICATIONS  (क्रम मायने रखता है)
// ═══════════════════════════════════════════════════════════════

// ── STATS ──────────────────────────────────────────────────────
const statsHandler = asyncHandler(async (req, res) => {
  const scope = buildScopeFilter(req)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const [total, approved, pending, rejected, drafts, todayCount, sums] = await Promise.all([
    Application.countDocuments({ ...scope, status: { $ne: 'draft' } }),
    Application.countDocuments({ ...scope, status: 'approved' }),
    Application.countDocuments({ ...scope, status: 'pending' }),
    Application.countDocuments({ ...scope, status: 'rejected' }),
    Application.countDocuments({ ...scope, status: 'draft' }),
    Application.countDocuments({ ...scope, createdAt: { $gte: today }, status: { $ne: 'draft' } }),
    Application.aggregate([
      { $match: { ...scope, status: 'approved' } },
      { $group: { _id: null, totalLoan: { $sum: '$loanAmount' }, totalEMI: { $sum: '$emiAmount' } } }
    ]).allowDiskUse(true)
  ])

  res.json({
    success: true,
    stats: {
      total, approved, pending, rejected, drafts,
      today: todayCount,
      totalLoan: sums[0]?.totalLoan || 0,
      totalEMI: sums[0]?.totalEMI || 0,
      reminders: approved
    },
    scope: req.auth.scope
  })
})

app.get('/api/applications/stats',         authenticate, requirePermission('applications:view'), statsHandler)
app.get('/api/applications/stats/summary', authenticate, requirePermission('applications:view'), statsHandler)
app.get('/api/stats/dashboard',            authenticate, requirePermission('dashboard:view'),    statsHandler)

// ── MY APPLICATIONS ────────────────────────────────────────────
app.get('/api/applications/mine', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10))
  const limit = Math.min(500, parseInt(req.query.limit || '100', 10))

  const filter = {
    $or: [
      { createdByUserId: req.auth.id },
      { createdBy: req.auth.username },
      { assignedTo: req.auth.id },
      { assignedTo: req.auth.username }
    ]
  }
  if (req.query.status) filter.status = req.query.status

  const [applications, total] = await Promise.all([
    Application.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).allowDiskUse(true),
    Application.countDocuments(filter)
  ])

  res.json({ success: true, applications, count: applications.length, total, page, pages: Math.ceil(total / limit) || 1 })
}))

// ── SEARCH ─────────────────────────────────────────────────────
app.get('/api/applications/search/:query', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const q = String(req.params.query || '').trim()
  if (q.length < 2) throw new AppError('कम से कम 2 अक्षर लिखें', 400, 'QUERY_TOO_SHORT')

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const applications = await Application.find({
    ...buildScopeFilter(req),
    $or: [{ fullName: rx }, { mobile: rx }, { vehicleModel: rx }, { applicationId: rx }]
  }).sort({ updatedAt: -1 }).limit(50).allowDiskUse(true)

  res.json({ success: true, applications, count: applications.length })
}))

// ── LIST ───────────────────────────────────────────────────────
app.get('/api/applications', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10))
  const limit = Math.min(1000, parseInt(req.query.limit || '500', 10))

  const filter = { ...buildScopeFilter(req) }
  if (req.query.status)     filter.status = req.query.status
  if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo
  if (req.query.branchId)   filter.branchId = req.query.branchId

  const [applications, total] = await Promise.all([
    Application.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).allowDiskUse(true),
    Application.countDocuments(filter)
  ])

  res.json({
    success: true,
    applications, count: applications.length,
    total, page, pages: Math.ceil(total / limit) || 1,
    scope: req.auth.scope
  })
}))

// ── APPLICATION 360 ────────────────────────────────────────────
app.get('/api/applications/:id/360', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

  const application = await Application.findById(req.params.id)
  if (!application) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')
  if (!canAccessRecord(req, application)) throw new AppError('यह आवेदन आपका नहीं है', 403, 'FORBIDDEN')

  const safeFind = async (modelName, filter, sort = { createdAt: -1 }, limit = 50) => {
    try {
      const M = mongoose.models[modelName]
      if (!M) return []
      return await M.find(filter).sort(sort).limit(limit).lean()
    } catch { return [] }
  }

  const [documents, loan, cibil, bankStatement, timeline, customer] = await Promise.all([
    safeFind('Document', { applicationId: String(application._id) }),
    safeFind('Loan', { applicationRef: application._id }, { createdAt: -1 }, 1),
    safeFind('CibilReport', { applicationId: String(application._id) }, { createdAt: -1 }, 5),
    safeFind('BankStatement', { applicationId: String(application._id) }, { createdAt: -1 }, 5),
    safeFind('AuditLog', { entityType: 'Application', entityId: String(application._id) }, { createdAt: 1 }, 200),
    application.customerId ? safeFind('Customer', { _id: application.customerId }, { createdAt: -1 }, 1) : []
  ])

  let schedule = []
  if (loan[0]) schedule = await safeFind('EMISchedule', { loanId: loan[0]._id }, { installmentNo: 1 }, 120)

  res.json({
    success: true,
    application,
    customer: customer[0] || null,
    loan: loan[0] || null,
    schedule,
    documents,
    cibil: cibil[0] || null,
    bankStatement: bankStatement[0] || null,
    eligibility: application.eligibilityResult || null,
    fraudFlags: application.fraudFlags || [],
    timeline,
    activity: {
      createdBy: application.createdByName || application.createdBy,
      createdAt: application.createdAt,
      updatedBy: application.updatedByName || application.updatedBy,
      updatedAt: application.updatedAt,
      assignedTo: application.assignedToName,
      approvedBy: application.approvedByName || application.approvedBy,
      approvedAt: application.approvedAt,
      rejectedBy: application.rejectedByName || application.rejectedBy,
      rejectedAt: application.rejectedAt
    }
  })
}))

// ── SINGLE ─────────────────────────────────────────────────────
app.get('/api/applications/:id', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

  const application = await Application.findById(req.params.id)
  if (!application) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')
  if (!canAccessRecord(req, application)) throw new AppError('यह आवेदन आपका नहीं है', 403, 'FORBIDDEN')

  res.json({ success: true, application })
}))

// ── CREATE ─────────────────────────────────────────────────────
app.post('/api/applications', authenticate, requirePermission('applications:create'), asyncHandler(async (req, res) => {
  const data = stampCreate(req, { ...req.body })
  delete data._id

  if (!data.applicationId) data.applicationId = 'APP-' + Date.now()

  const application = await Application.create(data)

  await audit(req, {
    action: 'APPLICATION_CREATED', category: 'application',
    entityType: 'Application', entityId: application._id,
    entityLabel: `${application.applicationId} — ${application.fullName || 'नाम नहीं'}`,
    amount: application.loanAmount || null
  })

  res.status(201).json({ success: true, application })
}))

// ── UPDATE ─────────────────────────────────────────────────────
app.patch('/api/applications/:id', authenticate, requirePermission('applications:edit'), asyncHandler(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

  const existing = await Application.findById(req.params.id)
  if (!existing) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')
  if (!canAccessRecord(req, existing)) throw new AppError('यह आवेदन आपका नहीं है', 403, 'FORBIDDEN')

  const clientVersion = req.body.__clientUpdatedAt
  if (clientVersion && new Date(clientVersion) < existing.updatedAt && req.body.__forceOverwrite !== true) {
    const secondsAgo = Math.round((Date.now() - existing.updatedAt) / 1000)
    return res.status(409).json({
      success: false,
      code: 'CONFLICT',
      error: `यह आवेदन ${existing.updatedByName || existing.createdByName || 'किसी और'} ने ${secondsAgo} सेकंड पहले बदला है`,
      serverUpdatedAt: existing.updatedAt,
      updatedByName: existing.updatedByName,
      serverVersion: existing
    })
  }

  const updates = stampUpdate(req, { ...req.body })
  delete updates._id
  delete updates.createdBy
  delete updates.createdByUserId
  delete updates.__clientUpdatedAt
  delete updates.__forceOverwrite

  // ── status बदलने के नियम ──────────────────────────────────────
  // ड्राफ्ट को submit करना (draft → pending) यहीं से होता है — यही
  // 16-step form का "Submit" बटन करता है।
  // approve / reject सिर्फ़ /status endpoint से होंगे (password दोबारा माँगकर)।
  const RESTRICTED = ['approved', 'rejected', 'disbursed']
  if (updates.status !== undefined) {
    const from = existing.status || 'draft'
    const to = updates.status

    // ⚠️ Phase 9 — सबसे ज़रूरी सुधार:
    // 16-step form हर 10 सेकंड में auto-save करता है और उसमें हमेशा
    // status:'draft' भेजा जाता है। इसका मतलब — कोई आवेदन submit करने के
    // बाद अगर form दोबारा खुल जाए (या auto-save का timer बचा रह जाए),
    // तो वह चुपचाप वापस "ड्राफ्ट" बन जाता था और ड्राफ्ट सूची से हटता ही नहीं था।
    //
    // अब: एक बार submit हो जाने पर status पीछे नहीं जाएगा।
    // auto-save की बाक़ी जानकारी सुरक्षित होती रहेगी — सिर्फ़ status अनदेखा होगा,
    // ताकि staff को कोई error भी न दिखे।
    if (to === 'draft' && from !== 'draft') {
      delete updates.status
      console.log(`[protect] ${existing.applicationId}: auto-save को वापस draft बनाने से रोका (अभी ${from})`)
    }

    else if (RESTRICTED.includes(to)) {
      throw new AppError(
        'Approve / Reject यहाँ से नहीं होता — उसके लिए अलग बटन है (password दोबारा पूछा जाएगा)',
        403, 'USE_STATUS_ENDPOINT'
      )
    }
    else if (RESTRICTED.includes(from) && to !== from) {
      throw new AppError(
        `यह आवेदन "${from}" हो चुका है — अब इसकी स्थिति नहीं बदली जा सकती`,
        400, 'STATUS_LOCKED'
      )
    }
    else if (to === 'pending' && from === 'draft') {
      // submit करने की अनुमति चाहिए
      const perms = req.auth.permissions
      const allowed = perms.includes('*') ||
        perms.includes('applications:submit') || perms.includes('applications:create')
      if (!allowed) {
        throw new AppError('आवेदन submit करने की अनुमति नहीं है', 403, 'FORBIDDEN')
      }
      updates.submittedBy = req.auth.username
      updates.submittedByName = req.auth.name
      updates.submittedAt = new Date()
      updates.progress = 100
    }
  }

  const before = existing.toObject()
  const application = await Application.findByIdAndUpdate(req.params.id, updates, { new: true })

  const justSubmitted = before.status === 'draft' && application.status === 'pending'

  await audit(req, {
    action: justSubmitted ? 'APPLICATION_SUBMITTED' : 'APPLICATION_UPDATED',
    category: 'application',
    severity: justSubmitted ? 'warning' : 'info',
    entityType: 'Application', entityId: application._id,
    entityLabel: `${application.applicationId} — ${application.fullName || ''}`,
    amount: justSubmitted ? (application.loanAmount || null) : null,
    changes: diffChanges(before, application.toObject(), Object.keys(req.body))
  })

  res.json({
    success: true,
    application,
    submitted: justSubmitted,
    message: justSubmitted ? 'आवेदन submit हो गया — अब स्वीकृति का इंतज़ार है' : undefined
  })
}))

// ── SUBMIT (साफ़-सुथरा अलग रास्ता) ─────────────────────────────
app.post('/api/applications/:id/submit', authenticate, requirePermission('applications:submit', 'applications:create'), asyncHandler(async (req, res) => {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

  const existing = await Application.findById(req.params.id)
  if (!existing) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')
  if (!canAccessRecord(req, existing)) throw new AppError('यह आवेदन आपका नहीं है', 403, 'FORBIDDEN')

  if (existing.status !== 'draft') {
    throw new AppError(`यह आवेदन पहले ही submit हो चुका है (${existing.status})`, 400, 'ALREADY_SUBMITTED')
  }

  // ज़रूरी जानकारी भरी है या नहीं
  const missing = []
  if (!existing.fullName) missing.push('ग्राहक का नाम')
  if (!existing.mobile) missing.push('मोबाइल नंबर')
  if (!existing.loanAmount) missing.push('लोन राशि')
  if (missing.length && req.body?.force !== true) {
    throw new AppError(`ये जानकारी अभी बाकी है: ${missing.join(', ')}`, 400, 'INCOMPLETE', missing)
  }

  const application = await Application.findByIdAndUpdate(
    req.params.id,
    stampUpdate(req, {
      status: 'pending',
      progress: 100,
      submittedBy: req.auth.username,
      submittedByName: req.auth.name,
      submittedAt: new Date()
    }),
    { new: true }
  )

  await audit(req, {
    action: 'APPLICATION_SUBMITTED', category: 'application', severity: 'warning',
    entityType: 'Application', entityId: application._id,
    entityLabel: `${application.applicationId} — ${application.fullName || ''}`,
    amount: application.loanAmount || null,
    changes: { status: { from: 'draft', to: 'pending' } },
    metadata: { createdByUserId: existing.createdByUserId }
  })

  res.json({
    success: true, application,
    message: 'आवेदन submit हो गया — अब स्वीकृति का इंतज़ार है'
  })
}))

// ── STATUS CHANGE (approve / reject) ───────────────────────────
app.patch('/api/applications/:id/status',
  authenticate,
  requirePermission('applications:approve', 'applications:reject'),
  requireReAuth('applications:approve'),
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

    const { status, rejectionReason } = req.body || {}
    if (!status) throw new AppError('Status ज़रूरी है', 400, 'MISSING_STATUS')

    const existing = await Application.findById(req.params.id)
    if (!existing) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')

    const updates = stampUpdate(req, { status })

    if (status === 'approved') {
      updates.approvedBy = req.auth.username
      updates.approvedByName = req.auth.name
      updates.approvedByUserId = req.auth.id
      updates.approvedAt = new Date()
    } else if (status === 'rejected') {
      if (!rejectionReason) throw new AppError('Reject करने का कारण लिखना ज़रूरी है', 400, 'MISSING_REASON')
      updates.rejectedBy = req.auth.username
      updates.rejectedByName = req.auth.name
      updates.rejectedAt = new Date()
      updates.rejectionReason = rejectionReason
    }

    const application = await Application.findByIdAndUpdate(req.params.id, updates, { new: true })

    await audit(req, {
      action: status === 'approved' ? 'APPLICATION_APPROVED'
            : status === 'rejected' ? 'APPLICATION_REJECTED'
            : 'APPLICATION_UPDATED',
      category: 'application', severity: 'critical',
      entityType: 'Application', entityId: application._id,
      entityLabel: `${application.applicationId} — ${application.fullName || ''}`,
      amount: application.loanAmount || null,
      changes: { status: { from: existing.status, to: status } },
      metadata: {
        rejectionReason: rejectionReason || '',
        createdByUserId: existing.createdByUserId,
        customerName: existing.fullName
      }
    })

    res.json({ success: true, application })
  })
)

// ── ASSIGN ─────────────────────────────────────────────────────
app.patch('/api/applications/:id/assign', authenticate, requirePermission('applications:assign'), asyncHandler(async (req, res) => {
  const { assignedTo } = req.body || {}
  if (!assignedTo) throw new AppError('किसको assign करना है, बताएं', 400, 'MISSING_ASSIGNEE')

  const target = (await User.findById(assignedTo).catch(() => null)) || await User.findOne({ username: assignedTo })
  if (!target) throw new AppError('यह user नहीं मिला', 404, 'USER_NOT_FOUND')

  const application = await Application.findByIdAndUpdate(
    req.params.id,
    stampUpdate(req, { assignedTo: String(target._id), assignedToName: target.name }),
    { new: true }
  )
  if (!application) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')

  await audit(req, {
    action: 'APPLICATION_ASSIGNED', category: 'application',
    entityType: 'Application', entityId: application._id,
    entityLabel: `${application.applicationId} → ${target.name}`,
    metadata: {
      assignedToUserId: String(target._id),
      applicationId: application.applicationId,
      customerName: application.fullName
    }
  })

  res.json({ success: true, application })
}))

// ── DELETE ─────────────────────────────────────────────────────
app.delete('/api/applications/:id',
  authenticate,
  requirePermission('applications:delete'),
  requireReAuth('applications:delete'),
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')

    const application = await Application.findById(req.params.id)
    if (!application) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')

    await audit(req, {
      action: 'APPLICATION_DELETED', category: 'application', severity: 'critical',
      entityType: 'Application', entityId: application._id,
      entityLabel: `${application.applicationId} — ${application.fullName || ''}`,
      metadata: { snapshot: JSON.parse(JSON.stringify(application.toObject())) }
    })

    await Application.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'आवेदन हटा दिया गया' })
  })
)

// ═══════════════════════════════════════════════════════════════
// 8. पुराने routes (जस के तस)
// ═══════════════════════════════════════════════════════════════
mount('/api/payments',       './routes/payments',       'Payments (legacy)')
mount('/api/investigations', './routes/investigations', 'Investigations')
mount('/api/vehicles',       './routes/vehicles',       'Vehicles')
mount('/api/penalties',      './routes/penalties',      'Penalties')
mount('/api/sms',            './routes/sms',            'SMS')

try {
  const createCRUDRoutes = require('./routes/generic')
  const generic = [
    'reports', 'templates', 'offers', 'pre-sanctions', 'cibil-reports',
    'bank-analysis', 'eligibility-checks', 'loan-comparisons',
    'document-verifications', 'customer-portals', 'admin-logs',
    'followups', 'targets', 'notifications', 'verifications'
  ]
  generic.forEach(name => app.use(`/api/${name}`, createCRUDRoutes(name)))
  console.log('✅ Generic CRUD routes')
} catch (e) {
  console.log('⚠️  Generic routes नहीं मिले:', e.message)
}

// ═══════════════════════════════════════════════════════════════
// 9. UTILITY ROUTES
// ═══════════════════════════════════════════════════════════════
app.get('/api/backup', authenticate, requirePermission('backups:view'), asyncHandler(async (req, res) => {
  const [applications, users] = await Promise.all([
    Application.find().limit(20000).lean(),
    User.find().lean()
  ])
  const safeUsers = users.map(u => { delete u.password; delete u.resetTokenHash; return u })

  await audit(req, {
    action: 'BACKUP_CREATED', category: 'system', severity: 'critical',
    metadata: { applications: applications.length, users: safeUsers.length }
  })

  res.json({ success: true, backup: { timestamp: new Date(), applications, users: safeUsers } })
}))

app.get('/api/analytics', authenticate, requirePermission('analytics:view'), asyncHandler(async (req, res) => {
  const scope = buildScopeFilter(req)
  const result = await Application.aggregate([
    { $match: { ...scope, status: { $ne: 'draft' } } },
    { $group: { _id: null, totalApplications: { $sum: 1 }, totalLoan: { $sum: '$loanAmount' }, totalEMI: { $sum: '$emiAmount' } } }
  ]).allowDiskUse(true)

  res.json({ success: true, analytics: result[0] || { totalApplications: 0, totalLoan: 0, totalEMI: 0 } })
}))

// ═══════════════════════════════════════════════════════════════
// 10. ERROR HANDLING
// ═══════════════════════════════════════════════════════════════
app.use('/api/*', notFoundHandler)
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found', path: req.originalUrl, requestId: req.requestId })
})
app.use(errorHandler)

// ═══════════════════════════════════════════════════════════════
// 11. START  (HTTP server + Socket.io)
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 10000
const httpServer = http.createServer(app)

// Real-time चालू करो
realtime.init(httpServer, ALLOWED_ORIGINS)

httpServer.listen(PORT, () => {
  console.log('═══════════════════════════════════════════')
  console.log('🚀 Vishesh Finance ERP  v13.0.0')
  console.log(`📍 Port: ${PORT}`)
  console.log(`🔐 Helmet + CORS whitelist + rate limit चालू`)
  console.log(`🌐 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
  console.log(`☁️  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'NOT configured'}`)
  console.log(`⚡ Real-time: ${realtime.isReady() ? 'चालू' : 'बंद'}`)
  console.log(`💬 WhatsApp: ${process.env.WHATSAPP_ENABLED === 'true' && process.env.WHATSAPP_PHONE_NUMBER_ID ? 'अपने आप भेजेगा' : 'link मोड'}`)
  console.log(`📧 Email: ${(process.env.EMAIL_PROVIDER || 'none') !== 'none' ? process.env.EMAIL_PROVIDER : 'बंद'}  ·  📱 SMS: ${(process.env.SMS_PROVIDER || 'none') !== 'none' ? process.env.SMS_PROVIDER : 'बंद'}`)
  console.log(`📋 Legacy 404 mode: ${process.env.LEGACY_EMPTY_RESPONSES !== 'false' ? 'ON' : 'OFF'}`)
  console.log('═══════════════════════════════════════════')
})

const shutdown = (signal) => {
  console.log(`\n${signal} मिला — server बंद कर रहे हैं...`)
  const io = realtime.getIO()
  if (io) io.close()
  httpServer.close(() => {
    mongoose.connection.close(false).then(() => {
      console.log('✅ साफ़-सुथरा बंद हो गया')
      process.exit(0)
    })
  })
  setTimeout(() => process.exit(1), 10000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err))
process.on('uncaughtException', err => { console.error('❌ Uncaught exception:', err); process.exit(1) })

module.exports = app
module.exports.httpServer = httpServer
