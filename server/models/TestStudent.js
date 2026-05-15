const mongoose = require('mongoose');

/**
 * TestStudent (was `students` table) — one row per (student, test).
 * Holds the one-time password generated for that test + the student's score
 * and a submission status flag (0 = not submitted, 1 = submitted/aborted).
 */
const testStudentSchema = new mongoose.Schema(
  {
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentRecord', required: true },
    password: { type: String, required: true },
    score: { type: Number, default: 0 },
    submitted: { type: Boolean, default: false },
    violations: { type: Number, default: 0 },
    autoSubmitted: { type: Boolean, default: false },
    deviceInfo: {
      userAgent: { type: String },
      platform: { type: String },
      language: { type: String },
      screenResolution: { type: String },
      timezone: { type: String }
    },
    active: { type: Boolean, default: false },
    started: { type: Boolean, default: false },
    completedOnce: { type: Boolean, default: false }
  },
  { timestamps: true }
);

testStudentSchema.index({ test: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('TestStudent', testStudentSchema);
