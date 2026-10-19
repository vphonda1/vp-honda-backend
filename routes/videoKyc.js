// ═══════════════════════════════════════════════════════════════
// routes/videoKyc.js  —  Video KYC + ग्राहक/गवाह सहमति (Phase 17.1)
// ───────────────────────────────────────────────────────────────
// पूरा रास्ता:
//   Admin link बनाता है  →  ग्राहक मोबाइल browser में खोलता है  →
//   ग्राहक का वीडियो  →  गवाह(ओं) के वीडियो  →  मोबाइल पर ही छोटा
//   (compressed) होकर सीधे Cloudinary पर upload  →  यहाँ metadata  →
//   Final Submit (lock)  →  Admin Play / Download / Verify / Reject
//
// दो हिस्से:
//   /api/video-kyc/public/:token/...   बिना login — सिर्फ़ सही token से
//   /api/video-kyc/...                 login + permission ज़रूरी
//
// ⚠️ public routes कभी 401 नहीं लौटाते (ताकि staff के फ़ोन पर link
//    खोलने से उनका login न टूटे) — गलत/पुराना link = 404 / 410
// ═══════════════════════════════════════════════════════════════

const express = require('express')
const crypto = require('crypto')
const mongoose = require('mongoose')

const VideoKyc = require('../models/VideoKyc')
const storage = require('../services/videoKycStorage')
const vault = require('../services/videoKycVault')        // Phase 17.3: दस्तावेज़ केंद्र में जोड़ना
const { authenticate, requirePermission, canAccessRecord } = require('../middleware/auth')
const { audit } = require('../middleware/audit')
const { asyncHandler, AppError } = require('../middleware/errorHandler')

let messenger = null
let wa = null
try { messenger = require('../services/messengerService') } catch { /* वैकल्पिक */ }
try { wa = require('../services/whatsappService') } catch { /* वैकल्पिक */ }

const router = express.Router()

const PORTAL_URL = process.env.FRONTEND_URL || 'https://vphonda-frontend.vercel.app'
const MIN_SECONDS = parseInt(process.env.VKYC_MIN_SECONDS || '8', 10)
const MAX_SECONDS = parseInt(process.env.VKYC_MAX_SECONDS || '120', 10)
const DEFAULT_MIN_WITNESSES = parseInt(process.env.VKYC_MIN_WITNESSES || '1', 10)
const MAX_WITNESSES = 3
const MAX_SIGNATURES = 40                                   // एक link से अधिकतम upload कोशिशें
// submit से पहले दोबारा रिकॉर्ड हुआ पुराना वीडियो Cloudinary से हटे (जगह बचे)।
// सब पुराने version भी रखने हों तो env VKYC_KEEP_OLD_VERSIONS=true
const KEEP_OLD_VERSIONS = process.env.VKYC_KEEP_OLD_VERSIONS === 'true'

// ─── छोटे helpers ─────────────────────────────────────────────
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const digits10 = (m) => String(m || '').replace(/\D/g, '').slice(-10)
const maskMobile = (m) => { const d = digits10(m); return d ? 'XXXXXX' + d.slice(-4) : '' }
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || ''
const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id || ''))

function Application() {
  return mongoose.models.Application || null
}

// ═══════════════════════════════════════════════════════════════
// कथन (statement) का snapshot — वही आँकड़े जो DO / Agreement में हैं
// ═══════════════════════════════════════════════════════════════
// ⭐ गाड़ी जिस कंपनी की चुनी है, कथन में वही कंपनी और वही दुकान का नाम आए।
//    पहले हर गाड़ी पर "वी पी होंडा" और सिर्फ़ Honda/Yakuza ही लिखा जाता था
//    (Mini Metro भी Yakuza दिखती थी). पहचान का तरीका frontend के brandUtils जैसा ही है.
//    दुकान का पता जोड़ना हो तो Render के env में डालें:
//      VKYC_SHOWROOM_NAME_YAKUZA, VKYC_SHOWROOM_NAME_MINI  (Honda के लिए VKYC_SHOWROOM_NAME)
const BRAND_INFO = {
  honda:  { brand: 'Honda',      isEV: false,
            showroom: () => process.env.VKYC_SHOWROOM_NAME || 'वी पी होंडा, परवलिया सड़क, भोपाल' },
  yakuza: { brand: 'Yakuza',     isEV: true,
            showroom: () => process.env.VKYC_SHOWROOM_NAME_YAKUZA || 'एम डी ऑटोमोबाइल' },
  mini:   { brand: 'Mini Metro', isEV: true,
            showroom: () => process.env.VKYC_SHOWROOM_NAME_MINI || 'एम डी ऑटोमोबाइल-1' }
}

const RE_YAKUZA = /yakuza|याकुज/i
const RE_MINI = /mini\s*-?\s*metro|e-?\s*rickshaw|loader|savari|मिनी\s*मेट्रो|सवारी/i
const RE_HONDA = /honda|होंडा|(^|[\s-])(shine|activa|sp\s?125|sp\s?160|unicorn|dio|hornet|livo|h-?ness|cd\s?110|cb\s?\d*)([\s-]|$)/i

