const mongoose = require('mongoose');

/**
 * Question - merges the old Questions + score tables.
 * correctCount/wrongCount live on the question itself (scoped per test
 * because a Question is only ever mapped to one Test in this app).
 */
const questionSchema = new mongoose.Schema(
  {
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
    // May be empty when the question is a picture (see `image`)
    title: { type: String, default: '' },
    // MCQ | MULTI | TRUE_FALSE | NUMERIC — see utils/questionTypes.js. Old questions have no
    // type stored and are treated as MCQ.
    type: { type: String, enum: ['MCQ', 'MULTI', 'TRUE_FALSE', 'NUMERIC'], default: 'MCQ' },
    // Options are only used by MCQ / MULTI (all four) and TRUE_FALSE (A = True, B = False)
    optionA: { type: String, default: '' },
    optionB: { type: String, default: '' },
    optionC: { type: String, default: '' },
    optionD: { type: String, default: '' },
    // MCQ / TRUE_FALSE: one letter ('b'). MULTI: sorted letters ('ac'). NUMERIC: empty.
    correctAns: { type: String, default: '', lowercase: true, match: /^[a-d]{0,4}$/ },
    // NUMERIC only: the right answer and how far off an answer may be and still count
    correctNumber: { type: Number, default: null },
    // Optional pictures (keys of QuestionImage docs, served from /api/images/:key):
    // one for the question itself and one per option. An option may be picture-only.
    image: { type: String, default: '' },
    optionImages: {
      a: { type: String, default: '' },
      b: { type: String, default: '' },
      c: { type: String, default: '' },
      d: { type: String, default: '' }
    },
    tolerance: { type: Number, default: 0, min: 0 },
    score: { type: Number, required: true, default: 1 },
    timeLimit: { type: Number, required: true, default: 1, min: 0.25 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Question', questionSchema);
