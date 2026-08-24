const mongoose = require('mongoose');

// गाड़ी लेने/पहुँचाने का record. पहले सिर्फ़ localStorage (`vp_pickup_drops`) में था.
const pickupDropSchema = new mongoose.Schema({
  localId:        { type: String, index: true },
  customerName:   { type: String, default: '' },
  customerPhone:  { type: String, default: '' },
  vehicleRegNo:   { type: String, default: '' },
  vehicleModel:   { type: String, default: '' },
  type:           { type: String, default: 'pickup' },   // pickup | drop
  pickupAddress:  { type: String, default: '' },
  notes:          { type: String, default: '' },
  handledBy:      { type: String, default: '' },
  status:         { type: String, default: 'scheduled', index: true }, // scheduled | in-transit | completed | cancelled

  scheduled:        { type: String, default: () => new Date().toISOString() },
  transitStartTime: { type: String, default: null },
  completedTime:    { type: String, default: null },
  pickupLat: Number, pickupLng: Number,
  dropLat:   Number, dropLng:   Number,
  transitStartLat: Number, transitStartLng: Number,
}, { timestamps: true, strict: false });

module.exports = mongoose.models.PickupDrop || mongoose.model('PickupDrop', pickupDropSchema);