function detectBrandKey(app) {
  const explicit = [app.brand, app.vehicleBrand, app.make, app.manufacturer].filter(Boolean).join(' ')
  const model = String(app.vehicleModel || '')

  // 1. सीधे लिखा ब्रांड, फिर 2. गाड़ी के नाम से
  for (const text of [explicit, model]) {
    if (!text) continue
    if (RE_YAKUZA.test(text)) return 'yakuza'
    if (RE_MINI.test(text)) return 'mini'
    if (RE_HONDA.test(text)) return 'honda'
  }

  // 3. श्रेणी / EV निशान से
  const cat = String(app.category || app.vehicleCategory || '').toLowerCase()
  if (/three|rickshaw|loader|savari/.test(cat)) return 'mini'
  if (app.isEV === true || cat === 'ev' || /electric/.test(cat)) return 'yakuza'

  // 4. कुछ न मिले तो Honda (दुकान का मूल काम)
  return 'honda'
}

function buildStatement(app) {
  const brandKey = detectBrandKey(app)
  const info = BRAND_INFO[brandKey]
  const isEV = info.isEV
  const vehiclePrice = num(app.grandTotal) || num(app.onRoadPrice) || num(app.exShowroomPrice)
  const loanAmount = num(app.loanAmount)

  const suggested = []
  if (app.w1Name) suggested.push({ name: String(app.w1Name).trim(), mobile: digits10(app.w1Mobile), relation: app.w1Relation || 'गारंटर' })
  if (app.w2Name) suggested.push({ name: String(app.w2Name).trim(), mobile: digits10(app.w2Mobile), relation: app.w2Relation || 'गारंटर' })

  return {
    applicationNo: app.applicationId || '',
    loanAccountNo: app.loanAccountNo || '',
    customerName: String(app.fullName || '').trim(),
    fatherName: app.fatherName || '',
    gender: app.gender || '',
    city: app.city || '',
    showroom: app.showroomName || info.showroom(),
    brand: info.brand,
    isEV,
    vehicleModel: app.vehicleModel || '',
    vehicleColor: app.vehicleColor || '',
    batteryLabel: app.selectedBatteryLabel || '',
    vehiclePrice,
    downPayment: num(app.downPayment),
    // Phase 19: बीमा तभी दिखे जब ग्राहक ने सच में लिया हो
    // पुराने आवेदनों में hasInsurance नहीं है — तब राशि से ही तय करो
    hasInsurance: (app.hasInsurance === undefined ? num(app.insurancePrice) > 0 : !!app.hasInsurance) && num(app.insurancePrice) > 0,
    insuranceAmount: num(app.insurancePrice),
    insuranceProvider: app.insuranceProvider || '',
    isFinance: loanAmount > 0,
    loanAmount,
    emiAmount: num(app.emiAmount),
    tenure: num(app.tenure),
    interestRate: num(app.interestRate),
    emiDate: num(app.emiDate) || 5,
    financer: process.env.COMPANY_NAME || 'Vishesh Finance Pvt Ltd',
    suggestedWitnesses: suggested,
    snapshotAt: new Date()
  }
}

// ─── recording का छोटा सार ────────────────────────────────────
function recSummary(r) {
  if (!r) return null
  return {
    id: String(r._id),
    role: r.role,
    witnessId: r.witnessId || '',
    personName: r.personName || '',
    version: r.version,
    duration: r.duration,
    bytes: r.bytes,
    uploadedAt: r.uploadedAt
  }
}

// ⭐ वीडियो "ठीक" है या नहीं — ऐसी गड़बड़ी जो सर्वर पर पकड़ी जा सकती है:
//    बहुत छोटा, लगभग खाली, या इतना हल्का कि न चित्र न आवाज़ (बिल्कुल रुकी/काली वीडियो).
//    (चेहरा दिख रहा है या बात सही है — यह जाँच स्टाफ़ review में होती है।)
const SHORT_TOLERANCE = 2            // माप में थोड़ा फ़र्क चलता है
const MIN_BYTES = 20 * 1024          // 20 KB से कम = खाली जैसा
const MIN_BYTES_PER_SEC = 1500       // इससे कम = न चित्र, न आवाज़

function recordingProblem(duration, bytes) {
  const d = num(duration), b = num(bytes)
  if (b > 0 && b < MIN_BYTES) return 'वीडियो लगभग खाली है'
  if (d > 0 && d < MIN_SECONDS - SHORT_TOLERANCE) return `वीडियो बहुत छोटा है (${Math.round(d)} सेकंड, कम से कम ${MIN_SECONDS} चाहिए)`
  if (d >= 3 && b > 0 && (b / d) < MIN_BYTES_PER_SEC) return 'वीडियो में चित्र/आवाज़ ठीक से नहीं आई'
  return ''
}

// ─── ग्राहक को दिखने वाला रूप (कोई निजी/अंदरूनी जानकारी नहीं) ──
function publicView(s) {
  const st = { ...(s.statement || {}) }
  st.suggestedWitnesses = (st.suggestedWitnesses || []).map(w => ({
    name: w.name, relation: w.relation, mobileHint: maskMobile(w.mobile)
  }))

  const witnessRecordings = {}
  s.witnesses.forEach(w => {
    witnessRecordings[String(w._id)] = recSummary(s.activeRecording('witness', String(w._id)))
  })

  return {
    status: s.status,
    locked: s.locked,
    expiresAt: s.expiresAt,
    submittedAt: s.submittedAt || null,
    statement: st,
    minWitnesses: s.minWitnesses,
    maxWitnesses: s.maxWitnesses,
    witnesses: s.witnesses.map(w => ({
      id: String(w._id), name: w.name, relation: w.relation, mobileHint: maskMobile(w.mobile)
    })),
    customerRecording: recSummary(s.activeRecording('customer')),
    witnessRecordings,
    limits: { minSeconds: MIN_SECONDS, maxSeconds: MAX_SECONDS }
  }
}

