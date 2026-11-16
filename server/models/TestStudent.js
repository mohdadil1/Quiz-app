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
    violationTypes: { type: [String], default: [] },
    autoSubmitted: { type: Boolean, default: false },
    deviceInfo: {
      userAgent: { type: String },
      platform: { type: String },
      language: { type: String },
      screenResolution: { type: String },
      timezone: { type: String }
    },
    active: { type: Boolean, default: false },
    // One-device lock: random id the student's browser keeps in localStorage. Once the
    // test has started, only this device may log in again (teacher can unlock it).
    deviceId: { type: String, default: null },
    // Changes on every login; tokens carrying an older value are rejected, so only
    // the most recent login can talk to the quiz API.
    sessionToken: { type: String, default: null },
    started: { type: Boolean, default: false },
    // When the student pressed Start — the total-time deadline is counted from here
    startedAt: { type: Date, default: null },
    completedOnce: { type: Boolean, default: false }
  },
  { timestamps: true }
);

testStudentSchema.index({ test: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('TestStudent', testStudentSchema);
