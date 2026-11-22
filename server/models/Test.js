const mongoose = require('mongoose');

/**
 * Test (was `tests` table).
 * status is a string enum — replaces the old status lookup table.
 */
const testSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    name: { type: String, required: true },
    subject: { type: String, required: true },
    date: { type: Date, required: true },
    totalQuestions: { type: Number, required: true },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    status: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'COMPLETED'],
      default: 'PENDING'
    },
    mode: {
      type: String,
      enum: ['STANDARD', 'MOCK'],
      default: 'STANDARD'
    },
    webcamProctoring: { type: Boolean, default: true },
    // PER_QUESTION: each question has its own countdown. TOTAL: one countdown for the whole test.
    timingMode: { type: String, enum: ['PER_QUESTION', 'TOTAL'], default: 'PER_QUESTION' },
    totalTimeMinutes: { type: Number, min: 1, max: 600, default: 30 },
    // Give each student their own (stable) order of questions and options
    shuffle: { type: Boolean, default: true },
    // Optional schedule: the test opens (PENDING → RUNNING) at startAt and closes
    // (→ COMPLETED) at endAt. Each fires once; the teacher can still change the status
    // by hand afterwards. Editing a time re-arms it.
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    autoStarted: { type: Boolean, default: false },
    autoEnded: { type: Boolean, default: false }
  },
  { timestamps: true }
);

/**
 * Move the status along the schedule if a scheduled time has passed. There is no
 * background job on Vercel, so this runs whenever a test is read (teacher dashboard,
 * student login/dashboard, every quiz request). Returns true if the test changed
 * (it has already been saved).
 */
testSchema.methods.applySchedule = async function applySchedule(now = new Date()) {
  let changed = false;
  if (this.startAt && !this.autoStarted && this.startAt <= now) {
    this.autoStarted = true;
    if (this.status === 'PENDING') this.status = 'RUNNING';
    changed = true;
  }
  if (this.endAt && !this.autoEnded && this.endAt <= now) {
    this.autoEnded = true;
    this.status = 'COMPLETED';
    changed = true;
  }
  if (changed) await this.save();
  return changed;
};

// Run the schedule over a list of tests (e.g. everything on the teacher dashboard)
testSchema.statics.applyScheduleAll = async function applyScheduleAll(tests, now = new Date()) {
  await Promise.all(tests.map((t) => t.applySchedule(now)));
  return tests;
};

module.exports = mongoose.model('Test', testSchema);
