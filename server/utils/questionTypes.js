/**
 * Question types and how each one is validated, graded and shown.
 *
 *   MCQ         one correct option out of A–D            correctAns 'b'
 *   MULTI       one or more correct options out of A–D   correctAns 'ac' (sorted letters)
 *               all-or-nothing: the student must pick exactly the correct set
 *   TRUE_FALSE  option A = True, option B = False         correctAns 'a' or 'b'
 *   NUMERIC     student types a number                    correctNumber 9.81, tolerance 0.01
 *
 * A student's answer is stored in StudentAnswer.selectedOption as a string in the same
 * shape: 'b', 'ac', 'a', or the typed number ('9.8').
 */

const TYPES = ['MCQ', 'MULTI', 'TRUE_FALSE', 'NUMERIC'];
const LETTERS = ['a', 'b', 'c', 'd'];
const TYPE_LABELS = {
  MCQ: 'Single choice',
  MULTI: 'Multiple correct',
  TRUE_FALSE: 'True / False',
  NUMERIC: 'Numeric'
};

const typeOf = (q) => (TYPES.includes(q?.type) ? q.type : 'MCQ');
const hasText = (v) => v != null && String(v).trim() !== '';

// 'A, C' / 'ca' / ['c','a'] → 'ac' (null if anything isn't A–D or nothing was chosen)
function normalizeLetters(value) {
  const raw = Array.isArray(value) ? value.join('') : String(value ?? '');
  const letters = raw.toLowerCase().replace(/[\s,;/|&+]+/g, '').split('');
  if (!letters.length || letters.some((l) => !LETTERS.includes(l))) return null;
  return [...new Set(letters)].sort().join('');
}

function parseNumber(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/,/g, '');
  if (text === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate the type-specific fields of a question from a request body / spreadsheet row.
 * Returns { fields } ready to put on the Question, or { error }.
 */
function buildQuestionFields(body) {
  const type = body.type === undefined || body.type === '' ? 'MCQ' : String(body.type).toUpperCase();
  if (!TYPES.includes(type)) return { error: `type must be one of ${TYPES.join(', ')}` };

  if (type === 'TRUE_FALSE') {
    const raw = String(body.correctAns ?? '').trim().toLowerCase();
    const correctAns = ['a', 'true', 't'].includes(raw) ? 'a' : ['b', 'false', 'f'].includes(raw) ? 'b' : null;
    if (!correctAns) return { error: 'Correct answer must be True or False' };
    return {
      fields: { type, optionA: 'True', optionB: 'False', optionC: '', optionD: '', correctAns, correctNumber: null, tolerance: 0 }
    };
  }

  if (type === 'NUMERIC') {
    const correctNumber = parseNumber(body.correctNumber ?? body.correctAns);
    if (correctNumber === null) return { error: 'Correct answer must be a number' };
    const tolerance = hasText(body.tolerance) ? parseNumber(body.tolerance) : 0;
    if (tolerance === null || tolerance < 0) return { error: 'Tolerance must be 0 or a positive number' };
    return {
      fields: { type, optionA: '', optionB: '', optionC: '', optionD: '', correctAns: '', correctNumber, tolerance }
    };
  }

  // MCQ and MULTI: four options
  const { optionA, optionB, optionC, optionD } = body;
  if (![optionA, optionB, optionC, optionD].every(hasText)) return { error: 'All four options are required' };
  const correctAns = normalizeLetters(body.correctAns);
  if (!correctAns) return { error: 'Correct answer must be A, B, C or D' };
  if (type === 'MCQ' && correctAns.length !== 1) return { error: 'A single-choice question has exactly one correct option' };
  return {
    fields: {
      type,
      optionA: String(optionA),
      optionB: String(optionB),
      optionC: String(optionC),
      optionD: String(optionD),
      correctAns,
      correctNumber: null,
      tolerance: 0
    }
  };
}

/**
 * Check a student's answer. Returns { value, correct } with the value to store,
 * or { error } when the answer isn't valid for this question type.
 */
function gradeAnswer(question, answer) {
  const type = typeOf(question);
  if (type === 'NUMERIC') {
    const n = parseNumber(answer);
    if (n === null) return { error: 'Please enter a number' };
    const tolerance = Math.max(0, Number(question.tolerance) || 0);
    // A tiny epsilon so 0.1 + 0.2 style float noise never marks a right answer wrong
    const correct = Math.abs(n - Number(question.correctNumber)) <= tolerance + 1e-9;
    return { value: String(n), correct };
  }

  const value = normalizeLetters(answer);
  if (!value) return { error: 'Answer must be one or more of A, B, C, D' };
  const allowed = type === 'TRUE_FALSE' ? ['a', 'b'] : LETTERS;
  if (value.split('').some((l) => !allowed.includes(l))) return { error: 'Invalid option' };
  if (type !== 'MULTI' && value.length !== 1) return { error: 'Pick exactly one option' };
  return { value, correct: value === normalizeLetters(question.correctAns) };
}

function optionText(question, letter) {
  return question[`option${letter.toUpperCase()}`] ?? '';
}

// Human-readable version of an answer value ('ac' → 'A. Paris, C. Rome'), for result pages and exports
function describeAnswer(question, value) {
  if (value == null || value === '') return '';
  if (typeOf(question) === 'NUMERIC') return String(value);
  if (typeOf(question) === 'TRUE_FALSE') return value === 'a' ? 'True' : value === 'b' ? 'False' : String(value);
  return String(value)
    .split('')
    .map((l) => `${l.toUpperCase()}. ${optionText(question, l)}`)
    .join(', ');
}

function describeCorrect(question) {
  if (typeOf(question) === 'NUMERIC') {
    const tol = Number(question.tolerance) || 0;
    return tol > 0 ? `${question.correctNumber} (± ${tol})` : String(question.correctNumber);
  }
  return describeAnswer(question, question.correctAns);
}

// Option letters a student sees for this question type (before any shuffling)
function optionLetters(question) {
  const type = typeOf(question);
  if (type === 'NUMERIC') return [];
  if (type === 'TRUE_FALSE') return ['a', 'b'];
  return LETTERS;
}

module.exports = {
  TYPES,
  TYPE_LABELS,
  typeOf,
  normalizeLetters,
  parseNumber,
  buildQuestionFields,
  gradeAnswer,
  describeAnswer,
  describeCorrect,
  optionLetters
};
