// models/Attendance.js — Staff attendance with GPS location verification
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  staffId:        { type: String, required: true, index: true },
  staffName:      { type: String, default: '' },
  date:           { type: String, required: true },           // YYYY-MM-DD
  checkInTime:    { type: String, default: null },            // HH:MM:SS
  checkOutTime:   { type: String, default: null },
  status:         { type: String, default: 'Present', enum: ['Present', 'Absent', 'Leave', 'Half Day'] },

  // ⭐ GPS location tracking
  checkInLat:     { type: Number, default: null },
  checkInLng:     { type: Number, default: null },
  checkInDistance:{ type: Number, default: null },            // meters from shop
  checkInValid:   { type: Boolean, default: false },          // within shop radius?

  checkOutLat:    { type: Number, default: null },
  checkOutLng:    { type: Number, default: null },
  checkOutDistance:{ type: Number, default: null },
  checkOutValid:  { type: Boolean, default: false },

  // Work calculation
  hoursWorked:    { type: Number, default: 0 },
  isLate:         { type: Boolean, default: false },

  notes:          { type: String, default: '' },
}, { timestamps: true });

attendanceSchema.index({ staffId: 1, date: -1 });
attendanceSchema.index({ date: -1 });

module.exports = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);