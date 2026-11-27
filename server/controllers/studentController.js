const crypto = require('crypto');
const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');
const TestStudent = require('../models/TestStudent');
const Question = require('../models/Question');
const StudentAnswer = require('../models/StudentAnswer');
const { sign } = require('../middleware/auth');
// The student's test entry (with its test). requireAuth has already loaded it; reuse that
// instead of reading the same documents again on every request.
function currentTestStudent(req) {
  if (req.testStudent) return req.testStudent;
  return TestStudent.findById(req.user.testStudentId).populate('test');
}

const { typeOf, gradeAnswer, optionLetters, describeAnswer, describeCorrect } = require('../utils/questionTypes');

/**
 * POST /api/students/login  { rollno, accessCode }
 *
 * Every test has one 4-digit access code (made when the test is created, shown only to
 * the teacher), so a login = (USN, access code) identifies which test this student is
 * taking. We return a JWT that embeds the testStudent id so the rest of the quiz flow
 * doesn't need the code again.
 */
// The code is digits only, so anything else (spaces, invisible characters) is dropped;
// the USN loses invisible characters and edge spaces.
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;
const cleanCode = (v) => String(v || '').replace(/\D/g, '');
const cleanRollno = (v) => String(v || '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

exports.login = async (req, res) => {
  const { name, deviceInfo } = req.body;
  const rollno = cleanRollno(req.body.rollno);
  const accessCode = cleanCode(req.body.accessCode);
  const deviceId = typeof req.body.deviceId === 'string' ? req.body.deviceId.slice(0, 100) : '';
  if (!rollno || accessCode.length !== 4) {
    return res.status(400).json({ message: 'USN and 4-digit access code required' });
  }

  // USN + access code identify the student (USN ignores case). The typed name is not checked —
  // it is only used as a display name when the record has none.
  const query = { rollno: String(rollno).trim().toUpperCase() };

  // Find any student record(s) with this USN, for class or guest students.
  const studentRecords = await StudentRecord.find(query);
  if (!studentRecords.length) {
    return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });
  }

  // Each test has its own unique code, so the code names exactly one test; the student
  // must be enrolled in it.
  const test = await Test.findOne({ accessCode }).select('_id').lean();
  const ts = test && await TestStudent.findOne({
    student: { $in: studentRecords.map(s => s._id) },
    test: test._id
  }).populate('test');

  if (!ts) return res.status(401).json({ message: 'STUDENT_RECORD_NOT_FOUND' });
  await ts.test.applySchedule();

  // A student who already submitted may log back in, but only to see "test completed" —
  // the quiz endpoints refuse submitted students, and their test entry is left untouched.
  const alreadySubmitted = ts.submitted && ts.test.mode !== 'MOCK';

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

  if (alreadySubmitted) {
    // no device lock, no "active" flag: nothing to protect any more
  } else if (ts.test.mode !== 'MOCK') {
    // STANDARD tests: one device per student. The first device that logs in owns the
    // test; logins from any other device are refused until the teacher unlocks it.
    if (ts.deviceId && deviceId !== ts.deviceId) {
      await TestStudent.updateOne(
        { _id: ts._id, submitted: false },
        { $inc: { violations: 1 }, $push: { violationTypes: 'second-device-login' } }
      );
      return res.status(409).json({ message: 'TEST_OPEN_ON_ANOTHER_DEVICE' });
    }

    if (deviceInfo) {
      ts.deviceInfo = deviceInfo;
    }
    ts.deviceId = deviceId || null;
    ts.active = true;
  } else {
    // In MOCK mode we do not enforce proctoring/device locks but we still
    // mark the TestStudent active so the JWT-backed requests are accepted.
    ts.active = true;
    ts.deviceInfo = undefined;
  }

  if (!alreadySubmitted) {
    ts.started = false;
    ts.sessionToken = crypto.randomBytes(16).toString('hex');
    await ts.save();
  }

  const token = sign({
    id: ts.student.toString(),
    role: 'student',
    testStudentId: ts._id.toString(),
    testId: ts.test._id.toString(),
    rollno,
    sid: ts.sessionToken || undefined
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
    submitted: alreadySubmitted,
    webcamProctoring: ts.test.webcamProctoring !== false,
    timingMode: ts.test.timingMode || 'PER_QUESTION',
    totalTimeMinutes: ts.test.totalTimeMinutes || 30
  });
};

// The student's own result for a standard test. Only sent once they have submitted, so a
// student never sees a score (or how many answers were right) while the test is going on.
async function scoreSummary(ts) {
  const [questions, correctAnswers] = await Promise.all([
    Question.find({ test: ts.test._id }).select('score').lean(),
    StudentAnswer.countDocuments({ testStudent: ts._id, isCorrect: true })
  ]);
  const totalMarks = questions.reduce((sum, q) => sum + (q.score || 0), 0);
  return {
    score: ts.score || 0,
    totalMarks,
    correctAnswers,
    totalQuestions: questions.length,
    percentage: totalMarks ? Math.round(((ts.score || 0) / totalMarks) * 1000) / 10 : 0
  };
}

