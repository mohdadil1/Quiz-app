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
    shuffle: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Test', testSchema);
