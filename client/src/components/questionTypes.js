// Question types — mirrors server/utils/questionTypes.js
export const QUESTION_TYPES = [
  { value: 'MCQ', label: 'Single choice (one correct option)' },
  { value: 'MULTI', label: 'Multiple correct (select all that apply)' },
  { value: 'TRUE_FALSE', label: 'True / False' },
  { value: 'NUMERIC', label: 'Numeric answer (student types a number)' }
];

export const TYPE_SHORT = { MCQ: 'Single', MULTI: 'Multiple', TRUE_FALSE: 'True/False', NUMERIC: 'Numeric' };

export const typeOf = (q) => (TYPE_SHORT[q?.type] ? q.type : 'MCQ');

// Correct answer as shown to the teacher: 'B', 'A, C', 'True', '9.81 (± 0.05)'
export function correctLabel(q) {
  const type = typeOf(q);
  if (type === 'NUMERIC') {
    const tol = Number(q.tolerance) || 0;
    return tol > 0 ? `${q.correctNumber} (± ${tol})` : String(q.correctNumber ?? '');
  }
  if (type === 'TRUE_FALSE') return q.correctAns === 'b' ? 'False' : 'True';
  return String(q.correctAns || '').toUpperCase().split('').join(', ');
}

// Blank form values for a new question
export const emptyQuestion = {
  type: 'MCQ',
  title: '',
  optionA: '',
  optionB: '',
  optionC: '',
  optionD: '',
  correctAns: 'a',
  correctNumber: '',
  tolerance: 0,
  score: 1,
  timeLimit: 1
};

// Check the form before sending; returns an error message or ''
export function validateQuestion(q) {
  if (!String(q.title || '').replace(/<[^>]*>/g, '').trim()) return 'Question title is required';
  const type = typeOf(q);
  if (type === 'MCQ' || type === 'MULTI') {
    if (!['optionA', 'optionB', 'optionC', 'optionD'].every((k) => String(q[k] ?? '').trim())) {
      return 'All four options are required';
    }
    if (!q.correctAns) return type === 'MULTI' ? 'Tick at least one correct option' : 'Choose the correct option';
  }
  if (type === 'NUMERIC') {
    if (String(q.correctNumber ?? '').trim() === '' || !Number.isFinite(Number(q.correctNumber))) {
      return 'Enter the correct number';
    }
    if (!(Number(q.tolerance) >= 0)) return 'Tolerance must be 0 or more';
  }
  return '';
}

// Body for POST/PUT /questions
export function questionPayload(q) {
  return {
    type: typeOf(q),
    title: q.title,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    correctAns: q.correctAns,
    correctNumber: q.correctNumber,
    tolerance: q.tolerance === '' ? 0 : q.tolerance,
    score: Number(q.score),
    timeLimit: Number(q.timeLimit)
  };
}