// ─── Admin को दिखने वाला रूप (token hash कभी नहीं) ──────────────
function adminView(s) {
  const o = s.toObject ? s.toObject() : s
  delete o.tokenHash
  delete o.pendingUploads
  const witnessName = {}
  ;(o.witnesses || []).forEach(w => { witnessName[String(w._id)] = w.name })

  o.recordings = (o.recordings || [])
    .map(r => ({
      ...r,
      _id: String(r._id),
      personName: r.personName || (r.role === 'witness' ? witnessName[r.witnessId] : o.customerName) || '',
      ...storage.urlsFor(r)
    }))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
  o.expired = o.status === 'expired' || (!o.locked && new Date(o.expiresAt).getTime() < Date.now() && ['pending', 'in_progress'].includes(o.status))
  return o
}

// ─── token से session लाना (हर public route में) ──────────────
async function loadByToken(token, { forWrite = false } = {}) {
  const t = String(token || '')
  if (t.length < 20 || t.length > 100 || !/^[A-Za-z0-9_-]+$/.test(t)) {
    throw new AppError('यह link सही नहीं है', 404, 'VKYC_INVALID')
  }
  const s = await VideoKyc.findOne({ tokenHash: sha256(t) })
  if (!s) throw new AppError('यह link सही नहीं है या हटा दिया गया है', 404, 'VKYC_INVALID')

  if (s.status === 'revoked') {
    throw new AppError('यह link रद्द कर दिया गया है — शोरूम से नया link मँगवाएँ', 410, 'VKYC_REVOKED')
  }
  if (s.isExpired()) {
    if (['pending', 'in_progress'].includes(s.status)) {
      s.status = 'expired'
      s.history.push({ action: 'EXPIRED', by: 'system', note: 'समय सीमा समाप्त' })
      await cleanupUnsubmittedFiles(s, 'link की समय सीमा समाप्त').catch(() => {})
      await s.save().catch(() => {})
    }
    throw new AppError('इस link की समय सीमा खत्म हो गई है — शोरूम से नया link मँगवाएँ', 410, 'VKYC_EXPIRED')
  }
  if (s.status === 'expired') {
    throw new AppError('इस link की समय सीमा खत्म हो गई है — शोरूम से नया link मँगवाएँ', 410, 'VKYC_EXPIRED')
  }
  if (forWrite && s.locked) {
    throw new AppError('Video KYC पहले ही जमा हो चुकी है — अब कोई बदलाव नहीं हो सकता', 409, 'VKYC_LOCKED')
  }
  return s
}

// ═══════════════════════════════════════════════════════════════
// जगह बचाना — बेकार files Cloudinary से हटाना (database का रिकॉर्ड रहता है)
// ═══════════════════════════════════════════════════════════════
async function deleteRecordingFile(rec, reason) {
  if (!rec || rec.fileDeleted) return false
  const ok = await storage.deleteVideo(rec.publicId, rec.storageType)
  if (ok) {
    rec.fileDeleted = true
    rec.fileDeletedAt = new Date()
    rec.deleteReason = reason
  }
  return ok
}

// अधूरा (submit न हुआ) session रद्द/expire हो तो उसकी सारी files हटा दो।
// ⚠️ जमा (locked) session की files कभी नहीं हटतीं।
async function cleanupUnsubmittedFiles(s, reason) {
  if (s.locked) return 0
  let removed = 0
  for (const r of s.recordings) {
    if (await deleteRecordingFile(r, reason)) removed++
  }
  for (const p of (s.pendingUploads || [])) {
    await storage.deleteVideo(p.publicId)          // अधूरा/अपंजीकृत upload
  }
  s.pendingUploads = []
  s.filesCleanedAt = new Date()
  if (removed) s.history.push({ action: 'FILES_REMOVED', by: 'system', note: `${removed} वीडियो file हटाई गईं — ${reason}` })
  return removed
}

function publicAudit(req, s, action, description, extra = {}) {
  // audit log में token न जाए — रास्ते से हटा दो
  const safeReq = {
    method: req.method,
    originalUrl: String(req.originalUrl || '').replace(/\/public\/[A-Za-z0-9_-]+/, '/public/***'),
    headers: req.headers,
    socket: req.socket,
    requestId: req.requestId
  }
  return audit(safeReq, {
    action,
    category: 'kyc',
    description,
    userName: `${s.customerName || 'ग्राहक'} (Video KYC link)`,
    username: 'vkyc-link',
    userRole: 'CUSTOMER',
    branchId: s.branchId || 'MAIN',
    entityType: 'Application',
    entityId: s.applicationRef,
    entityLabel: `${s.applicationNo || ''} — ${s.customerName || ''}`,
    metadata: { videoKycId: String(s._id), ...extra }
  }).catch(err => console.error('[VKYC] audit असफल:', err.message))
}

// ═══════════════════════════════════════════════════════════════
// ███  PUBLIC (बिना login)  ███
// ═══════════════════════════════════════════════════════════════

