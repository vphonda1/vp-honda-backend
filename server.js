// ═══════════════════════════════════════════════════════════════════════
// server.js  —  Vishesh Finance ERP Backend  v14.0.0  (Phase 1–16)
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
// Phase 16 — ग्राहक खुद Aadhaar download व CIBIL self-check कर सके, ऐसे shortcut links
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

// ── Phase 18.2: हर JSON जवाब gzip में — मोबाइल पर 5–10 गुना कम data ──
// Node का built-in zlib — कोई नया package नहीं; गड़बड़ी हो तो सामान्य जवाब
try {
  app.use(require('./middleware/gzipJson'))
  console.log('✅ JSON gzip चालू')
} catch (e) {
  console.log('⚠️  gzip middleware नहीं चला (बिना gzip चलेगा):', e.message)
}

// ⭐ Phase 22: verify से कच्चा body बचा लेते हैं.
//    Razorpay का webhook अपने signature की जाँच कच्चे body पर ही
//    करवाता है — JSON में बदलने के बाद वह मिलान नहीं हो पाता.
//    यह सिर्फ़ buffer रखता है, parsing बिल्कुल पहले जैसी रहती है.
app.use(express.json({
  limit: process.env.JSON_LIMIT || '15mb',
  verify: (req, res, buf) => { req.rawBody = buf }
}))
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_LIMIT || '15mb' }))
app.use(requestId)

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT || '1000', 10),
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

    // ── एक-बार-चलने वाली सफ़ाई: पुराना "mobile" unique index हटाना ──
    // पहले किसी version में mobile unique था, अब schema में नहीं है, पर
    // MongoDB में वो पुराना नियम अटका रह गया — इसी वजह से नए users का
    // mobile number "पहले से मौजूद है" गलत तरीके से दिखा रहा था।
    try {
      const idx = await User.collection.indexes()
      const badIndex = idx.find(i => i.key && i.key.mobile === 1 && i.unique)
      if (badIndex) {
        await User.collection.dropIndex(badIndex.name)
        console.log(`✅ पुराना mobile unique index हटाया: ${badIndex.name}`)
      }
    } catch (e) {
      console.log('⚠️  mobile index सफ़ाई में समस्या (नुकसान नहीं है):', e.message)
    }

    // ── एक-बार-चलने वाली सफ़ाई: गलती से लगा dataScope:'own' हटाना ──
    // पुराने buggy code ने हर user (Super Admin समेत) को गलती से
    // dataScope:'own' पर सीमित कर दिया था — इससे उनका असली role-based
    // access (जैसे "सब कुछ देखो") दब गया था। यहाँ उसे वापस खोल रहे हैं
    // ताकि role खुद तय करे कि किसे कितना दिखे।
    try {
      const r = await User.updateMany(
        { dataScope: 'own', role: { $in: ['SUPER_ADMIN', 'ADMIN', 'super-admin', 'admin'] } },
        { $unset: { dataScope: '' } }
      )
      if (r.modifiedCount > 0) {
        console.log(`✅ ${r.modifiedCount} admin account(s) का गलत dataScope साफ़ किया`)
      }
    } catch (e) {
      console.log('⚠️  dataScope सफ़ाई में समस्या (नुकसान नहीं है):', e.message)
    }


    // ── एक-बार-चलने वाली सफ़ाई: पुराने HDB-import ग्राहकों के नाम/मोबाइल ठीक करना ──
    // कुछ पुराने records "customerName"/"phone" field में डेटा रखते हैं,
    // जबकि असली schema "fullName"/"mobile" चाहता है — इसी वजह से वो
    // Dashboard/खोज में "undefined" दिखते थे। यह सिर्फ खाली fields भरता
    // है, कोई मौजूदा सही डेटा नहीं मिटाता/बदलता।
    try {
      const Customer = require('./models/Customer')
      if (Customer) {
        const stray = await Customer.find({
          $or: [{ fullName: { $exists: false } }, { fullName: '' }, { fullName: null }]
        }).select('customerName name phone mobileNo mobile fullName').lean()

        console.log(`ℹ️  ग्राहक records जांचे — खाली नाम/मोबाइल वाले मिले: ${stray.length}`)

        let fixed = 0
        for (const c of stray) {
          const updates = {}
          const nameGuess = c.fullName || c.customerName || c.name
          if (nameGuess && !c.fullName) updates.fullName = String(nameGuess).trim()

          if (!c.mobile) {
            const rawPhone = c.phone || c.mobileNo || ''
            const firstNumber = String(rawPhone).split('/')[0].replace(/\D/g, '').slice(0, 10)
            if (firstNumber.length === 10) updates.mobile = firstNumber
          }

          if (Object.keys(updates).length > 0) {
            await Customer.updateOne({ _id: c._id }, { $set: updates })
            fixed++
          }
        }
        console.log(`✅ ${fixed} ग्राहक records का नाम/मोबाइल ठीक किया (कुल जांचे: ${stray.length})`)
      }
    } catch (e) {
      console.log('⚠️  ग्राहक record सफ़ाई में समस्या (नुकसान नहीं है):', e.message)
    }

    // ── एक-बार-चलने वाली सफ़ाई: Activa/Dio जैसे scooters गलती से "Motorcycle" ──
    // की category में save हो गए थे (Excel import में हर गाड़ी default रूप से
    // Motorcycle मान ली जाती थी) — अब मॉडल के नाम से पहचानकर सही करते हैं
    try {
      const Vehicle = mongoose.models.Vehicle
      if (!Vehicle) {
        console.log('⚠️  Vehicle model अभी register नहीं हुआ — यह सफ़ाई अगली बार होगी')
      } else {
        const scooterNames = ['activa', 'dio', 'aviator', 'grazia', 'destini', 'jazz', 'zest', 'pleasure', 'access', 'fascino', 'ntorq', 'ray', 'jupiter']
        const rx = new RegExp(scooterNames.join('|'), 'i')
        const wrongOnes = await Vehicle.find({ category: 'Motorcycle', model: rx }).select('model category').lean()
        console.log(`ℹ️  Vehicle category जांचे — गलत Scooter/Motorcycle मिले: ${wrongOnes.length}`)
        if (wrongOnes.length > 0) {
          await Vehicle.updateMany(
            { _id: { $in: wrongOnes.map(v => v._id) } },
            { $set: { category: 'Scooter' } }
          )
          console.log(`✅ ${wrongOnes.length} vehicle की category "Motorcycle" से "Scooter" ठीक की`)
        }
      }
    } catch (e) {
      console.log('⚠️  Vehicle category सफ़ाई में समस्या (नुकसान नहीं है):', e.message)
    }


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
// Phase 18.2: "सबसे नए पहले" वाली सूचियों (admin सूची, ग्राहक खोज) के लिए —
// इसके बिना MongoDB हर आवेदन (फ़ोटो समेत) memory में पढ़कर sort करता था
applicationSchema.index({ updatedAt: -1 })
// Phase 19: "पुराने दस्तावेज़" की सूची createdAt से sort होती है —
// index के बिना MongoDB भारी आवेदन memory में sort करता था (Sort memory limit error)
applicationSchema.index({ createdAt: -1 })
applicationSchema.index({ createdByUserId: 1, updatedAt: -1 })
applicationSchema.index({ branchId: 1, status: 1, updatedAt: -1 })

