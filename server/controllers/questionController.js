const xlsx = require('xlsx');
const Question = require('../models/Question');
const Test = require('../models/Test');

// Small helper — accepts 'A'/'a'/'B'/'b' etc. and returns lowercase letter
function normalizeCorrect(val) {
  if (val == null) return null;
  const s = String(val).trim().toLowerCase();
  return ['a', 'b', 'c', 'd'].includes(s) ? s : null;
}

async function assertOwnsTest(testId, userId) {
  const test = await Test.findById(testId);
  if (!test) return { error: { status: 404, message: 'Test not found' } };
  if (String(test.teacher) !== userId) return { error: { status: 403, message: 'Forbidden' } };
  return { test };
}

// POST /api/questions  { testId, title, optionA..D, correctAns, score }
exports.createQuestion = async (req, res) => {
  const { testId, title, optionA, optionB, optionC, optionD, correctAns, score } = req.body;
  if (!testId || !title || !optionA || !optionB || !optionC || !optionD || !correctAns || score == null) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  const { test, error } = await assertOwnsTest(testId, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  const ans = normalizeCorrect(correctAns);
  if (!ans) return res.status(400).json({ message: 'correctAns must be A, B, C or D' });

  const q = await Question.create({
    test: test._id,
    title,
    optionA,
    optionB,
    optionC,
    optionD,
    correctAns: ans,
    score
  });
  res.status(201).json(q);
};

// PUT /api/questions/:id  { title, optionA..D, correctAns, score }
exports.updateQuestion = async (req, res) => {
  const { title, optionA, optionB, optionC, optionD, correctAns, score } = req.body;
  if (!title || !optionA || !optionB || !optionC || !optionD || !correctAns || score == null) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  const { error } = await assertOwnsTest(q.test, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  const ans = normalizeCorrect(correctAns);
  if (!ans) return res.status(400).json({ message: 'correctAns must be A, B, C or D' });

  q.title = title;
  q.optionA = optionA;
  q.optionB = optionB;
  q.optionC = optionC;
  q.optionD = optionD;
  q.correctAns = ans;
  q.score = score;
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

// POST /api/questions/upload?testId=... — multipart with "file" containing .xlsx/.xls/.ods
// Expected columns (no header row): title | A | B | C | D | correct | score
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

  const created = [];
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const [title, optionA, optionB, optionC, optionD, correctRaw, scoreRaw] = row;
    if (!title && !optionA && !optionB) continue; // skip empty rows

    const correctAns = normalizeCorrect(correctRaw);
    const score = Number(scoreRaw);
    if (!title || !optionA || !optionB || !optionC || !optionD || !correctAns || !Number.isFinite(score)) {
      errors.push({ row: i + 1, reason: 'Invalid or missing fields' });
      continue;
    }

    const q = await Question.create({
      test: test._id,
      title: String(title),
      optionA: String(optionA),
      optionB: String(optionB),
      optionC: String(optionC),
      optionD: String(optionD),
      correctAns,
      score
    });
    created.push(q._id);
  }

  res.json({ created: created.length, errors });
};