// ── GET /api/video-kyc/public/:token ──────────────────────────
router.get('/public/:token', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token)

  const now = new Date()
  const set = { lastOpenedAt: now }
  if (!s.firstOpenedAt) set.firstOpenedAt = now
  VideoKyc.updateOne({ _id: s._id }, { $set: set, $inc: { openCount: 1 } }).catch(() => {})

  if (!s.firstOpenedAt) {
    publicAudit(req, s, 'VKYC_LINK_OPENED', `${s.customerName || 'ग्राहक'} ने Video KYC link खोला`)
  }

  res.json({ success: true, session: publicView(s), storageReady: storage.ready() })
}))

// ── POST /api/video-kyc/public/:token/witness ─────────────────
router.post('/public/:token/witness', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token, { forWrite: true })
  const body = req.body || {}

  if (s.witnesses.length >= s.maxWitnesses) {
    throw new AppError(`अधिकतम ${s.maxWitnesses} गवाह जोड़े जा सकते हैं`, 400, 'VKYC_WITNESS_LIMIT')
  }

  let name = String(body.name || '').trim()
  let mobile = digits10(body.mobile)
  let relation = String(body.relation || '').trim()

  const idx = Number.isInteger(body.suggestionIndex) ? body.suggestionIndex : -1
  const sug = (s.statement?.suggestedWitnesses || [])[idx]
  if (sug) { name = sug.name; mobile = sug.mobile || mobile; relation = relation || sug.relation }

  if (name.length < 2) throw new AppError('गवाह का पूरा नाम लिखें', 400, 'VKYC_WITNESS_NAME')
  if (name.length > 80) name = name.slice(0, 80)
  if (body.mobile && !sug && mobile.length !== 10) throw new AppError('गवाह का मोबाइल नंबर 10 अंकों का हो', 400, 'VKYC_WITNESS_MOBILE')
  if (s.witnesses.some(w => w.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError('यह गवाह पहले से जुड़ा हुआ है', 400, 'VKYC_WITNESS_DUP')
  }
  if (s.customerName && name.toLowerCase() === s.customerName.toLowerCase()) {
    throw new AppError('ग्राहक खुद अपना गवाह नहीं हो सकता', 400, 'VKYC_WITNESS_SELF')
  }

  s.witnesses.push({ name, mobile, relation: relation.slice(0, 40) })
  if (s.status === 'pending') s.status = 'in_progress'
  s.history.push({ action: 'WITNESS_ADDED', by: 'customer-link', note: name, ip: clientIp(req) })
  await s.save()

  res.json({ success: true, session: publicView(s) })
}))

// ── DELETE /api/video-kyc/public/:token/witness/:wid ──────────
// सिर्फ़ तब हटेगा जब उस गवाह का कोई वीडियो न हो (audit सुरक्षित रहे)
router.delete('/public/:token/witness/:wid', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token, { forWrite: true })
  const w = isObjectId(req.params.wid) ? s.witnesses.id(req.params.wid) : null
  if (!w) throw new AppError('गवाह नहीं मिला', 404, 'VKYC_WITNESS_NOT_FOUND')
  if (s.recordings.some(r => r.role === 'witness' && String(r.witnessId) === String(w._id))) {
    throw new AppError('इस गवाह का वीडियो जमा हो चुका है — अब हटाया नहीं जा सकता', 400, 'VKYC_WITNESS_HAS_VIDEO')
  }
  const name = w.name
  s.witnesses.pull(w._id)
  s.history.push({ action: 'WITNESS_REMOVED', by: 'customer-link', note: name, ip: clientIp(req) })
  await s.save()
  res.json({ success: true, session: publicView(s) })
}))

// ── POST /api/video-kyc/public/:token/upload-signature ────────
router.post('/public/:token/upload-signature', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token, { forWrite: true })
  if (!storage.ready()) throw new AppError('वीडियो storage अभी चालू नहीं है — शोरूम को बताएँ', 503, 'VKYC_STORAGE_OFF')

  const role = req.body?.role === 'witness' ? 'witness' : 'customer'
  const witnessId = role === 'witness' ? String(req.body?.witnessId || '') : ''
  if (role === 'witness' && (!isObjectId(witnessId) || !s.witnesses.id(witnessId))) {
    throw new AppError('पहले गवाह जोड़ें', 400, 'VKYC_WITNESS_NOT_FOUND')
  }
  if (role === 'witness' && !s.activeRecording('customer')) {
    throw new AppError('पहले ग्राहक का वीडियो जमा करें, फिर गवाह का', 400, 'VKYC_CUSTOMER_FIRST')
  }

  const version = s.recordings.filter(r => r.role === role && (role !== 'witness' || String(r.witnessId) === witnessId)).length + 1
  if (version > 10 || (s.signaturesIssued || 0) >= MAX_SIGNATURES) {
    throw new AppError('बहुत बार दोबारा भेजा गया — शोरूम से नया link मँगवाएँ', 429, 'VKYC_TOO_MANY')
  }

  const sig = storage.createVideoUploadSignature({
    applicationNo: s.applicationNo || String(s.applicationRef),
    sessionId: String(s._id),
    role, witnessId, version
  })

  // 3 घंटे से पुराने अधूरे upload — सूची से भी और Cloudinary से भी हटाओ
  const cutoff = Date.now() - 3 * 3600 * 1000
  const all = s.pendingUploads || []
  const keep = all.filter(p => p.issuedAt && p.issuedAt.getTime() > cutoff).slice(-9)
  const drop = all.filter(p => !keep.includes(p))
  drop.forEach(p => storage.deleteVideo(p.publicId).catch(() => {}))
  s.pendingUploads = keep
  s.pendingUploads.push({ publicId: sig.publicId, role, witnessId, issuedAt: new Date() })
  s.signaturesIssued = (s.signaturesIssued || 0) + 1
  if (s.status === 'pending') s.status = 'in_progress'
  await s.save()

  res.json({ success: true, upload: sig })
}))

