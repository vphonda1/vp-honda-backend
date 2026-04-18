const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ════════════════════════════════════════════
// CORS – पूरी तरह खुला (अभी टेस्ट के लिए)
// ════════════════════════════════════════════
app.use(cors({
  origin: '*', // सभी origins को allow (बाद में आप सिर्फ अपने frontend URL से बदल सकते हैं)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════
// MONGODB CONNECTION
// ════════════════════════════════════════════
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!mongoUri) {
  console.error('❌ MongoDB URI not defined');
  process.exit(1);
}

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
})
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// ════════════════════════════════════════════
// ROUTES (सिर्फ JSON API)
// ════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'VP Honda API' });
});

app.use('/api/customers', require('./routes/customers'));
app.use('/api/parts', require('./routes/parts'));
app.use('/api/invoices', require('./routes/invoices'));  // ← यह फाइल नीचे दी है
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/serviceCustomers', require('./routes/serviceCustomers'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/oldbikes', require('./routes/oldbikes'));
app.use('/api/quotations', require('./routes/quotations'));
app.use('/api', require('./routes/dataImport'));

// ════════════════════════════════════════════
// ERROR HANDLING
// ════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ error: err.message });
});

// ════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});