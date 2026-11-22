const crypto = require('crypto');
const Test = require('../models/Test');
const Class = require('../models/Class');
const Question = require('../models/Question');
const StudentRecord = require('../models/StudentRecord');
const TestStudent = require('../models/TestStudent');
const StudentAnswer = require('../models/StudentAnswer');
const xlsx = require('xlsx');
const { typeOf, TYPE_LABELS, describeAnswer, describeCorrect } = require('../utils/questionTypes');
const images = require('../utils/images');

const USN_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

// Validate and copy the timing / shuffle settings from a request body onto a test.
// Returns an error message, or null when everything is valid.
function applyTestOptions(test, body) {
  const { timingMode, totalTimeMinutes, shuffle } = body;
  if (timingMode !== undefined) {
    if (!['PER_QUESTION', 'TOTAL'].includes(timingMode)) return 'Invalid timing mode';
    test.timingMode = timingMode;
  }
  if (totalTimeMinutes !== undefined) {
    const minutes = Number(totalTimeMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return 'Total time must be between 1 and 600 minutes';
    test.totalTimeMinutes = Math.round(minutes);
  }
  if (shuffle !== undefined) test.shuffle = shuffle === true;
  return applySchedule(test, body);
}

// startAt / endAt: ISO date strings, or null / '' to clear. Changing a time re-arms it.
function applySchedule(test, body) {
  const parse = (value) => {
    if (value === null || value === '') return { date: null };
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? { error: true } : { date };
  };
  const same = (a, b) => (a ? a.getTime() : null) === (b ? b.getTime() : null);

  if (body.startAt !== undefined) {
    const { date, error } = parse(body.startAt);
    if (error) return 'Invalid start time';
    if (!same(date, test.startAt)) {
      test.startAt = date;
      test.autoStarted = false;
    }
  }
  if (body.endAt !== undefined) {
    const { date, error } = parse(body.endAt);
    if (error) return 'Invalid end time';
    if (!same(date, test.endAt)) {
      // Pushing the end time later on a test the schedule closed reopens it
      if (test.autoEnded && test.status === 'COMPLETED' && date && date > new Date()) test.status = 'RUNNING';
      test.endAt = date;
      test.autoEnded = false;
    }
  }
  if (test.startAt && test.endAt && test.endAt <= test.startAt) return 'End time must be after the start time';
  return null;
}

// Bring the schedule up to date for this teacher's tests whose start/end time has passed
async function applyDueSchedules(teacherId) {
  const now = new Date();
  const due = await Test.find({
    teacher: teacherId,
    $or: [
      { startAt: { $ne: null, $lte: now }, autoStarted: { $ne: true } },
      { endAt: { $ne: null, $lte: now }, autoEnded: { $ne: true } }
    ]
  });
  await Test.applyScheduleAll(due, now);
}

// Delete guest (classless) student records, keeping any still enrolled in another test
async function deleteUnusedGuests(studentIds) {
  if (!studentIds.length) return;
  const stillUsed = await TestStudent.distinct('student', { student: { $in: studentIds } });
  const usedSet = new Set(stillUsed.map(String));
  const unused = studentIds.filter((sid) => !usedSet.has(String(sid)));
  if (unused.length) await StudentRecord.deleteMany({ _id: { $in: unused }, class: null });
}

function randomPassword(length = 8) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// GET /api/tests?status=pending|running|completed|active
// "active" = PENDING + RUNNING (what the teacher dashboard shows)
exports.listTests = async (req, res) => {
  await applyDueSchedules(req.user.id);
  const filter = { teacher: req.user.id };
  const { status } = req.query;
  if (status) {
    const map = {
      pending: 'PENDING',
      running: 'RUNNING',
      completed: 'COMPLETED',
      active: { $in: ['PENDING', 'RUNNING'] }
    };
    const val = map[status.toLowerCase()];
    if (val) filter.status = val;
  }
  const tests = await Test.find(filter).populate('class', 'name').sort({ date: -1 });
  res.json(tests);
};

// GET /api/tests/:id — full test detail with questions + class
exports.getTest = async (req, res) => {
  const test = await Test.findById(req.params.id).populate('class', 'name');
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
  await test.applySchedule();

  const questions = await Question.find({ test: test._id }).sort({ createdAt: 1 });
  res.json({ ...test.toObject(), questions });
};

// POST /api/tests — create a new test; also seeds TestStudent rows for every student in the class
exports.createTest = async (req, res) => {
  const { name, subject, date, totalQuestions, status, classId, mode, webcamProctoring } = req.body;
  if (!name || !subject || !date || !totalQuestions || !status || !classId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (!['PENDING', 'RUNNING'].includes(status)) {
    return res.status(400).json({ message: 'status must be PENDING or RUNNING on create' });
  }
  const cls = await Class.findOne({ _id: classId, teacher: req.user.id });
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const test = new Test({
    teacher: req.user.id,
    name,
    subject,
    date,
    totalQuestions,
    class: cls._id,
    status,
    mode: mode === 'MOCK' ? 'MOCK' : 'STANDARD',
    webcamProctoring: webcamProctoring !== false
  });
  const optionsError = applyTestOptions(test, req.body);
  if (optionsError) return res.status(400).json({ message: optionsError });
  await test.save();

  // Create per-test student rows for every student record in this class
  const students = await StudentRecord.find({ class: cls._id });
  const rows = students.map(s => ({
    test: test._id,
    student: s._id,
    password: randomPassword(8),
    score: 0,
    submitted: false
  }));
  if (rows.length) await TestStudent.insertMany(rows);

  res.status(201).json(test);
};

// PUT /api/tests/:id — update general settings
exports.updateTest = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const { name, subject, date, totalQuestions, status, mode, webcamProctoring } = req.body;
  if (name !== undefined) test.name = name;
  if (subject !== undefined) test.subject = subject;
  if (date !== undefined) test.date = date;
  if (totalQuestions !== undefined) test.totalQuestions = totalQuestions;
  if (status !== undefined) {
    if (!['PENDING', 'RUNNING', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    test.status = status;
  }
  if (mode !== undefined) {
    if (!['STANDARD', 'MOCK'].includes(mode)) {
      return res.status(400).json({ message: 'Invalid mode' });
    }
    test.mode = mode;
  }
  if (webcamProctoring !== undefined) test.webcamProctoring = webcamProctoring === true;
  const optionsError = applyTestOptions(test, req.body);
  if (optionsError) return res.status(400).json({ message: optionsError });
  await test.save();
  res.json(test);
};

// POST /api/tests/:id/complete — mark as COMPLETED
exports.completeTest = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
  test.status = 'COMPLETED';
  await test.save();
  res.json(test);
};

// DELETE /api/tests/:id — cascades to questions, testStudents and their answers
exports.deleteTest = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  // Gather the TestStudent rows so we can clean up any "guest" (classless) StudentRecords
  const testStudents = await TestStudent.find({ test: test._id }).populate('student');
  const guestStudentIds = testStudents
    .filter(ts => ts.student && ts.student.class == null)
    .map(ts => ts.student._id);

  await StudentAnswer.deleteMany({ testStudent: { $in: testStudents.map((ts) => ts._id) } });
  const questions = await Question.find({ test: test._id }).select('image optionImages');
  await Question.deleteMany({ test: test._id });
  await images.deleteUnusedImages(questions.flatMap((q) => images.imageKeysOf(q)));
  await TestStudent.deleteMany({ test: test._id });
  await deleteUnusedGuests(guestStudentIds);
  await test.deleteOne();

  res.json({ ok: true });
};

// POST /api/tests/:id/guest-student  { rollno } — add a guest student (no class) just to this test
exports.addGuestStudent = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const { rollno, name } = req.body;
  if (!rollno) return res.status(400).json({ message: 'rollno required' });

  // Reuse this teacher's existing guest record for the USN (guests are private per teacher)
  const student = await StudentRecord.findOneAndUpdate(
    { rollno: String(rollno).trim().toUpperCase(), class: null, teacher: test.teacher },
    { $set: { name: name ? String(name).trim() : null } },
    { upsert: true, new: true }
  );

  // Prevent enrolling the same student in the same test twice
  const existing = await TestStudent.findOne({ test: test._id, student: student._id });
  if (existing) {
    return res.status(409).json({ message: 'Student with this roll number is already enrolled in this test' });
  }

  const ts = await TestStudent.create({
    test: test._id,
    student: student._id,
    password: randomPassword(8)
  });
  res.status(201).json({ student, testStudent: ts });
};