const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema)

// ═══════════════════════════════════════════════════════════════
// Phase 18: हल्की list (Performance) — सबसे बड़ा सुधार
// ───────────────────────────────────────────────────────────────
// आवेदन के अंदर आधार, PAN, फ़ोटो, हस्ताक्षर जैसे दस्तावेज़ base64 रूप में
// रखे होते हैं (एक आवेदन = 1–5 MB)। पहले हर list (ड्राफ्ट, आवेदन सूची,
// ग्राहक खोज, डैशबोर्ड) 100–200 आवेदनों के साथ ये सारी फ़ोटो भी भेजती थी
// — यानी हर बार सैकड़ों MB, जबकि list में फ़ोटो कहीं दिखती ही नहीं।
//
// अब list में हर base64 फ़ाइल की जगह सिर्फ़ `true` जाता है ("फ़ाइल है"),
// यह काम MongoDB के अंदर ही होता है — भारी data server/मोबाइल तक आता ही नहीं।
//   • http(s) वाले Cloudinary link वैसे ही रहते हैं
//   • `app.documents?.photo` जैसी "है या नहीं" वाली जाँच पहले जैसी चलती है
//   • एक आवेदन खोलने (GET /api/applications/:id) पर पूरा data पहले जैसा मिलता है
//   • पुराना पूरा data चाहिए तो ?full=true
// ═══════════════════════════════════════════════════════════════
const isB64 = (v) => ({
  $and: [
    { $eq: [{ $type: v }, 'string'] },
    { $gt: [{ $strLenCP: v }, 100] },
    { $eq: [{ $substrCP: [v, 0, 5] }, 'data:'] }
  ]
})
const liteObject = (obj) => ({
  $arrayToObject: {
    $map: {
      input: { $objectToArray: obj },
      as: 'd',
      in: { k: '$$d.k', v: { $cond: [isB64('$$d.v'), true, '$$d.v'] } }
    }
  }
})
const LITE_STAGE = {
  $replaceRoot: {
    newRoot: {
      $arrayToObject: {
        $map: {
          input: { $objectToArray: '$$ROOT' },
          as: 'f',
          in: {
            k: '$$f.k',
            v: {
              $switch: {
                branches: [
                  { case: isB64('$$f.v'), then: true },
                  {
                    // documents / docs / कोई भी पुराना nested object — एक स्तर अंदर तक छानो
                    case: { $eq: [{ $type: '$$f.v' }, 'object'] },
                    then: liteObject('$$f.v')
                  }
                ],
                default: '$$f.v'
              }
            }
          }
        }
      }
    }
  }
}

