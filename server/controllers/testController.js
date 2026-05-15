const crypto = require('crypto');
const Test = require('../models/Test');
const Class = require('../models/Class');
const Question = require('../models/Question');
const StudentRecord = require('../models/StudentRecord');
const TestStudent = require('../models/TestStudent');

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

  const questions = await Question.find({ test: test._id }).sort({ createdAt: 1 });
  res.json({ ...test.toObject(), questions });
};

// POST /api/tests — create a new test; also seeds TestStudent rows for every student in the class
exports.createTest = async (req, res) => {
  const { name, subject, date, totalQuestions, status, classId, mode } = req.body;
  if (!name || !subject || !date || !totalQuestions || !status || !classId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  if (!['PENDING', 'RUNNING'].includes(status)) {
    return res.status(400).json({ message: 'status must be PENDING or RUNNING on create' });
  }
  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const test = await Test.create({
    teacher: req.user.id,
    name,
    subject,
    date,
    totalQuestions,
    class: cls._id,
    status,
    mode: mode === 'MOCK' ? 'MOCK' : 'STANDARD'
  });

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

  const { name, subject, date, totalQuestions, status, mode } = req.body;
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

// DELETE /api/tests/:id — cascades to questions + testStudents
exports.deleteTest = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  // Gather the TestStudent rows so we can clean up any "guest" (classless) StudentRecords
  const testStudents = await TestStudent.find({ test: test._id }).populate('student');
  const guestStudentIds = testStudents
    .filter(ts => ts.student && ts.student.class == null)
    .map(ts => ts.student._id);

  await Question.deleteMany({ test: test._id });
  await TestStudent.deleteMany({ test: test._id });
  if (guestStudentIds.length) {
    await StudentRecord.deleteMany({ _id: { $in: guestStudentIds } });
  }
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

  // Reuse existing guest record for this rollno to avoid duplicate key on (rollno, class=null)
  const student = await StudentRecord.findOneAndUpdate(
    { rollno: Number(rollno), class: null },
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

  const rows = await TestStudent.find({ test: test._id }).populate('student').sort({ createdAt: 1 });
  res.json(rows.map(r => ({
    testStudentId: r._id,
    studentId: r.student?._id,
    rollno: r.student?.rollno,
    name: r.student?.name,
    password: r.password,
    score: r.score,
    submitted: r.submitted,
    active: r.active,
    started: r.started
  })));
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

  if (rollno != null) student.rollno = Number(rollno);
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
    await StudentRecord.deleteOne({ _id: studentToDelete });
  }

  res.json({ testStudentId: testStudent._id, studentId: studentToDelete });
};

// GET /api/tests/:id/scoreboard — per-student scores for the Test Stats screen
exports.scoreboard = async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) return res.status(404).json({ message: 'Not found' });
  if (String(test.teacher) !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const rows = await TestStudent.find({ test: test._id }).populate('student').sort({ score: -1 });
  res.json({
    test: { id: test._id, name: test.name, subject: test.subject },
    rows: rows.map(r => ({
      rollno: r.student?.rollno,
      score: r.score,
      submitted: r.submitted,
      violations: r.violations || 0,
      autoSubmitted: r.autoSubmitted || false
    }))
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
