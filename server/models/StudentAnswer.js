const mongoose = require('mongoose');

/**
 * StudentAnswer — tracks each answer a student submits to a question.
 * Used for review and results display.
 */
const studentAnswerSchema = new mongoose.Schema(
  {
    testStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'TestStudent', required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOption: { type: String, enum: ['a', 'b', 'c', 'd'], required: true },
    isCorrect: { type: Boolean, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentAnswer', studentAnswerSchema);
