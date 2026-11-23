const xlsx = require('xlsx');
const Question = require('../models/Question');
const Test = require('../models/Test');

const { buildQuestionFields, normalizeLetters } = require('../utils/questionTypes');
const QuestionImage = require('../models/QuestionImage');
const images = require('../utils/images');

async function assertOwnsTest(testId, userId) {
  const test = await Test.findById(testId);
  if (!test) return { error: { status: 404, message: 'Test not found' } };
  if (String(test.teacher) !== userId) return { error: { status: 403, message: 'Forbidden' } };
  return { test };
}

// Title, marks and time limit are shared by every question type; returns { fields } or { error }
function buildCommonFields(body) {
  const { title, score, timeLimit } = body;
  const hasTitle = title && String(title).replace(/<[^>]*>/g, '').trim();
  // A question may be just a picture (e.g. a diagram with the question written on it)
  if (!hasTitle && !body.image) return { error: 'Type the question or add a picture' };
  const parsedTimeLimit = Number(timeLimit ?? 1);
  if (!Number.isFinite(parsedTimeLimit) || parsedTimeLimit < 0.25) {
    return { error: 'timeLimit must be at least 0.25 minutes' };
  }
  const parsedScore = Number(score);
  if (score == null || score === '' || !Number.isFinite(parsedScore) || parsedScore <= 0) {
    return { error: 'score must be greater than 0' };
  }
  return { fields: { title: String(title || ''), score: parsedScore, timeLimit: parsedTimeLimit } };
}

function buildAllFields(body) {
  const common = buildCommonFields(body);
  if (common.error) return common;
  const typed = buildQuestionFields(body);
  if (typed.error) return typed;
  return { fields: { ...common.fields, ...typed.fields } };
}

// Text fields plus pictures (checked to belong to this teacher)
async function buildWithImages(body, teacherId) {
  const built = buildAllFields(body);
  if (built.error) return built;
  const pics = await images.buildImageFields(body, teacherId);
  if (pics.error) return pics;
  // Only single-choice / multiple-correct options can have pictures
  if (!['MCQ', 'MULTI'].includes(built.fields.type)) pics.fields.optionImages = { a: '', b: '', c: '', d: '' };
  return { fields: { ...built.fields, ...pics.fields } };
}

// POST /api/questions  { testId, type, title, optionA..D, correctAns, correctNumber, tolerance, score, timeLimit }
exports.createQuestion = async (req, res) => {
  const { testId } = req.body;
  if (!testId) return res.status(400).json({ message: 'testId is required' });
  const { test, error } = await assertOwnsTest(testId, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  const built = await buildWithImages(req.body, req.user.id);
  if (built.error) return res.status(400).json({ message: built.error });

  const q = await Question.create({ test: test._id, ...built.fields });
  await images.markAttached(images.imageKeysOf(q));
  res.status(201).json(q);
};

// PUT /api/questions/:id  — same body as create (without testId)
exports.updateQuestion = async (req, res) => {
  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  const { error } = await assertOwnsTest(q.test, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });

  // Older clients send no type or pictures: keep the question's current ones
  const built = await buildWithImages({
    type: q.type,
    image: q.image,
    optionImages: q.optionImages?.toObject?.() || q.optionImages,
    ...req.body
  }, req.user.id);
  if (built.error) return res.status(400).json({ message: built.error });

  const oldKeys = images.imageKeysOf(q);
  Object.assign(q, built.fields);
  await q.save();
  const newKeys = images.imageKeysOf(q);
  await images.markAttached(newKeys);
  await images.deleteUnusedImages(oldKeys.filter((k) => !newKeys.includes(k)));
  res.json(q);
};

// DELETE /api/questions/:id
exports.deleteQuestion = async (req, res) => {
  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ message: 'Not found' });
  const { error } = await assertOwnsTest(q.test, req.user.id);
  if (error) return res.status(error.status).json({ message: error.message });
  await q.deleteOne();
  await images.deleteUnusedImages(images.imageKeysOf(q));
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

// POST /api/questions/images — multipart "image" (PNG, JPEG, WebP or GIF, max 1.5 MB).
// Returns { key, width, height }; put the key in a question's `image` or `optionImages`.
exports.uploadImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image uploaded' });
  const buffer = req.file.buffer;
  if (buffer.length > images.MAX_IMAGE_BYTES) {
    return res.status(400).json({ message: 'Image is too large (max 1.5 MB)' });
  }
  const contentType = images.sniffImageType(buffer);
  if (!contentType) return res.status(400).json({ message: 'Please upload a PNG, JPEG, WebP or GIF image' });

  const { width = null, height = null } = images.imageSize(buffer, contentType);
  const doc = await QuestionImage.create({
    key: images.newKey(),
    teacher: req.user.id,
    contentType,
    data: buffer,
    bytes: buffer.length,
    width,
    height
  });
  res.status(201).json({ key: doc.key, width: doc.width, height: doc.height, bytes: doc.bytes });
};

// GET /api/images/:key — public, so <img> tags work without a token. Keys are random and an
// image never changes under its key, so it can be cached forever (browser and CDN).
exports.serveImage = async (req, res) => {
  if (!images.isKey(req.params.key)) return res.status(404).end();
  const img = await QuestionImage.findOne({ key: req.params.key }).select('contentType data');
  if (!img) return res.status(404).end();
  const etag = `"${req.params.key}"`;
  res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
  res.setHeader('ETag', etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', img.contentType);
  res.send(img.data);
};