// GET /api/tests/:id/credentials — list of { rollno, password } for printing
exports.listCredentials = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const rows = await TestStudent.find({ test: test._id }).populate('student');
  // USN ascending, natural order (1AB21CS2 before 1AB21CS10)
  rows.sort((a, b) => USN_COLLATOR.compare(a.student?.rollno ?? '', b.student?.rollno ?? ''));
  res.json(rows.map(r => ({
    testStudentId: r._id,
    studentId: r.student?._id,
    rollno: r.student?.rollno,
    name: r.student?.name,
    password: r.password,
    score: r.score,
    submitted: r.submitted,
    active: r.active,
    started: r.started,
    violations: r.violations || 0,
    violationTypes: r.violationTypes || [],
    deviceLocked: !!(r.deviceId && !r.submitted)
  })));
};

// POST /api/tests/:id/students/:testStudentId/unlock
// Releases the one-device lock (e.g. the student's phone died) and signs out
// whichever device currently holds the test, so the student can log in again.
exports.unlockStudentDevice = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const ts = await TestStudent.findOne({ _id: req.params.testStudentId, test: test._id });
  if (!ts) return res.status(404).json({ message: 'Student not found for this test' });

  ts.deviceId = null;
  ts.sessionToken = crypto.randomBytes(16).toString('hex'); // invalidates the current token
  ts.active = false;
  await ts.save();
  res.json({ ok: true });
};

