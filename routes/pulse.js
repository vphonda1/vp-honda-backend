// ════════════════════════════════════════════════════════════════════════════
// routes/pulse.js — "कुछ नया है या नहीं" — एक ही हल्की request
// ════════════════════════════════════════════════════════════════════════════
// क्यों:
//   Dashboard हर बार 11 अलग-अलग endpoints से पूरा डेटा माँगता था — customers,
//   invoices, parts, staff, salaries, attendance, service-data, oldbikes, pnl…
//   हर 30 सेकंड. ज़्यादातर बार कुछ बदला ही नहीं होता, फिर भी पूरा डेटा आता था.
//
//   यह endpoint सिर्फ़ **गिनती और आख़िरी बदलाव का समय** भेजता है — कुछ सौ bytes.
//   Frontend पहले यही पूछता है; कुछ बदला हो तभी पूरा डेटा माँगता है.
//
// फ़ायदा: request की संख्या और आकार दोनों घटते हैं. (Render का कोटा जागे रहने
// के समय से कटता है, पर हल्की request server को जल्दी फ़ारिग करती है और
// MongoDB का मुफ़्त कोटा भी बचता है.)
// ════════════════════════════════════════════════════════════════════════════
const router   = require('express').Router();
const mongoose = require('mongoose');

// किस collection की गिनती चाहिए
const WATCH = [
  'servicedatas', 'invoices', 'parts', 'staffs', 'salarypayments',
  'attendances', 'oldbikes', 'visitors', 'reminders', 'pnlmonths',
  'messages', 'vpdocuments', 'pickupdrops', 'appointments',
];

let cache = { at: 0, data: null };
const CACHE_MS = 20000;   // 20 सेकंड — कई tab एक साथ पूछें तो DB पर बोझ न पड़े

router.get('/', async (req, res) => {
  try {
    if (cache.data && Date.now() - cache.at < CACHE_MS) {
      return res.json({ ...cache.data, cached: true });
    }

    const db = mongoose.connection.db;
    const counts = {};
    await Promise.all(WATCH.map(async (name) => {
      try { counts[name] = await db.collection(name).estimatedDocumentCount(); }
      catch { counts[name] = 0; }
    }));

    // सबसे नया बदलाव कब हुआ — इसी से पता चलता है कि कुछ नया है या नहीं
    let latest = null;
    for (const name of ['servicedatas', 'invoices', 'reminders', 'visitors']) {
      try {
        const d = await db.collection(name).find({}, { projection: { updatedAt: 1, createdAt: 1 } })
          .sort({ updatedAt: -1 }).limit(1).toArray();
        const t = d[0]?.updatedAt || d[0]?.createdAt;
        if (t && (!latest || new Date(t) > new Date(latest))) latest = t;
      } catch {}
    }

    // एक छोटी सी "मुहर" — यह बदले तभी पूरा डेटा माँगें
    const stamp = Object.values(counts).join('.') + '|' + (latest ? new Date(latest).getTime() : 0);

    const data = { ok: true, stamp, counts, latestChange: latest, at: new Date().toISOString() };
    cache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