// ── POST /api/video-kyc/public/:token/recording ───────────────
// upload पूरा होने के बाद — Cloudinary से असली जानकारी जाँचकर दर्ज
router.post('/public/:token/recording', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token, { forWrite: true })
  const b = req.body || {}
  const role = b.role === 'witness' ? 'witness' : 'customer'
  const witnessId = role === 'witness' ? String(b.witnessId || '') : ''
  const publicId = String(b.publicId || '')

  const pending = (s.pendingUploads || []).find(p => p.publicId === publicId && p.role === role && (p.witnessId || '') === witnessId)
  if (!pending) throw new AppError('यह upload पहचाना नहीं गया — दोबारा record करके भेजें', 400, 'VKYC_UNKNOWN_UPLOAD')

  const witness = role === 'witness' && isObjectId(witnessId) ? s.witnesses.id(witnessId) : null
  if (role === 'witness' && !witness) throw new AppError('गवाह नहीं मिला', 404, 'VKYC_WITNESS_NOT_FOUND')

  const info = await storage.fetchVideoInfo(publicId)
  const bytes = info?.bytes || Math.max(0, num(b.bytes))
  const duration = (info && info.duration != null) ? info.duration : Math.max(0, num(b.duration))

  if (info && bytes === 0) throw new AppError('वीडियो खाली है — दोबारा record करें', 400, 'VKYC_EMPTY')

  // ⭐ ठीक न हो तो वहीं रोक दो — दर्ज ही न हो, और भेजी गई file भी हट जाए
  const problem = recordingProblem(duration, bytes)
  if (problem) {
    storage.deleteVideo(publicId).catch(() => {})
    s.pendingUploads = (s.pendingUploads || []).filter(p => p.publicId !== publicId)
    await s.save().catch(() => {})
    throw new AppError(`${problem} — यह वीडियो स्वीकार नहीं हुआ। कृपया "दोबारा रिकॉर्ड करें" दबाकर नया वीडियो बनाएँ।`, 400, 'VKYC_RECORDING_BAD')
  }

  // पुराना version: database में रिकॉर्ड "superseded" रहता है (audit),
  // पर उसकी file Cloudinary से हटती है ताकि जगह न घिरे
  const prev = s.activeRecording(role, witnessId)
  if (prev) {
    prev.superseded = true
    if (!KEEP_OLD_VERSIONS) await deleteRecordingFile(prev, 'दोबारा रिकॉर्ड किया गया (submit से पहले)')
  }
  const version = s.recordings.filter(r => r.role === role && (role !== 'witness' || String(r.witnessId) === witnessId)).length + 1

  s.recordings.push({
    role, witnessId, version,
    personName: role === 'witness' ? witness.name : s.customerName,
    publicId,
    storageType: storage.STORAGE_TYPE,
    resourceType: 'video',
    format: info?.format || String(b.format || '').slice(0, 10),
    bytes,
    duration: Math.round(duration * 10) / 10,
    width: info?.width || num(b.width),
    height: info?.height || num(b.height),
    mimeType: String(b.mimeType || '').slice(0, 80),
    cloudVerified: !!info,
    statementText: String(b.statementText || '').slice(0, 3000),
    recordedAt: b.recordedAt ? new Date(b.recordedAt) : new Date(),
    uploadedAt: new Date(),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300)
  })
  s.pendingUploads = s.pendingUploads.filter(p => p.publicId !== publicId)
  if (s.status === 'pending') s.status = 'in_progress'
  s.history.push({
    action: prev ? 'RECORDING_REPLACED' : 'RECORDING_UPLOADED',
    by: 'customer-link',
    note: `${role === 'witness' ? 'गवाह: ' + witness.name : 'ग्राहक'} · v${version} · ${(bytes / 1048576).toFixed(2)}MB · ${Math.round(duration)}s`,
    ip: clientIp(req)
  })
  await s.save()

  publicAudit(req, s, 'VKYC_RECORDING_UPLOADED',
    `Video KYC: ${role === 'witness' ? 'गवाह ' + witness.name : 'ग्राहक ' + (s.customerName || '')} का वीडियो जमा हुआ (v${version})`,
    { role, witnessId, version, bytes, duration })

  res.json({ success: true, session: publicView(s) })
}))

