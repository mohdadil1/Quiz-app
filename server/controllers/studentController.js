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

  const query = { rollno: String(rollno).trim().toUpperCase() };
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
    ts.violationTypes = [];
    ts.autoSubmitted = false;
    ts.started = false;
    ts.startedAt = null;
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
    testMode: ts.test.mode,
    webcamProctoring: ts.test.webcamProctoring !== false,
    timingMode: ts.test.timingMode || 'PER_QUESTION',
    totalTimeMinutes: ts.test.totalTimeMinutes || 30
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
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test', 'shuffle');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });

  // Set started to true when fetching questions
  ts.started = true;
  await ts.save();

  const questions = await Question.find({ test: ts.test._id })
    .select('title optionA optionB optionC optionD score timeLimit')
    .sort({ createdAt: 1 });

  res.json(orderForStudent(ts, questions).map(({ question, optionOrder }) => ({
    ...question.toObject(),
    // Display order of the options; the client still sends the original letter
    optionOrder,
    timeLimit: Number.isFinite(Number(question.timeLimit)) && Number(question.timeLimit) >= 0.25
      ? Number(question.timeLimit)
      : 1
  })));
};

// Shuffled tests: a stable order of questions and options per student (seeded by their
// test entry), so a reconnect or the results page shows the same order, but neighbours
// see different ones. `ts.test` must be populated.
function orderForStudent(ts, questions) {
  const letters = ['a', 'b', 'c', 'd'];
  if (ts.test.shuffle === false) return questions.map((question) => ({ question, optionOrder: letters }));
  const random = seededRandom(String(ts._id));
  return shuffled(questions, random).map((question) => ({ question, optionOrder: shuffled(letters, random) }));
}

// Small deterministic PRNG (mulberry32) seeded from a string
function seededRandom(seedText) {
  let seed = 0;
  for (const ch of seedText) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Seconds the student has left in a total-time test (null when the test isn't total-time)
const TOTAL_TIME_GRACE_MS = 15 * 1000; // allow for network delay on the last answer
function remainingMs(ts, test) {
  if (test.mode === 'MOCK' || test.timingMode !== 'TOTAL' || !ts.startedAt) return null;
  return ts.startedAt.getTime() + (test.totalTimeMinutes || 30) * 60 * 1000 - Date.now();
}

/**
 * POST /api/quiz/start
 * Records when the student pressed Start (only the first time), and for total-time
 * tests returns how much time is left — the server owns the deadline, so a reload
 * or a changed clock can't buy extra time.
 */
exports.startQuiz = async (req, res) => {
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });

  if (!ts.startedAt) {
    ts.startedAt = new Date();
    await ts.save();
  }
  const left = remainingMs(ts, ts.test);
  res.json({
    timingMode: ts.test.mode === 'MOCK' ? 'NONE' : (ts.test.timingMode || 'PER_QUESTION'),
    remainingSeconds: left === null ? null : Math.max(0, Math.floor(left / 1000))
  });
};

/**
 * POST /api/quiz/answer  { questionId, selectedOption }
 * Checks the answer, updates this question's correct/wrong counters
 * and the student's running score.
 */
exports.submitAnswer = async (req, res) => {
  const { questionId, selectedOption } = req.body;
  const picked = String(selectedOption || '').toLowerCase();
  if (!['a', 'b', 'c', 'd'].includes(picked)) {
    return res.status(400).json({ message: 'selectedOption must be A, B, C or D' });
  }

  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });
  const left = remainingMs(ts, ts.test);
  if (left !== null && left < -TOTAL_TIME_GRACE_MS) {
    return res.status(410).json({ message: 'Time is up' });
  }

  const q = await Question.findById(questionId);
  if (!q) return res.status(404).json({ message: 'Question not found' });
  if (String(q.test) !== String(ts.test._id)) {
    return res.status(403).json({ message: 'Question not part of your test' });
  }

  const existingAnswer = await StudentAnswer.findOne({ testStudent: ts._id, question: q._id });
  if (existingAnswer) {
    return res.json({ correct: existingAnswer.isCorrect, alreadyAnswered: true });
  }

  const correct = picked === q.correctAns;

  try {
    await StudentAnswer.create({
      testStudent: ts._id,
      question: q._id,
      selectedOption: picked,
      isCorrect: correct
    });
  } catch (error) {
    if (error.code === 11000) {
      const answer = await StudentAnswer.findOne({ testStudent: ts._id, question: q._id });
      return res.json({ correct: answer.isCorrect, alreadyAnswered: true });
    }
    throw error;
  }

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
    ts.startedAt = null;
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
  const { type } = req.body;
  const ts = await TestStudent.findById(req.user.testStudentId).populate('test');
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.json({ violations: ts.violations, submitted: true });
  if (ts.test.mode === 'MOCK') {
    return res.json({ violations: 0, submitted: false });
  }

  const updated = await TestStudent.findOneAndUpdate(
    { _id: ts._id, submitted: false },
    { $inc: { violations: 1 }, $push: { violationTypes: type || 'unknown' } },
    { new: true }
  );

  if (!updated) {
    return res.json({ violations: ts.violations || 0, submitted: true });
  }

  res.json({ violations: updated.violations });
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
  const questions = await Question.find({ test: ts.test._id })
    .select('title optionA optionB optionC optionD correctAns score')
    .sort({ createdAt: 1 });

  // Get all student answers
  const answers = await StudentAnswer.find({ testStudent: ts._id })
    .populate('question')
    .sort({ createdAt: 1 });

  const latestAnswers = new Map();
  answers.forEach((answer) => latestAnswers.set(String(answer.question?._id), answer));

  // Compute score from one answer per question — ts.score is reset to 0 on finish for retake purposes
  const totalMarks = questions.reduce((sum, question) => sum + (question.score || 0), 0);
  const score = [...latestAnswers.values()].reduce(
    (sum, answer) => sum + (answer.isCorrect ? (answer.question?.score || 0) : 0),
    0
  );

  // Build answer lookup
  const answerMap = {};
  latestAnswers.forEach((a) => {
    answerMap[String(a.question._id)] = {
      selected: a.selectedOption,
      isCorrect: a.isCorrect
    };
  });

  // Combine questions with student answers
  // Same question and option order the student saw during the test
  const results = orderForStudent(ts, questions).map(({ question: q, optionOrder }) => ({
    _id: q._id,
    optionOrder,
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
    totalMarks,
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