/**
 * GET /api/students/dashboard
 * Returns the current RUNNING test for this student (if any).
 * Mirrors the old files/get_dashboard_contents.php which only showed tests in state RUNNING.
 */
exports.dashboard = async (req, res) => {
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });

  await ts.test.applySchedule();
  const running = ts.test.status === 'RUNNING';
  // For MOCK tests, show submitted if completedOnce (even if currently submitted=false for retakes)
  const submitted = ts.test.mode === 'MOCK' ? ts.completedOnce : ts.submitted;
  // Standard tests: the score appears only after the student has submitted
  const result = ts.test.mode !== 'MOCK' && ts.submitted ? await scoreSummary(ts) : null;
  res.json({
    result,
    testId: ts.test._id,
    testName: ts.test.name,
    subject: ts.test.subject,
    totalQuestions: ts.test.totalQuestions,
    running,
    submitted,
    autoSubmitted: !!ts.autoSubmitted,
    isMock: ts.test.mode === 'MOCK',
    timingMode: ts.test.timingMode || 'PER_QUESTION',
    totalTimeMinutes: ts.test.totalTimeMinutes || 30,
    webcamProctoring: ts.test.webcamProctoring !== false,
    // Schedule, so the student sees when the test opens / closes
    startAt: ts.test.startAt,
    endAt: ts.test.endAt,
    closed: ts.test.status === 'COMPLETED'
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
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });
  if (hasClosed(ts.test)) return res.status(410).json({ message: 'This test has closed' });

  // Set started to true when fetching questions
  ts.started = true;
  await ts.save();

  const questions = await Question.find({ test: ts.test._id })
    .select('type title optionA optionB optionC optionD image optionImages score timeLimit')
    .sort({ createdAt: 1 });

  res.json(orderForStudent(ts, questions).map(({ question, optionOrder }) => ({
    ...question.toObject(),
    type: typeOf(question),
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
  if (ts.test.shuffle === false) {
    return questions.map((question) => ({ question, optionOrder: optionLetters(question) }));
  }
  const random = seededRandom(String(ts._id));
  return shuffled(questions, random).map((question) => ({
    question,
    // True/False keeps True first; numeric questions have no options
    optionOrder: ['MCQ', 'MULTI'].includes(typeOf(question))
      ? shuffled(optionLetters(question), random)
      : optionLetters(question)
  }));
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
  let deadline = ts.startedAt.getTime() + (test.totalTimeMinutes || 30) * 60 * 1000;
  // A scheduled close time cuts the countdown short
  // (not when the teacher has reopened it by hand after it closed)
  if (test.endAt && !(test.autoEnded && test.status === 'RUNNING')) {
    deadline = Math.min(deadline, new Date(test.endAt).getTime());
  }
  return deadline - Date.now();
}

// True once a scheduled test's end time (plus the network grace) has passed — unless the
// teacher set it back to RUNNING by hand after it closed
function hasClosed(test, graceMs = 0) {
  if (!test.endAt || Date.now() <= new Date(test.endAt).getTime() + graceMs) return false;
  return !(test.autoEnded && test.status === 'RUNNING');
}

/**
 * POST /api/quiz/start
 * Records when the student pressed Start (only the first time), and for total-time
 * tests returns how much time is left — the server owns the deadline, so a reload
 * or a changed clock can't buy extra time.
 */
exports.startQuiz = async (req, res) => {
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });
  if (hasClosed(ts.test)) return res.status(410).json({ message: 'This test has closed' });

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
 * selectedOption is 'b' (single choice / true-false), 'ac' or ['a','c'] (multiple correct)
 * or the typed number (numeric). Checks the answer, updates this question's
 * correct/wrong counters and the student's running score.
 */
exports.submitAnswer = async (req, res) => {
  const { questionId } = req.body;
  const selectedOption = req.body.selectedOption ?? req.body.answer;

  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.submitted) return res.status(410).json({ message: 'Already submitted' });
  const left = remainingMs(ts, ts.test);
  if (left !== null && left < -TOTAL_TIME_GRACE_MS) {
    return res.status(410).json({ message: 'Time is up' });
  }
  if (hasClosed(ts.test, TOTAL_TIME_GRACE_MS)) {
    return res.status(410).json({ message: 'This test has closed' });
  }

  // One read: the question must belong to this student's test
  const q = await Question.findOne({ _id: questionId, test: ts.test._id })
    .select('type correctAns correctNumber tolerance score')
    .lean();
  if (!q) return res.status(404).json({ message: 'Question not found in your test' });

  const graded = gradeAnswer(q, selectedOption);
  if (graded.error) return res.status(400).json({ message: graded.error });
  const correct = graded.correct;

  // The unique (testStudent, question) index makes a second answer fail here, so there's
  // no need to look for an existing answer first
  try {
    await StudentAnswer.create({
      testStudent: ts._id,
      question: q._id,
      selectedOption: graded.value,
      isCorrect: correct
    });
  } catch (error) {
    if (error.code === 11000) {
      const answer = await StudentAnswer.findOne({ testStudent: ts._id, question: q._id }).select('isCorrect').lean();
      return res.json({ correct: answer.isCorrect, alreadyAnswered: true });
    }
    throw error;
  }

  // Atomic increments: hundreds of students answering the same question at once must
  // not overwrite each other's counts (read-modify-save would lose updates)
  await Promise.all([
    Question.updateOne({ _id: q._id }, { $inc: correct ? { correctCount: 1 } : { wrongCount: 1 } }),
    correct ? TestStudent.updateOne({ _id: ts._id }, { $inc: { score: q.score || 0 } }) : null
  ]);

  // Tell the client whether it was right, but not the correct answer
  res.json({ correct });
};

/**
 * POST /api/quiz/finish  { aborted?: boolean, autoSubmitted?: boolean }
 * Marks the TestStudent as submitted. Idempotent — safe to call twice.
 */
exports.finish = async (req, res) => {
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  // Already submitted (e.g. logged back in afterwards): keep the original result as it is
  if (ts.submitted && ts.test.mode !== 'MOCK') {
    return res.json({ ok: true, alreadySubmitted: true, score: ts.score, result: await scoreSummary(ts) });
  }
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
  res.json({
    ok: true,
    aborted: !!req.body.aborted,
    score: ts.score,
    result: ts.test.mode !== 'MOCK' ? await scoreSummary(ts) : null
  });
};

/**
 * POST /api/quiz/violation  { type: string }
 * Increments the violation counter for anti-cheat tracking (tab switches,
 * fullscreen exits, etc). Returns the new count so the client can decide
 * whether to force-submit.
 */
const VIOLATION_TYPES = new Set([
  'tab-switch', 'assistant-opened', 'focus-lost', 'fullscreen-exit', 'second-device-login',
  'camera-disabled', 'looking-away', 'face-not-visible', 'multiple-faces', 'screenshot', 'screen-recording'
]);
// A warning first recorded as "left the screen" can turn out to be a tab switch once the
// browser reports the page hidden (phones report that late). Only these corrections are allowed.
const RELABEL_FROM = new Set(['assistant-opened', 'focus-lost']);

exports.logViolation = async (req, res) => {
  const type = VIOLATION_TYPES.has(req.body.type) ? req.body.type : 'unknown';
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.test.mode === 'MOCK') {
    return res.json({ violations: 0, submitted: false });
  }

  // { type: 'tab-switch', relabelFrom: 'assistant-opened' } — fix the label of the most
  // recent warning without counting a new one (works after auto-submit too)
  if (req.body.relabelFrom !== undefined) {
    const from = req.body.relabelFrom;
    const last = ts.violationTypes.length - 1;
    if (type === 'tab-switch' && RELABEL_FROM.has(from) && last >= 0 && ts.violationTypes[last] === from) {
      await TestStudent.updateOne(
        { _id: ts._id, [`violationTypes.${last}`]: from },
        { $set: { [`violationTypes.${last}`]: type } }
      );
    }
    return res.json({ violations: ts.violations || 0, submitted: ts.submitted, relabelled: true });
  }

  if (ts.submitted) return res.json({ violations: ts.violations, submitted: true });

  const updated = await TestStudent.findOneAndUpdate(
    { _id: ts._id, submitted: false },
    { $inc: { violations: 1 }, $push: { violationTypes: type } },
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
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  if (ts.test.mode !== 'MOCK') return res.status(403).json({ message: 'Not available for standard tests' });

  // Get all questions for this test with correct answers
  const questions = await Question.find({ test: ts.test._id })
    .select('type title optionA optionB optionC optionD image optionImages correctAns correctNumber tolerance score')
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
  const results = orderForStudent(ts, questions).map(({ question: q, optionOrder }) => {
    const studentAnswer = answerMap[String(q._id)] || { selected: null, isCorrect: false };
    return {
      _id: q._id,
      type: typeOf(q),
      optionOrder,
      title: q.title,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      image: q.image || '',
      optionImages: q.optionImages,
      correctAns: q.correctAns,
      correctNumber: q.correctNumber,
      tolerance: q.tolerance,
      correctText: describeCorrect(q),
      score: q.score,
      studentAnswer: { ...studentAnswer, text: describeAnswer(q, studentAnswer.selected) }
    };
  });

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
  const ts = await currentTestStudent(req);
  if (!ts) return res.status(404).json({ message: 'Not found' });
  ts.active = false;
  await ts.save();
  res.json({ ok: true });
};
