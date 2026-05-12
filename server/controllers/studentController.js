const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');
const TestStudent = require('../models/TestStudent');
const Question = require('../models/Question');
const { sign } = require('../middleware/auth');

/**
 * POST /api/students/login  { rollno, password }
 *
 * The password is scoped per-test (randomly generated when the test is created),
 * so a login = (rollno, test password) uniquely identifies which test this
 * student is taking. We return a JWT that embeds the testStudent id so the
 * rest of the quiz flow doesn't need the password again.
 */
exports.login = async (req, res) => {
  const { rollno, password, name, deviceInfo } = req.body;
  if (!rollno || !password) {
    return res.status(400).json({ message: 'rollno and password required' });
  }

  const query = { rollno };
  if (name && String(name).trim().length) {
    query.name = String(name).trim();
  }

  // Find any student record(s) with this roll number (and optional name) for class or guest students.
  const studentRecords = await StudentRecord.find(query);
  if (!studentRecords.length) {
    return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });
  }

  // Find a not-yet-submitted TestStudent row matching (any of those students, this password)
  const ts = await TestStudent.findOne({
    student: { $in: studentRecords.map(s => s._id) },
    password,
    submitted: false
  }).populate('test');

  if (!ts) return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });

  // Check if already active from another device
  if (ts.active && deviceInfo && ts.deviceInfo) {
    if (deviceInfo.userAgent !== ts.deviceInfo.userAgent || deviceInfo.platform !== ts.deviceInfo.platform) {
      return res.status(409).json({ message: 'Already logged in from another device' });
    }
  }

  // Store device info and set active
  if (deviceInfo) {
    ts.deviceInfo = deviceInfo;
  }
  ts.active = true;
  ts.started = false;
  await ts.save();

  const token = sign({
    id: ts.student.toString(),
    role: 'student',
    testStudentId: ts._id.toString(),
    testId: ts.test._id.toString(),
    rollno
  });

  // Resolve the student's name from the matching StudentRecord (fall back to the
  // value the user typed at login if we didn't match by name).
  const matchedStudent = studentRecords.find(
    s => String(s._id) === String(ts.student)
  );
  const studentName =
    (matchedStudent && matchedStudent.name) ||
    (name ? String(name).trim() : '') ||
    '';

  res.json({
    token,
    rollno,
    name: studentName,
    testId: ts.test._id,
    testName: ts.test.name,
    testStatus: ts.test.status
  });
};

/**
 * GET /api/students/dashboard
 * Returns the current RUNNING test for this student (if any).
 * Mirrors the old files/get_dashboard_contents.php which only showed tests in state RUNNING.
 */
exports.dashboard = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });

  const running = ts.test.status === 'RUNNING';
  res.json({
    testId: ts.test._id,
    testName: ts.test.name,
    subject: ts.test.subject,
    totalQuestions: ts.test.totalQuestions,
    running,
    submitted: ts.submitted
  });
};

/**
 * GET /api/quiz/questions
 * Returns the full list of questions for the student's test, WITHOUT the correct answer.
 * The original PHP served one question at a time from session state; we return
 * the whole list and let the React client page through it. Cheating risk is
 * identical — the client doesn't see correctAns either way.
 */
exports.getQuestions = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });

  // Set started to true when fetching questions
  ts.started = true;
  await ts.save();

  const questions = await Question.find({ test: ts.test })
    .select('title optionA optionB optionC optionD score')
    .sort({ createdAt: 1 });

  // Shuffle questions for this student
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  res.json(questions);
};

/**
 * POST /api/quiz/answer  { questionId, selectedOption }
 * Checks the answer, updates this question's correct/wrong counters
 * and the student's running score.
 */
exports.submitAnswer = async (req, res) => {
  const { questionId, selectedOption } = req.body;
  const ts = await TestStudent.findById(req.user.testStudentId);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });

  const q = await Question.findById(questionId);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  if (String(q.test) !== String(ts.test)) {
    return res.status(403).json({ message: 'Question not part of your test' });
  }

  const picked = String(selectedOption || '').toLowerCase();
  const correct = picked === q.correctAns;

  if (correct) {
    q.correctCount += 1;
    ts.score += q.score;
  } else {
    q.wrongCount += 1;
  }
  await q.save();
  await ts.save();

  // Tell the client whether it was right, but not the correct answer
  res.json({ correct });
};

/**
 * POST /api/quiz/finish  { aborted?: boolean, autoSubmitted?: boolean }
 * Marks the TestStudent as submitted. Idempotent — safe to call twice.
 */
exports.finish = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  ts.submitted = true;
  ts.active = false;
  if (req.body.autoSubmitted) ts.autoSubmitted = true;
  await ts.save();
  res.json({ ok: true, aborted: !!req.body.aborted, score: ts.score });
};

/**
 * POST /api/quiz/violation  { type: string }
 * Increments the violation counter for anti-cheat tracking (tab switches,
 * fullscreen exits, etc). Returns the new count so the client can decide
 * whether to force-submit.
 */
exports.logViolation = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.json({ violations: ts.violations, submitted: true });

  ts.violations = (ts.violations || 0) + 1;
  await ts.save();
  res.json({ violations: ts.violations });
};

/**
 * POST /api/students/logout
 * Logs out the student by setting active to false.
 */
exports.logout = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  ts.active = false;
  await ts.save();
  res.json({ ok: true });
};
