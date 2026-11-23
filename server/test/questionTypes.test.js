// Run with: npm test   (uses Node's built-in test runner, no database needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLetters,
  parseNumber,
  buildQuestionFields,
  gradeAnswer,
  describeAnswer,
  describeCorrect
} = require('../utils/questionTypes');

const options = { optionA: 'Paris', optionB: 'Berlin', optionC: 'Rome', optionD: 'Oslo' };

test('normalizeLetters accepts many spellings and sorts', () => {
  assert.equal(normalizeLetters('C, a'), 'ac');
  assert.equal(normalizeLetters(['d', 'b']), 'bd');
  assert.equal(normalizeLetters('aa'), 'a');
  assert.equal(normalizeLetters('e'), null);
  assert.equal(normalizeLetters(''), null);
});

test('parseNumber is strict', () => {
  assert.equal(parseNumber('9.81'), 9.81);
  assert.equal(parseNumber(' -2 '), -2);
  assert.equal(parseNumber('1,000'), 1000);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('1e3'), 1000);
  assert.equal(parseNumber('12abc'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('Infinity'), null);
});

test('MCQ: exactly one correct option, all four options required', () => {
  assert.equal(buildQuestionFields({ ...options, correctAns: 'B' }).fields.correctAns, 'b');
  assert.equal(buildQuestionFields({ ...options, correctAns: 'B' }).fields.type, 'MCQ');
  assert.ok(buildQuestionFields({ ...options, correctAns: 'ab' }).error);
  assert.ok(buildQuestionFields({ ...options, optionD: ' ', correctAns: 'a' }).error);
});

test('MULTI stores sorted letters and grades all-or-nothing', () => {
  const { fields } = buildQuestionFields({ ...options, type: 'MULTI', correctAns: 'c,a' });
  assert.equal(fields.correctAns, 'ac');
  assert.deepEqual(gradeAnswer(fields, ['c', 'a']), { value: 'ac', correct: true });
  assert.equal(gradeAnswer(fields, 'a').correct, false);
  assert.equal(gradeAnswer(fields, 'abc').correct, false);
  assert.ok(gradeAnswer(fields, '').error);
});

test('TRUE_FALSE fills in the options and only accepts A/B', () => {
  const { fields } = buildQuestionFields({ type: 'TRUE_FALSE', correctAns: 'false' });
  assert.equal(fields.optionA, 'True');
  assert.equal(fields.correctAns, 'b');
  assert.equal(gradeAnswer(fields, 'b').correct, true);
  assert.equal(gradeAnswer(fields, 'a').correct, false);
  assert.ok(gradeAnswer(fields, 'c').error);
  assert.ok(gradeAnswer(fields, 'ab').error);
  assert.ok(buildQuestionFields({ type: 'TRUE_FALSE', correctAns: 'maybe' }).error);
});

test('NUMERIC grades within the tolerance', () => {
  const { fields } = buildQuestionFields({ type: 'NUMERIC', correctNumber: '9.81', tolerance: '0.05' });
  assert.equal(gradeAnswer(fields, '9.8').correct, true);
  assert.equal(gradeAnswer(fields, '9.86').correct, true);
  assert.equal(gradeAnswer(fields, '9.9').correct, false);
  assert.ok(gradeAnswer(fields, 'nine').error);
  assert.equal(describeCorrect(fields), '9.81 (± 0.05)');

  const exact = buildQuestionFields({ type: 'NUMERIC', correctAns: '0.3' }).fields;
  assert.equal(gradeAnswer(exact, String(0.1 + 0.2)).correct, true); // float noise is forgiven
  assert.ok(buildQuestionFields({ type: 'NUMERIC', correctNumber: 'x' }).error);
  assert.ok(buildQuestionFields({ type: 'NUMERIC', correctNumber: 1, tolerance: -1 }).error);
});

test('old questions without a type behave as MCQ', () => {
  const legacy = { ...options, correctAns: 'c' };
  assert.equal(gradeAnswer(legacy, 'C').correct, true);
  assert.ok(gradeAnswer(legacy, 'ac').error);
});

test('describeAnswer reads well for each type', () => {
  const multi = { ...options, type: 'MULTI', correctAns: 'ac' };
  assert.equal(describeAnswer(multi, 'ac'), 'A. Paris, C. Rome');
  assert.equal(describeAnswer({ type: 'TRUE_FALSE' }, 'a'), 'True');
  assert.equal(describeAnswer({ type: 'NUMERIC' }, '42'), '42');
  assert.equal(describeAnswer(multi, null), '');
});
