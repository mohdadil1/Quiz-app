const xlsx = require('xlsx');
const Question = require('../models/Question');
const Test = require('../models/Test');

const { buildQuestionFields, normalizeLetters } = require('../utils/questionTypes');

async function assertOwnsTest(testId, userId) {
  const test = await Test.findById(testId);
  if (!test) return { error: { status: 404, message: 'Test not found' } };
  if (String(test.teacher) !== userId) return { error: { status: 403, message: 'Forbidden' } };
  return { test };
}

// Title, marks and time limit are shared by every question type; returns { fields } or { error }
function buildCommonFields(body) {
  const { title, score, timeLimit } = body;
  if (!title || !String(title).replace(/<[^>]*>/g, '').trim()) return { error: 'Question title is required' };
  const parsedTimeLimit = Number(timeLimit ?? 1);
  if (!Number.isFinite(parsedTimeLimit) || parsedTimeLimit < 0.25) {
    return { error: 'timeLimit must be at least 0.25 minutes' };
  }
  const parsedScore = Number(score);
  if (score == null || score === '' || !Number.isFinite(parsedScore) || parsedScore <= 0) {
    return { error: 'score must be greater than 0' };
  }
  return { fields: { title: String(title), score: parsedScore, timeLimit: parsedTimeLimit } };
}

function buildAllFields(body) {
  const common = buildCommonFields(body);
  if (common.error) return common;
  const typed = buildQuestionFields(body);
  if (typed.error) return typed;
  return { fields: { ...common.fields, ...typed.fields } };
}

// POST /api/questions  { testId, type, title, optionA..D, correctAns, correctNumber, tolerance, score, timeLimit }
exports.createQuestion = async (req, res) => {
  const { testId } = req.body;
  if (!testId) return res.status(400).json({ message: 'testId is required' });
  const { test, error } = await assertOwnsTest(testId, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  const built = buildAllFields(req.body);
  if (built.error) return res.status(400).json({ message: built.error });

  const q = await Question.create({ test: test._id, ...built.fields });
  res.status(201).json(q);
};

// PUT /api/questions/:id  — same body as create (without testId)
exports.updateQuestion = async (req, res) => {
  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  const { error } = await assertOwnsTest(q.test, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  // Older clients don't send a type: keep the question's current one
  const built = buildAllFields({ type: q.type, ...req.body });
  if (built.error) return res.status(400).json({ message: built.error });

  Object.assign(q, built.fields);
  await q.save();
  res.json(q);
};

// DELETE /api/questions/:id
exports.deleteQuestion = async (req, res) => {
  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ message: 'Not found' });
  const { error } = await assertOwnsTest(q.test, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });
  await q.deleteOne();
  res.json({ ok: true });
};

// Work out a spreadsheet row's question type from what's filled in:
//   correct = True/False            → TRUE_FALSE (options may be left blank)
//   all four options blank          → NUMERIC (correct is the number, column 9 the tolerance)
//   correct = several letters (A,C) → MULTI
//   otherwise                       → MCQ
function detectRowType(options, correctRaw) {
  const correct = String(correctRaw ?? '').trim().toLowerCase();
  if (['true', 'false', 't', 'f'].includes(correct)) return 'TRUE_FALSE';
  if (options.every((o) => String(o ?? '').trim() === '')) return 'NUMERIC';
  const letters = normalizeLetters(correct);
  if (letters && letters.length > 1) return 'MULTI';
  return 'MCQ';
}

// POST /api/questions/upload?testId=... — multipart with "file" containing .xlsx/.xls/.ods
// Expected columns (no header row):
//   title | A | B | C | D | correct | score | timeLimit | tolerance (numeric questions only)
exports.uploadQuestions = async (req, res) => {
  const { testId } = req.query;
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  if (!testId) return res.status(400).json({ message: 'testId query param required' });

  const { test, error } = await assertOwnsTest(testId, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  let rows;
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  } catch (e) {
    return res.status(400).json({ message: 'Could not parse spreadsheet: ' + e.message });
  }

  const docs = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const [title, optionA, optionB, optionC, optionD, correctRaw, scoreRaw, timeLimitRaw, toleranceRaw] = row;
    if ([title, optionA, optionB, correctRaw].every((v) => String(v ?? '').trim() === '')) continue; // empty row

    const built = buildAllFields({
      type: detectRowType([optionA, optionB, optionC, optionD], correctRaw),
      title: String(title ?? ''),
      optionA,
      optionB,
      optionC,
      optionD,
      correctAns: correctRaw,
      tolerance: toleranceRaw,
      score: scoreRaw,
      timeLimit: timeLimitRaw === '' || timeLimitRaw == null ? 1 : timeLimitRaw
    });
    if (built.error) {
      errors.push({ row: i + 1, reason: built.error });
      continue;
    }
    docs.push({ test: test._id, ...built.fields });
  }

  // One at a time so each gets a later createdAt — questions are listed in createdAt order
  for (const doc of docs) await Question.create(doc);
  res.json({ created: docs.length, errors });
};
