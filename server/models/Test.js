const crypto = require('crypto');
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
    autoEnded: { type: Boolean, default: false },
    // 4-digit code shared by every student of this test: students log in with their USN
    // and this code. Only the teacher sees it. Kept as a string so leading zeros survive.
    accessCode: { type: String, default: null }
  },
  { timestamps: true }
);

// Teacher dashboard: a teacher's tests, newest first
testSchema.index({ teacher: 1, date: -1 });
// Every test has its own code: no two tests (open or finished) ever share one.
// Partial index, so old tests that have no code yet don't clash with each other.
testSchema.index(
  { accessCode: 1 },
  { unique: true, partialFilterExpression: { accessCode: { $type: 'string' } } }
);

const randomCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
const isCodeClash = (error) => error && error.code === 11000 && /accessCode/.test(error.message || '');

/**
 * Give this test a new 4-digit code that no other test uses, and save it. Picks a code
 * that is free, and if another test takes the same code at the same moment the unique
 * index refuses the save and a different code is tried.
 */
testSchema.methods.assignAccessCode = async function assignAccessCode() {
  const Test = this.constructor;
  const old = this.accessCode;
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomCode();
    if (code === old || await Test.exists({ accessCode: code })) continue;
    this.accessCode = code;
    try {
      await this.save();
      return code;
    } catch (error) {
      if (!isCodeClash(error)) throw error;
    }
  }
  // Almost every code is taken: walk through the free ones in order
  const used = new Set(await Test.distinct('accessCode', { accessCode: { $type: 'string' } }));
  for (let n = 0; n < 10000; n++) {
    const code = String(n).padStart(4, '0');
    if (used.has(code)) continue;
    this.accessCode = code;
    try {
      await this.save();
      return code;
    } catch (error) {
      if (!isCodeClash(error)) throw error;
    }
  }
  this.accessCode = old;
  throw new Error('All 10000 access codes are in use. Delete some old tests.');
};

// Tests created before access codes existed get one the first time a teacher opens them
testSchema.methods.ensureAccessCode = async function ensureAccessCode() {
  if (this.accessCode) return false;
  await this.assignAccessCode();
  return true;
};

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
