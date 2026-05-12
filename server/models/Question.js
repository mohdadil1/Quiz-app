const mongoose = require('mongoose');

/**
 * Question - merges the old Questions + score tables.
 * correctCount/wrongCount live on the question itself (scoped per test
 * because a Question is only ever mapped to one Test in this app).
 */
const questionSchema = new mongoose.Schema(
  {
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
    title: { type: String, required: true },
    optionA: { type: String, required: true },
    optionB: { type: String, required: true },
    optionC: { type: String, required: true },
    optionD: { type: String, required: true },
    correctAns: {
      type: String,
      required: true,
      enum: ['a', 'b', 'c', 'd'],
      lowercase: true
    },
    score: { type: Number, required: true, default: 1 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Question', questionSchema);
