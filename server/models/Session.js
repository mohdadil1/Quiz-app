const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    deviceInfo: {
      userAgent: { type: String },
      platform: { type: String },
      language: { type: String },
      screenResolution: { type: String },
      timezone: { type: String }
    },
    ipAddress: { type: String },
    lastActivity: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Auto-expire sessions after 7 days of inactivity
sessionSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('Session', sessionSchema);