// ── POST /api/video-kyc/public/:token/submit ──────────────────
router.post('/public/:token/submit', asyncHandler(async (req, res) => {
  const s = await loadByToken(req.params.token, { forWrite: true })

  if (!s.activeRecording('customer')) throw new AppError('ग्राहक का वीडियो अभी बाकी है', 400, 'VKYC_CUSTOMER_MISSING')

  const noVideo = s.witnesses.filter(w => !s.activeRecording('witness', String(w._id)))
  if (noVideo.length) {
    throw new AppError(`इन गवाहों का वीडियो बाकी है: ${noVideo.map(w => w.name).join(', ')} — वीडियो record करें या उन्हें हटाएँ`, 400, 'VKYC_WITNESS_PENDING')
  }
  if (s.witnesses.length < s.minWitnesses) {
    throw new AppError(`कम से कम ${s.minWitnesses} गवाह का वीडियो ज़रूरी है`, 400, 'VKYC_WITNESS_MIN')
  }

  // ⭐ किसी का भी वीडियो ठीक न हो तो अभी जमा नहीं होगा — पहले दोबारा बनवाओ
  const badOnes = []
  const custRec = s.activeRecording('customer')
  const custProblem = recordingProblem(custRec.duration, custRec.bytes)
  if (custProblem) badOnes.push(`ग्राहक का वीडियो: ${custProblem}`)
  for (const w of s.witnesses) {
    const r = s.activeRecording('witness', String(w._id))
    const pr = r ? recordingProblem(r.duration, r.bytes) : ''
    if (pr) badOnes.push(`${w.name} (गवाह) का वीडियो: ${pr}`)
  }
  if (badOnes.length) {
    throw new AppError(
      `Video KYC अभी जमा नहीं होगी — ${badOnes.join('; ')}। कृपया ऊपर "दोबारा रिकॉर्ड करें" दबाकर ये वीडियो दोबारा बनाएँ, फिर जमा करें।`,
      400, 'VKYC_RECORDING_BAD')
  }

  // जो upload शुरू हुए पर दर्ज नहीं हुए — उनकी files हटाओ
  for (const p of (s.pendingUploads || [])) storage.deleteVideo(p.publicId).catch(() => {})

  s.locked = true
  s.status = 'completed'
  s.submittedAt = new Date()
  s.submittedIp = clientIp(req)
  s.pendingUploads = []
  s.history.push({ action: 'SUBMITTED', by: 'customer-link', note: `ग्राहक + ${s.witnesses.length} गवाह`, ip: s.submittedIp })
  await s.save()

  // ग्राहक के दस्तावेज़ फ़ोल्डर (Vault) में वीडियो जोड़ो — असफल हो तो भी submit सफल रहे
  const v = await vault.syncSessionToVault(s)
  if (v.synced) {
    s.history.push({ action: 'ADDED_TO_VAULT', by: 'system', note: `${v.synced} वीडियो दस्तावेज़ केंद्र में जुड़े` })
    await s.save().catch(() => {})
  }

  publicAudit(req, s, 'VKYC_SUBMITTED',
    `${s.customerName || 'ग्राहक'} ने Video KYC जमा की (${s.witnesses.length} गवाह) — अब जाँच बाकी`,
    { witnesses: s.witnesses.length })

  res.json({ success: true, session: publicView(s), message: 'Video KYC जमा हो गई' })
}))

// ═══════════════════════════════════════════════════════════════
// ███  ADMIN (login ज़रूरी)  ███
// ═══════════════════════════════════════════════════════════════
// ऊपर से मेल न खाया कोई भी /public रास्ता — 404 (कभी 401 नहीं)
router.all('/public/*', (req, res) => {
  res.status(404).json({ success: false, code: 'VKYC_NOT_FOUND', error: 'यह link सही नहीं है' })
})

router.use(authenticate)

async function loadApplication(req, appId) {
  if (!isObjectId(appId)) throw new AppError('गलत ID format', 400, 'INVALID_ID')
  const App = Application()
  if (!App) throw new AppError('Application model उपलब्ध नहीं', 500, 'NO_MODEL')
  const app = await App.findById(appId).lean()
  if (!app) throw new AppError('आवेदन नहीं मिला', 404, 'NOT_FOUND')
  if (!canAccessRecord(req, app)) throw new AppError('यह आवेदन आपका नहीं है', 403, 'FORBIDDEN')
  return app
}

async function loadSession(req, id) {
  if (!isObjectId(id)) throw new AppError('गलत ID format', 400, 'INVALID_ID')
  const s = await VideoKyc.findById(id)
  if (!s) throw new AppError('Video KYC नहीं मिली', 404, 'NOT_FOUND')
  await loadApplication(req, s.applicationRef)   // access जाँच
  return s
}