/** list के लिए हल्का find — filter को schema के हिसाब से cast करके aggregate */
async function findApplicationsLite(filter, { sort = { updatedAt: -1 }, skip = 0, limit = 100 } = {}) {
  const casted = Application.find().cast(Application, filter)
  return Application.aggregate([
    { $match: casted },
    { $sort: sort },
    ...(skip ? [{ $skip: skip }] : []),
    { $limit: limit },
    LITE_STAGE
  ]).allowDiskUse(true)
}

/** JS में base64 हटाना (autosave के जवाब के लिए) */
function stripBase64(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > 100 && v.startsWith('data:')) out[k] = true
    else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && typeof v.toHexString !== 'function') {
      // documents / docs / कोई भी nested object — एक स्तर अंदर तक
      const inner = {}
      for (const [ik, iv] of Object.entries(v)) inner[ik] = (typeof iv === 'string' && iv.length > 100 && iv.startsWith('data:')) ? true : iv
      out[k] = inner
    }
    else out[k] = v
  }
  return out
}

// ═══════════════════════════════════════════════════════════════
// 5. HEALTH / ROOT
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Vishesh Finance ERP API', version: '14.0.0', timestamp: new Date() })
})

app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting']
  res.json({
    success: true,
    status: mongoose.connection.readyState === 1 ? 'healthy' : 'degraded',
    database: states[mongoose.connection.readyState] || 'unknown',
    version: '14.0.0',
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
// ⭐ Phase 22: ऑटो-पे — हर महीने किश्त अपने आप
mount('/api/jobs',          './jobs/autopay',         'AutoPay job')
mount('/api/autopay',       './routes/autopay',       'AutoPay routes')

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

// ── Phase 16: ग्राहक का अपना CIBIL self-check link भेजना ──
mount('/api/cibil-link', './routes/cibilLink', 'CIBIL score-check link routes')

// ── Phase 17: Video KYC + ग्राहक/गवाह वीडियो सहमति ──
// ⚠️ /api/video-kyc/public/* बिना login — सिर्फ़ सही token से; बाक़ी login ज़रूरी
mount('/api/video-kyc', './routes/videoKyc', 'Video KYC routes')

// ── Phase 21: मोबाइल notification (Web Push) ──
// ⚠️ /api/push/public-key बिना login खुला है (वह चाबी सार्वजनिक ही होती है);
//    बाक़ी सब रास्तों पर login ज़रूरी है
mount('/api/push', './routes/push', 'Push notification routes')

// ── Phase 21B: "मेरा खाता" — ग्राहक का अपना हिस्सा ──
// ⚠️ /api/my/send-otp और /verify-otp बिना login (OTP से ही पहचान होती है);
//    बाक़ी सब रास्तों पर ग्राहक का token ज़रूरी — staff का token यहाँ नहीं चलता
mount('/api/my', './routes/customerPortal', 'Customer portal routes (मेरा खाता)')

// ── Phase 7: ड्राफ्ट, फाइनेंस कंपनी, सार्वजनिक सत्यापन ──
// mount('/api/drafts', './routes/drafts', 'Draft routes') // ❌ हटाया — draftManager.js अब /api/applications इस्तेमाल करता है, यह route कहीं इस्तेमाल नहीं होता
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
    req.query.full === 'true'
      ? Application.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).allowDiskUse(true).lean()
      : findApplicationsLite(filter, { skip: (page - 1) * limit, limit }),   // Phase 18: फ़ोटो नहीं
    Application.countDocuments(filter)
  ])

  res.json({ success: true, applications, count: applications.length, total, page, pages: Math.ceil(total / limit) || 1 })
}))