exports.updateStudentRecord = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const { studentId } = req.params;
  const { rollno, name } = req.body;
  if (rollno == null && (name == null || String(name).trim().length === 0)) {
    return res.status(400).json({ message: 'rollno or name required' });
  }

  const testStudent = await TestStudent.findOne({ test: test._id, student: studentId });
  if (!testStudent) return res.status(404).json({ message: 'Student not found for this test' });

  const student = await StudentRecord.findById(studentId);
  if (!student) return res.status(404).json({ message: 'Student record not found' });

  if (rollno != null) student.rollno = String(rollno);
  if (name != null) student.name = String(name).trim() || null;

  try {
    await student.save();
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Roll number already exists for this class' });
    }
    throw err;
  }

  res.json({ studentId: student._id, rollno: student.rollno, name: student.name });
};

exports.deleteStudentRecord = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Test not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const { studentId } = req.params;
  let testStudent = await TestStudent.findOne({ _id: studentId, test: test._id }).populate('student');
  if (!testStudent) {
    testStudent = await TestStudent.findOne({ test: test._id, student: studentId }).populate('student');
  }
  if (!testStudent) return res.status(404).json({ message: 'Student not found for this test' });

  const isGuest = testStudent.student && testStudent.student.class == null;
  const studentToDelete = testStudent.student?._id;
  await TestStudent.deleteOne({ _id: testStudent._id });
  if (isGuest && studentToDelete) {
    await deleteUnusedGuests([studentToDelete]);
  }

  res.json({ testStudentId: testStudent._id, studentId: studentToDelete });
};

// GET /api/tests/:id/scoreboard — per-student scores for the Test Stats screen
exports.scoreboard = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  // A fixed handful of queries however many students there are (this page refreshes itself,
  // so one query per student would hammer the database during a big exam)
  const [rows, questions] = await Promise.all([
    TestStudent.find({ test: test._id })
      .select('student submitted violations violationTypes autoSubmitted')
      .populate('student', 'rollno name')
      .lean(),
    Question.find({ test: test._id }).select('score').lean()
  ]);
  const marks = new Map(questions.map((q) => [String(q._id), q.score || 0]));
  const answers = await StudentAnswer.find({ testStudent: { $in: rows.map((r) => r._id) }, isCorrect: true })
    .select('testStudent question')
    .lean();
  const scoreOf = new Map();
  for (const a of answers) {
    const key = String(a.testStudent);
    scoreOf.set(key, (scoreOf.get(key) || 0) + (marks.get(String(a.question)) || 0));
  }
  const scored = rows
    .map((r) => ({ r, score: scoreOf.get(String(r._id)) || 0 }))
    .sort((a, b) => b.score - a.score);
  res.json({
    test: { id: test._id, name: test.name, subject: test.subject },
    rows: scored.map(({ r, score }) => ({
      testStudentId: r._id,
      rollno: r.student?.rollno,
      name: r.student?.name || '',
      score,
      submitted: r.submitted,
      violations: r.violations || 0,
      violationTypes: r.violationTypes || [],
      autoSubmitted: r.autoSubmitted || false
    }))
  });
};

