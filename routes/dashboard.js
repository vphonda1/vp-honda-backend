const router = require('express').Router();
const Customer = require('../models/Customer');
const Part = require('../models/Part');
const Invoice = require('../models/Invoice');

// GET /api/dashboard — Main dashboard data
router.get('/', async (req, res) => {
  try {
    const { year, month, day } = req.query;

    // Build date filter for customers
    let dateFilter = {};
    if (year || month || day) {
      // Filter customers by invoiceDate or purchaseDate
      const customers = await Customer.find();
      const filtered = customers.filter(c => {
        const d = c.invoiceDate || c.purchaseDate;
        if (!d) return false;
        try {
          const dt = new Date(d);
          if (isNaN(dt.getTime())) return false;
          if (year && dt.getFullYear() !== parseInt(year)) return false;
          if (month && (dt.getMonth() + 1) !== parseInt(month)) return false;
          if (day && dt.getDate() !== parseInt(day)) return false;
          return true;
        } catch { return false; }
      });

      return res.json(buildDashboard(filtered, await Part.find(), await Invoice.find()));
    }

    const customers = await Customer.find();
    const parts = await Part.find();
    const invoices = await Invoice.find();
    res.json(buildDashboard(customers, parts, invoices));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/dashboard/daily — Daily sales for a month
router.get('/daily', async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.json({ dailyData: [] });

    const customers = await Customer.find();
    const dailyMap = {};

    customers.forEach(c => {
      const d = c.invoiceDate || c.purchaseDate;
      if (!d) return;
      try {
        const dt = new Date(d);
        if (dt.getFullYear() === parseInt(year) && (dt.getMonth() + 1) === parseInt(month)) {
          const day = dt.getDate();
          if (!dailyMap[day]) dailyMap[day] = { day, label: `Day ${day}`, sales: 0, amount: 0 };
          dailyMap[day].sales++;
          dailyMap[day].amount += c.onRoad || c.exShowroom || 0;
        }
      } catch {}
    });

    res.json({ dailyData: Object.values(dailyMap).sort((a, b) => a.day - b.day) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: Build dashboard from data
function buildDashboard(customers, parts, invoices) {
  const totalCustomers = customers.length;

  // Vehicle Models
  const modelMap = {};
  customers.forEach(c => {
    const m = (c.vehicleModel || '').trim();
    if (m) modelMap[m] = (modelMap[m] || 0) + 1;
  });
  const vehicleModels = Object.entries(modelMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, short: name.length > 15 ? name.slice(0, 15) : name, value }));

  // Color Data
  const colorMap = {};
  customers.forEach(c => {
    const col = (c.vehicleColor || '').trim();
    if (col) colorMap[col] = (colorMap[col] || 0) + 1;
  });
  const colorData = Object.entries(colorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // District Data
  const distMap = {};
  customers.forEach(c => {
    const d = (c.district || c.address || '').trim();
    if (d) distMap[d] = (distMap[d] || 0) + 1;
  });
  const districtData = Object.entries(distMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, value]) => ({ name, value }));

  // Financer Data
  const finMap = {};
  customers.forEach(c => {
    const f = (c.financeCompany || c.paymentType || '').trim();
    if (f) finMap[f] = (finMap[f] || 0) + 1;
  });
  const financerData = Object.entries(finMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // Monthly Sales
  const monthMap = {};
  customers.forEach(c => {
    const d = c.invoiceDate || c.purchaseDate;
    if (!d) return;
    try {
      const dt = new Date(d);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = `${months[dt.getMonth() + 1]}'${String(dt.getFullYear()).slice(2)}`;
      if (!monthMap[key]) monthMap[key] = { key, label, sales: 0 };
      monthMap[key].sales++;
    } catch {}
  });
  const monthlySales = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));

  // Parts Stats
  const partsStats = {
    count: parts.length,
    stockValue: parts.reduce((s, p) => s + (p.unitPrice || 0) * (p.stock || p.quantity || 0), 0),
  };

  // Service Stats (from invoices)
  const serviceInvoices = invoices.filter(i => i.invoiceType === 'service');
  const serviceStats = {
    total: serviceInvoices.length,
    totalAmount: serviceInvoices.reduce((s, i) => s + (i.totals?.totalAmount || i.amount || 0), 0),
  };

  // Insurance Stats
  const insCustomers = customers.filter(c => c.insuranceAmount > 0);
  const insuranceStats = {
    total: insCustomers.length,
    totalCollected: insCustomers.reduce((s, c) => s + (c.insuranceAmount || 0), 0),
  };

  return {
    totalCustomers,
    vehicleModels,
    colorData,
    districtData,
    financerData,
    monthlySales,
    partsStats,
    serviceStats,
    insuranceStats,
  };
}

module.exports = router;
