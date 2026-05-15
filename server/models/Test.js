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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Test', testSchema);
