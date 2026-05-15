const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');
const TestStudent = require('../models/TestStudent');
const Question = require('../models/Question');
const StudentAnswer = require('../models/StudentAnswer');
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

  // Find a matching TestStudent row for this student/password.
  const ts = await TestStudent.findOne({
    student: { $in: studentRecords.map(s => s._id) },
    password
  }).populate('test');

  if (!ts) return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });
  if (ts.submitted && ts.test.mode !== 'MOCK') {
    return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });
  }

  // If this is a mock test and the prior attempt was submitted (or completed), reset the row so the student can retry.
  if (ts.test.mode === 'MOCK' && (ts.submitted || ts.completedOnce)) {
    ts.submitted = false;
    ts.completedOnce = false; // reset so dashboard shows "Start Test" instead of "Test completed"
    ts.score = 0;
    ts.violations = 0;
    ts.autoSubmitted = false;
    ts.started = false;
    await StudentAnswer.deleteMany({ testStudent: ts._id });
  }

  // For STANDARD tests enforce single-device active lock; skip for MOCK tests
  if (ts.test.mode !== 'MOCK') {
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
  } else {
    // In MOCK mode we do not enforce proctoring/device locks but we still
    // mark the TestStudent active so the JWT-backed requests are accepted.
    ts.active = true;
    ts.deviceInfo = undefined;
  }

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
    testStatus: ts.test.status,
    testMode: ts.test.mode
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
  // For MOCK tests, show submitted if completedOnce (even if currently submitted=false for retakes)
  const submitted = ts.test.mode === 'MOCK' ? ts.completedOnce : ts.submitted;
  res.json({
    testId: ts.test._id,
    testName: ts.test.name,
    subject: ts.test.subject,
    totalQuestions: ts.test.totalQuestions,
    running,
    submitted,
    isMock: ts.test.mode === 'MOCK'
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

  // Store the student's answer for mock test review
  await StudentAnswer.create({
    testStudent: ts._id,
    question: q._id,
    selectedOption: picked,
    isCorrect: correct
  });

  // Tell the client whether it was right, but not the correct answer
  res.json({ correct });
};

/**
 * POST /api/quiz/finish  { aborted?: boolean, autoSubmitted?: boolean }
 * Marks the TestStudent as submitted. Idempotent — safe to call twice.
 */
exports.finish = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.test.mode !== 'MOCK') {
    ts.submitted = true;
  } else {
    // For MOCK tests: mark as completed once (for dashboard), but reset state to allow retakes
    ts.completedOnce = true;
    ts.submitted = false;
    ts.started = false;
    ts.score = 0;
    ts.violations = 0;
    ts.autoSubmitted = false;
  }
  ts.active = false;
  if (req.body.autoSubmitted && ts.test.mode !== 'MOCK') ts.autoSubmitted = true;
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
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.json({ violations: ts.violations, submitted: true });
  if (ts.test.mode === 'MOCK') {
    return res.json({ violations: 0, submitted: false });
  }

  ts.violations = (ts.violations || 0) + 1;
  await ts.save();
  res.json({ violations: ts.violations });
};

/**
 * GET /api/students/quiz/results
 * Returns the student's test results (score and answers with correct answers).
 * Only for MOCK tests.
 */
exports.getResults = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.test.mode !== 'MOCK') return res.status(403).json({ message: 'Not available for standard tests' });

  // Get all questions for this test with correct answers
  const questions = await Question.find({ test: ts.test })
    .select('title optionA optionB optionC optionD correctAns score')
    .sort({ createdAt: 1 });

  // Get all student answers
  const answers = await StudentAnswer.find({ testStudent: ts._id })
    .populate('question')
    .sort({ createdAt: 1 });

  // Compute score from answers — ts.score is reset to 0 on finish for retake purposes
  const score = answers.reduce((sum, a) => sum + (a.isCorrect ? (a.question?.score || 0) : 0), 0);

  // Build answer lookup
  const answerMap = {};
  answers.forEach(a => {
    answerMap[String(a.question._id)] = {
      selected: a.selectedOption,
      isCorrect: a.isCorrect
    };
  });

  // Combine questions with student answers
  const results = questions.map(q => ({
    _id: q._id,
    title: q.title,
    optionA: q.optionA,
    optionB: q.optionB,
    optionC: q.optionC,
    optionD: q.optionD,
    correctAns: q.correctAns,
    score: q.score,
    studentAnswer: answerMap[String(q._id)] || { selected: null, isCorrect: false }
  }));

  res.json({
    testName: ts.test.name,
    totalQuestions: questions.length,
    score,
    results
  });
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