// ── POST /api/video-kyc/applications/:appId/link ──────────────
router.post('/applications/:appId/link',
  requirePermission('kyc:create', 'applications:create', 'applications:edit'),
  asyncHandler(async (req, res) => {
    const app = await loadApplication(req, req.params.appId)
    if (!app.fullName || !app.vehicleModel) {
      throw new AppError('पहले ग्राहक का नाम और वाहन भरकर Save करें', 400, 'VKYC_APP_INCOMPLETE')
    }
    const mobile = digits10(app.mobile)

    const hours = Math.min(168, Math.max(1, parseInt(req.body?.expiryHours || '48', 10) || 48))
    const minWitnesses = Math.min(MAX_WITNESSES, Math.max(0,
      Number.isInteger(req.body?.minWitnesses) ? req.body.minWitnesses : DEFAULT_MIN_WITNESSES))

    // पुराने अधूरे link रद्द (जमा हो चुके link सुरक्षित रहते हैं)
    const active = await VideoKyc.find({ applicationRef: app._id, locked: false, status: { $in: ['pending', 'in_progress'] } })
    for (const old of active) {
      old.status = 'revoked'
      old.revokedReason = 'नया link बनाया गया'
      old.history.push({ action: 'REVOKED', by: req.auth.name, note: 'नया link बनाया गया' })
      await cleanupUnsubmittedFiles(old, 'नया link बनाया गया').catch(() => {})
      await old.save()
    }

    const token = crypto.randomBytes(24).toString('base64url')   // 32 अक्षर, अनुमान असंभव
    const s = await VideoKyc.create({
      applicationRef: app._id,
      applicationNo: app.applicationId || '',
      customerName: app.fullName || '',
      customerMobile: mobile,
      branchId: app.branchId || req.auth.branchId || 'MAIN',
      tokenHash: sha256(token),
      tokenHint: token.slice(-4),
      expiresAt: new Date(Date.now() + hours * 3600 * 1000),
      statement: buildStatement(app),
      minWitnesses,
      maxWitnesses: MAX_WITNESSES,
      createdBy: req.auth.username,
      createdByName: req.auth.name,
      createdByUserId: req.auth.id,
      history: [{ action: 'LINK_CREATED', by: req.auth.name, note: `${hours} घंटे के लिए मान्य`, ip: clientIp(req) }]
    })

    const link = `${PORTAL_URL}/vkyc/${token}`
    const company = process.env.COMPANY_NAME || 'Vishesh Finance Pvt Ltd'
    const waText =
      `नमस्ते ${app.fullName} जी,\n\n` +
      `आपके वाहन ${app.vehicleModel} के फाइनेंस की Video KYC के लिए यह link खोलें:\n${link}\n\n` +
      `• कोई app install नहीं करना है — सीधे browser में खुलेगा\n` +
      `• कैमरा और माइक की अनुमति दें\n` +
      `• आपके साथ एक गवाह भी होना चाहिए\n` +
      `• यह link ${hours} घंटे तक चलेगा\n\n${company}`

    let smsSent = false
    if (req.body?.sendSms !== false && mobile && messenger?.smsReady?.()) {
      try {
        const r = await messenger.sendSMS({
          mobile,
          message: `नमस्ते ${app.fullName} जी, अपनी Video KYC यहाँ पूरी करें: ${link} (${hours} घंटे मान्य) - ${process.env.COMPANY_SHORT || 'VP Honda Finance'}`
        })
        smsSent = !!r?.sent
      } catch (e) { console.error('[VKYC] SMS असफल:', e.message) }
    }

    await audit(req, {
      action: 'VKYC_LINK_CREATED', category: 'kyc',
      description: `${req.auth.name} ने Video KYC link बनाया — ${app.applicationId || ''} ${app.fullName || ''}`,
      entityType: 'Application', entityId: app._id,
      entityLabel: `${app.applicationId || ''} — ${app.fullName || ''}`,
      metadata: { videoKycId: String(s._id), expiryHours: hours, revokedOld: active.length, smsSent, mobile: maskMobile(mobile) }
    })

    res.status(201).json({
      success: true,
      link,
      // मोबाइल न हो/गलत हो तो भी WhatsApp खुले (नंबर खुद चुनें)
      whatsappLink: (mobile && wa?.link && wa.link(mobile, waText)) || `https://wa.me/?text=${encodeURIComponent(waText)}`,
      messageText: waText,
      smsSent,
      expiresAt: s.expiresAt,
      revokedOld: active.length,
      session: adminView(s),
      storageReady: storage.ready()
    })
  })
)

// ── GET /api/video-kyc/applications/:appId ────────────────────
router.get('/applications/:appId',
  requirePermission('kyc:view', 'applications:view'),
  asyncHandler(async (req, res) => {
    const app = await loadApplication(req, req.params.appId)
    const list = await VideoKyc.find({ applicationRef: app._id }).sort({ createdAt: -1 }).limit(20)

    // समय निकल चुके अधूरे session को 'expired' दिखाओ
    for (const s of list) {
      if (s.isExpired() && ['pending', 'in_progress'].includes(s.status)) {
        s.status = 'expired'
        s.history.push({ action: 'EXPIRED', by: 'system', note: 'समय सीमा समाप्त' })
        await cleanupUnsubmittedFiles(s, 'link की समय सीमा समाप्त').catch(() => {})
        await s.save().catch(() => {})
      }
    }

    // पहले जमा हुई KYC जो अभी Vault में नहीं जुड़ी — अब जोड़ दो
    for (const s of list) {
      if (s.locked && !s.vaultSyncedAt) {
        const v = await vault.syncSessionToVault(s)
        if (v.synced) {
          s.history.push({ action: 'ADDED_TO_VAULT', by: 'system', note: `${v.synced} वीडियो दस्तावेज़ केंद्र में जुड़े` })
          await s.save().catch(() => {})
        }
      }
    }

    res.json({
      success: true,
      sessions: list.map(adminView),
      storageReady: storage.ready()
    })
  })
)

