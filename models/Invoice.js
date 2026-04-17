const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  invoiceType: { type: String, enum: ['vehicle', 'service'], default: 'service' }, // ✅ NEW
  
  // Customer Info
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  customerId: { type: String, default: '' },
  
  // Vehicle Info
  vehicle: { type: String, default: '' },
  regNo: { type: String, default: '', index: true },
  frameNo: { type: String, default: '' },
  engineNo: { type: String, default: '' },
  
  // Invoice Details
  invoiceDate: { type: String, default: '' },
  paymentMode: { type: String, default: 'CASH' },
  
  // Service Info (for service invoices)
  serviceKm: { type: Number, default: 0 },
  serviceType: { type: String, default: '' },
  serviceNumber: { type: Number, default: null }, // ✅ Changed from String to Number
  
  // Parts/Items - ✅ IMPROVED STRUCTURE
  items: [{
    partNo: { type: String, default: '' },           // ✅ NEW
    hsn: { type: String, default: '' },
    description: { type: String, default: '' },
    qty: { type: Number, default: 1 },               // ✅ NEW
    mrp: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },    // ✅ NEW
    gstRate: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },              // ✅ NEW
    cgst: { type: Number, default: 0 },              // ✅ NEW
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  }],
  
  // Totals - ✅ IMPROVED
  subtotal: { type: Number, default: 0 },            // ✅ NEW
  totalGST: { type: Number, default: 0 },            // ✅ NEW
  grandTotal: { type: Number, default: 0 },          // ✅ NEW
  
  // Old totals (for backwards compatibility)
  totals: {
    subtotal: { type: Number, default: 0 },
    gstRate: { type: Number, default: 18 },
    gstAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
  },
  
  // Metadata
  importedFrom: { type: String, default: '' },
  importedAt: { type: String, default: '' },
  status: { type: String, default: 'Active' },
  source: { type: String, default: '' },
  
}, { 
  timestamps: true, 
  strict: false 
});

// ✅ Index for faster queries
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ regNo: 1 });
invoiceSchema.index({ invoiceType: 1 });
invoiceSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);