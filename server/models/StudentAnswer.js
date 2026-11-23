const mongoose = require('mongoose');

/**
 * StudentAnswer — tracks each answer a student submits to a question.
 * Used for review and results display.
 */
const studentAnswerSchema = new mongoose.Schema(
  {
    testStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'TestStudent', required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    // 'b' for single choice / true-false, 'ac' for multiple-correct, the typed number for numeric
    selectedOption: { type: String, required: true, maxlength: 50 },
    isCorrect: { type: Boolean, required: true }
  },
  { timestamps: true }
);

studentAnswerSchema.index({ testStudent: 1, question: 1 }, { unique: true });

module.exports = mongoose.model('StudentAnswer', studentAnswerSchema);