// ── SEARCH ─────────────────────────────────────────────────────
app.get('/api/applications/search/:query', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const q = String(req.params.query || '').trim()
  if (q.length < 2) throw new AppError('कम से कम 2 अक्षर लिखें', 400, 'QUERY_TOO_SHORT')

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  // Phase 18: फ़ोटो के बिना हल्के नतीजे
  const applications = await findApplicationsLite({
    ...buildScopeFilter(req),
    $or: [{ fullName: rx }, { mobile: rx }, { vehicleModel: rx }, { applicationId: rx }]
  }, { limit: 50 })

  res.json({ success: true, applications, count: applications.length })
}))

// ── LIST ───────────────────────────────────────────────────────
app.get('/api/applications', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10))
  const limit = Math.min(1000, parseInt(req.query.limit || '200', 10))

  const filter = { ...buildScopeFilter(req) }
  if (req.query.status)     filter.status = req.query.status
  // ── draft/test entries शुरू से ही छान दो, पूरा collection कभी मत मंगाओ ──
  else if (req.query.excludeStatus) filter.status = { $ne: req.query.excludeStatus }
  if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo
  if (req.query.branchId)   filter.branchId = req.query.branchId

  let listPromise
  if (req.query.fields === 'summary') {
    // ── list/dropdown के लिए सिर्फ़ ज़रूरी field — बाकी भारी KYC data नहीं भेजो ──
    listPromise = Application.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).allowDiskUse(true)
      .select('fullName mobile vehicleModel applicationId status tenure emiAmount interestRate updatedAt createdAt').lean()
  } else if (req.query.full === 'true') {
    listPromise = Application.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).allowDiskUse(true).lean()
  } else {
    // Phase 18: सारे field, पर base64 फ़ोटो की जगह सिर्फ़ `true`
    listPromise = findApplicationsLite(filter, { skip: (page - 1) * limit, limit })
  }
  const [applications, total] = await Promise.all([
    listPromise,
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
// ═══════════════════════════════════════════════════════════════
// Phase 19: GET /api/applications/progress?ids=a,b,c
// ───────────────────────────────────────────────────────────────
// एक ही call में बताता है कि इन आवेदनों का कौन-सा काम हो चुका है:
//   • लोन खाता बना या नहीं (और उसका नंबर)
//   • Video KYC — भेजा/चल रहा/जमा/सत्यापित/बाकी
//   • दस्तावेज़ केंद्र में कितने दस्तावेज़ हैं
// सूची में हरा निशान और "अभी क्या बाकी है" दिखाने के लिए।
// ═══════════════════════════════════════════════════════════════
app.get('/api/applications/progress', authenticate, requirePermission('applications:view'), asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',').map(s => s.trim()).filter(id => /^[0-9a-fA-F]{24}$/.test(id))
    .slice(0, 200)
  if (!ids.length) return res.json({ success: true, progress: {} })

  const objIds = ids.map(id => new mongoose.Types.ObjectId(id))
  const Loan = mongoose.models.Loan
  const VideoKyc = mongoose.models.VideoKyc
  const Document = mongoose.models.Document

  // आवेदन संख्या भी निकालो — पुराने लोन में सीधा link न हो तो उससे मिलान हो जाए
  const appRows = await Application.find({ _id: { $in: objIds } }).select('applicationId').lean()
  const noToId = {}
  appRows.forEach(a => { if (a.applicationId) noToId[a.applicationId] = String(a._id) })
  const appNos = Object.keys(noToId)

  const [loans, kycs, docCounts] = await Promise.all([
    Loan ? Loan.find({
      $or: [
        { applicationRef: { $in: objIds } },
        ...(appNos.length ? [{ applicationId: { $in: appNos } }] : [])
      ]
    }).select('applicationRef applicationId loanAccountNo status').lean() : [],
    VideoKyc ? VideoKyc.find({ applicationRef: { $in: objIds } })
      .select('applicationRef status locked submittedAt createdAt').sort({ createdAt: -1 }).lean() : [],
    Document ? Document.aggregate([
      { $match: { applicationId: { $in: ids }, isLatest: true } },
      { $group: { _id: '$applicationId', n: { $sum: 1 } } }
    ]) : []
  ])

  const progress = {}
  ids.forEach(id => { progress[id] = { loan: null, videoKyc: null, documents: 0 } })

  loans.forEach(l => {
    const k = l.applicationRef ? String(l.applicationRef) : noToId[l.applicationId]
    if (k && progress[k] && !progress[k].loan) {
      progress[k].loan = { loanAccountNo: l.loanAccountNo, status: l.status }
    }
  })
  // ⭐ पहले सिर्फ़ सबसे नया link देखा जाता था — इसलिए पूरी हो चुकी KYC के बाद कोई नया link बना हो
  //    तो सूची में "link भेजा" दिखता रहता था (जबकि अंदर KYC पूरी थी).
  //    अब: जमा/सत्यापित हो चुकी KYC सबसे ऊपर; अस्वीकृत के बाद नया link गया हो तो वही नया दिखे.
  const kycByApp = {}
  kycs.forEach(v => {                                   // sort पहले ही नया→पुराना है
    const k = String(v.applicationRef)
    if (!kycByApp[k]) kycByApp[k] = []
    kycByApp[k].push(v)
  })
  Object.keys(kycByApp).forEach(k => {
    if (!progress[k]) return
    const list = kycByApp[k]
    const newest = list[0]
    const submitted = list.find(v => ['verified', 'completed', 'rejected'].includes(v.status))   // सबसे नई जमा हुई
    let pick = newest
    let redo = false
    if (submitted) {
      if (submitted.status !== 'rejected') pick = submitted
      else if (['pending', 'in_progress'].includes(newest.status)) { pick = newest; redo = true }
      else pick = submitted
    }
    progress[k].videoKyc = { status: pick.status, locked: pick.locked, submittedAt: pick.submittedAt || null, redo }
  })
  docCounts.forEach(d => { if (progress[d._id]) progress[d._id].documents = d.n })

  res.json({ success: true, progress })
}))

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
    // Phase 18.1: 360 page फ़ोटो नहीं दिखाता (दस्तावेज़ Document collection से आते हैं) —
    // इसलिए base64 फ़ोटो की जगह सिर्फ़ `true`, page बहुत जल्दी खुलता है
    application: req.query.full === 'true' ? application : stripBase64(application.toObject()),
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

  if (!data.applicationId) {
    // ── क्रमबद्ध Application ID: APP-0001, APP-0002... (timestamp नहीं) ──
    let candidate, tries = 0
    const base = await Application.countDocuments()
    do {
      candidate = 'APP-' + String(base + 1 + tries).padStart(5, '0')
      tries++
    } while (tries < 50 && await Application.exists({ applicationId: candidate }))
    data.applicationId = candidate
  }

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
    // Phase 18: auto-save (?lite=1) को पूरी फ़ोटो वापस भेजने की ज़रूरत नहीं
    application: req.query.lite === '1' ? stripBase64(application.toObject()) : application,
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
  console.log('🚀 Vishesh Finance ERP  v14.0.0')
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