// GET /api/tests/:id/students/:testStudentId/answers — one student's answer for every question
exports.studentAnswers = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const ts = await TestStudent.findOne({ _id: req.params.testStudentId, test: test._id }).populate('student');
  if (!ts) return res.status(404).json({ message: 'Student not found for this test' });

  const questions = await Question.find({ test: test._id }).sort({ createdAt: 1 });
  const answers = await StudentAnswer.find({ testStudent: ts._id }).sort({ createdAt: 1 });
  const answerByQuestion = new Map();
  answers.forEach((a) => answerByQuestion.set(String(a.question), a));

  let score = 0;
  let maxScore = 0;
  const rows = questions.map((q) => {
    const answer = answerByQuestion.get(String(q._id));
    maxScore += q.score || 0;
    if (answer?.isCorrect) score += q.score || 0;
    return {
      id: q._id,
      type: typeOf(q),
      title: q.title,
      image: q.image || '',
      options: { a: q.optionA, b: q.optionB, c: q.optionC, d: q.optionD },
      correctAns: q.correctAns,
      correctText: describeCorrect(q),
      selectedOption: answer?.selectedOption || null,
      answerText: answer ? describeAnswer(q, answer.selectedOption) : '',
      isCorrect: answer ? answer.isCorrect : null,
      score: q.score
    };
  });

  res.json({
    test: { id: test._id, name: test.name, subject: test.subject },
    student: {
      rollno: ts.student?.rollno,
      name: ts.student?.name || '',
      submitted: ts.submitted,
      autoSubmitted: ts.autoSubmitted || false
    },
    score,
    maxScore,
    questions: rows
  });
};

// GET /api/tests/:id/question-stats — per-question correct/wrong counts
exports.questionStats = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const questions = await Question.find({ test: test._id }).sort({ createdAt: 1 });
  res.json({
    test: { id: test._id, name: test.name },
    questions: questions.map(q => ({
      id: q._id,
      title: q.title,
      correctCount: q.correctCount,
      wrongCount: q.wrongCount
    }))
  });
};

const VIOLATION_LABELS = {
  'tab-switch': 'Tab switching',
  'assistant-opened': 'Left the test screen (assistant, notification panel or overlay)',
  'focus-lost': 'Switched to another window or app',
  'second-device-login': 'Tried to log in from a second device',
  'fullscreen-exit': 'Exited fullscreen',
  'camera-disabled': 'Camera disabled',
  'looking-away': 'Looked away from the screen',
  'face-not-visible': 'Face not visible',
  'multiple-faces': 'More than one face'
};

// Rich-text question titles → plain text for spreadsheet cells
function plainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Short answer for a grid cell: 'A', 'A, C', 'True', '9.8'
function shortAnswer(question, value) {
  if (value == null || value === '') return '';
  const type = typeOf(question);
  if (type === 'NUMERIC') return String(value);
  if (type === 'TRUE_FALSE') return value === 'a' ? 'True' : 'False';
  return String(value).toUpperCase().split('').join(', ');
}

function statusOf(row) {
  if (row.autoSubmitted) return 'Auto-submitted';
  if (row.submitted) return 'Submitted';
  if (row.started || row.startedAt) return 'Started, not submitted';
  return 'Not started';
}