// ── PATCH /api/video-kyc/sessions/:id/review ──────────────────
// status: 'verified' | 'rejected' (वैकल्पिक) + remarks
router.patch('/sessions/:id/review',
  requirePermission('kyc:verify', 'documents:verify', 'applications:approve'),
  asyncHandler(async (req, res) => {
    const s = await loadSession(req, req.params.id)
    const { status, remarks } = req.body || {}
    const note = String(remarks || '').trim().slice(0, 1000)
    const before = s.status

    if (status !== undefined && status !== null && status !== '') {
      if (!['verified', 'rejected'].includes(status)) throw new AppError('गलत status', 400, 'VKYC_BAD_STATUS')
      if (!s.locked) throw new AppError('ग्राहक ने अभी Video KYC जमा नहीं की है', 400, 'VKYC_NOT_SUBMITTED')
      if (status === 'rejected' && !note) throw new AppError('Reject करने का कारण (Remarks) लिखना ज़रूरी है', 400, 'VKYC_REASON_REQUIRED')
      s.status = status
      s.reviewedBy = req.auth.username
      s.reviewedByName = req.auth.name
      s.reviewedAt = new Date()
    } else if (!note) {
      throw new AppError('Remarks लिखें', 400, 'VKYC_REMARKS_REQUIRED')
    }

    if (note) s.adminRemarks = note
    s.history.push({
      action: status === 'verified' ? 'VERIFIED' : status === 'rejected' ? 'REJECTED' : 'REMARKS',
      by: req.auth.name, note, ip: clientIp(req)
    })
    // दस्तावेज़ केंद्र (Vault) में भी वही status / remarks
    if (s.locked) await vault.syncSessionToVault(s)
    await s.save()

    await audit(req, {
      action: status === 'verified' ? 'VKYC_VERIFIED' : status === 'rejected' ? 'VKYC_REJECTED' : 'VKYC_REMARKS',
      category: 'kyc',
      severity: status ? 'warning' : 'info',
      description: status === 'verified' ? `${req.auth.name} ने Video KYC सत्यापित की — ${s.applicationNo} ${s.customerName}`
        : status === 'rejected' ? `${req.auth.name} ने Video KYC अस्वीकार की — ${s.applicationNo} ${s.customerName}`
        : `${req.auth.name} ने Video KYC पर टिप्पणी लिखी — ${s.applicationNo}`,
      entityType: 'Application', entityId: s.applicationRef,
      entityLabel: `${s.applicationNo} — ${s.customerName}`,
      changes: status ? { videoKycStatus: { from: before, to: status } } : null,
      metadata: { videoKycId: String(s._id), remarks: note }
    })

    res.json({ success: true, session: adminView(s) })
  })
)

// ── GET /api/video-kyc/sessions/:id/recordings/:recId/download ─
// हर बार ताज़ा (1 घंटे वाला) download link + audit में दर्ज कि किसने download किया
router.get('/sessions/:id/recordings/:recId/download',
  requirePermission('kyc:view', 'applications:view'),
  asyncHandler(async (req, res) => {
    const s = await loadSession(req, req.params.id)
    const rec = isObjectId(req.params.recId) ? s.recordings.id(req.params.recId) : null
    if (!rec) throw new AppError('वीडियो नहीं मिला', 404, 'NOT_FOUND')
    if (rec.fileDeleted) throw new AppError('यह पुराना वीडियो जगह बचाने के लिए हटाया जा चुका है', 410, 'VKYC_FILE_DELETED')

    const { downloadUrl, playUrl } = storage.urlsFor(rec)
    if (!downloadUrl) throw new AppError('Download link नहीं बन सका — Cloudinary configure जाँचें', 503, 'VKYC_STORAGE_OFF')

    await audit(req, {
      action: 'VKYC_DOWNLOADED', category: 'kyc',
      description: `${req.auth.name} ने Video KYC वीडियो download किया — ${s.applicationNo} (${rec.role === 'witness' ? 'गवाह ' + rec.personName : 'ग्राहक'})`,
      entityType: 'Application', entityId: s.applicationRef,
      entityLabel: `${s.applicationNo} — ${s.customerName}`,
      metadata: { videoKycId: String(s._id), recordingId: String(rec._id), version: rec.version }
    })

    res.json({ success: true, downloadUrl, playUrl })
  })
)

// ── POST /api/video-kyc/sessions/:id/revoke ───────────────────
router.post('/sessions/:id/revoke',
  requirePermission('kyc:create', 'applications:create', 'applications:edit'),
  asyncHandler(async (req, res) => {
    const s = await loadSession(req, req.params.id)
    if (s.locked) throw new AppError('जमा हो चुकी Video KYC रद्द नहीं होती — उसे Reject करें', 400, 'VKYC_LOCKED')
    if (s.status === 'revoked') return res.json({ success: true, session: adminView(s) })

    const reason = String(req.body?.reason || 'Staff ने रद्द किया').slice(0, 300)
    s.status = 'revoked'
    s.revokedReason = reason
    s.history.push({ action: 'REVOKED', by: req.auth.name, note: reason, ip: clientIp(req) })
    await cleanupUnsubmittedFiles(s, 'link रद्द किया गया').catch(() => {})
    await s.save()

    await audit(req, {
      action: 'VKYC_LINK_REVOKED', category: 'kyc',
      description: `${req.auth.name} ने Video KYC link रद्द किया — ${s.applicationNo}`,
      entityType: 'Application', entityId: s.applicationRef,
      entityLabel: `${s.applicationNo} — ${s.customerName}`,
      metadata: { videoKycId: String(s._id), reason }
    })

    res.json({ success: true, session: adminView(s) })
  })
)

module.exports = router