// GET /api/tests/:id/export — the results as an .xlsx workbook:
//   Results   one row per student (score, %, right/wrong/skipped, status, violations)
//   Answers   every student's answer to every question, with the key on the first row
//   Questions per-question type, correct answer and how many got it right
exports.exportResults = async (req, res) => {
  const test = await Test.findById(req.params.id).populate('class', 'name');
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const [questions, rows] = await Promise.all([
    Question.find({ test: test._id }).sort({ createdAt: 1 }),
    TestStudent.find({ test: test._id }).populate('student')
  ]);
  const answers = await StudentAnswer.find({ testStudent: { $in: rows.map((r) => r._id) } });
  const answerOf = new Map(answers.map((a) => [`${a.testStudent}|${a.question}`, a]));
  const maxScore = questions.reduce((sum, q) => sum + (q.score || 0), 0);

  // Per-student totals, worked out from the stored answers (as the scoreboard does)
  const students = rows.map((row) => {
    let score = 0;
    let right = 0;
    let wrong = 0;
    for (const q of questions) {
      const a = answerOf.get(`${row._id}|${q._id}`);
      if (!a) continue;
      if (a.isCorrect) { right += 1; score += q.score || 0; } else wrong += 1;
    }
    return { row, score, right, wrong, skipped: questions.length - right - wrong };
  });
  // Highest score first; equal scores share a rank; ties listed by USN
  students.sort((a, b) => b.score - a.score || USN_COLLATOR.compare(a.row.student?.rollno ?? '', b.row.student?.rollno ?? ''));
  let rank = 0;
  students.forEach((s, i) => {
    if (i === 0 || s.score !== students[i - 1].score) rank = i + 1;
    s.rank = rank;
  });

  const results = students.map((s) => ({
    Rank: s.rank,
    USN: s.row.student?.rollno || '',
    Name: s.row.student?.name || '',
    Score: s.score,
    'Max marks': maxScore,
    'Percentage': maxScore ? Math.round((s.score / maxScore) * 1000) / 10 : 0,
    Right: s.right,
    Wrong: s.wrong,
    'Not answered': s.skipped,
    Status: statusOf(s.row),
    Violations: s.row.violations || 0,
    'Violation details': (s.row.violationTypes || []).map((t) => VIOLATION_LABELS[t] || t).join('; ')
  }));

  // Answers grid: Q1…Qn columns, a ✓ / ✗ after each answer
  const qHeaders = questions.map((_, i) => `Q${i + 1}`);
  const keyRow = { USN: 'Correct answer', Name: '' };
  questions.forEach((q, i) => {
    keyRow[qHeaders[i]] = typeOf(q) === 'NUMERIC' ? describeCorrect(q) : shortAnswer(q, q.correctAns);
  });
  const answerRows = [keyRow, ...students.map((s) => {
    const line = { USN: s.row.student?.rollno || '', Name: s.row.student?.name || '' };
    questions.forEach((q, i) => {
      const a = answerOf.get(`${s.row._id}|${q._id}`);
      line[qHeaders[i]] = a ? `${shortAnswer(q, a.selectedOption)} ${a.isCorrect ? '✓' : '✗'}` : '—';
    });
    return line;
  })];

  const attempted = students.length || 1;
  const questionRows = questions.map((q, i) => {
    let right = 0;
    let wrong = 0;
    for (const s of students) {
      const a = answerOf.get(`${s.row._id}|${q._id}`);
      if (a) { if (a.isCorrect) right += 1; else wrong += 1; }
    }
    return {
      '#': i + 1,
      Question: plainText(q.title) + (q.image ? ' [picture]' : ''),
      Type: TYPE_LABELS[typeOf(q)],
      'Correct answer': describeCorrect(q),
      Marks: q.score,
      Right: right,
      Wrong: wrong,
      'Not answered': students.length - right - wrong,
      '% right': Math.round((right / attempted) * 1000) / 10
    };
  });

  const wb = xlsx.utils.book_new();
  const info = [
    ['Test', test.name],
    ['Subject', test.subject],
    ['Class', test.class?.name || ''],
    ['Date', test.date ? test.date.toISOString().slice(0, 10) : ''],
    ['Students', students.length],
    ['Submitted', students.filter((s) => s.row.submitted).length],
    ['Average score', students.length ? Math.round((students.reduce((t, s) => t + s.score, 0) / students.length) * 100) / 100 : 0],
    ['Max marks', maxScore]
  ];
  const resultsSheet = xlsx.utils.aoa_to_sheet(info);
  // One blank row between the summary and the table
  xlsx.utils.sheet_add_json(resultsSheet, results, { origin: { r: info.length + 1, c: 0 } });
  resultsSheet['!cols'] = [6, 14, 24, 7, 10, 11, 6, 6, 13, 22, 10, 50].map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(wb, resultsSheet, 'Results');

  const answersSheet = xlsx.utils.json_to_sheet(answerRows, { header: ['USN', 'Name', ...qHeaders] });
  answersSheet['!cols'] = [{ wch: 16 }, { wch: 24 }, ...qHeaders.map(() => ({ wch: 10 }))];
  xlsx.utils.book_append_sheet(wb, answersSheet, 'Answers');

  const questionsSheet = xlsx.utils.json_to_sheet(questionRows);
  questionsSheet['!cols'] = [4, 60, 16, 30, 6, 6, 6, 13, 8].map((wch) => ({ wch }));
  xlsx.utils.book_append_sheet(wb, questionsSheet, 'Questions');

  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const name = `${String(test.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Test'} results.xlsx`;
  const asciiName = name.replace(/[^\w .-]/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // filename* keeps non-English test names intact in browsers that support it
  res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(buffer);
};
