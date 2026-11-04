/**
 * Seeds a completed demo test with student answers, for trying out Statistics → Student Answers.
 * Creates (or recreates) "Demo Class" with 5 demo students and a COMPLETED "Demo Quiz" with 5 questions.
 * Touches nothing outside those two records.
 *
 *   node scripts/seedDemoResults.js            # create / refresh the demo
 *   node scripts/seedDemoResults.js --remove   # delete the demo test, class and students
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');
const Class = require('../models/Class');
const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');
const Question = require('../models/Question');
const TestStudent = require('../models/TestStudent');
const StudentAnswer = require('../models/StudentAnswer');

const CLASS_NAME = 'Demo Class';
const TEST_NAME = 'Demo Quiz';

const QUESTIONS = [
  { title: 'What is the capital of India?', optionA: 'Mumbai', optionB: 'New Delhi', optionC: 'Kolkata', optionD: 'Chennai', correctAns: 'b', score: 1 },
  { title: 'Which data structure works on LIFO (Last In, First Out)?', optionA: 'Queue', optionB: 'Array', optionC: 'Stack', optionD: 'Tree', correctAns: 'c', score: 2 },
  { title: 'What does HTML stand for?', optionA: 'HyperText Markup Language', optionB: 'High Transfer Machine Language', optionC: 'Hyperlink Text Management Language', optionD: 'Home Tool Markup Language', correctAns: 'a', score: 1 },
  { title: 'What is 12 × 8?', optionA: '86', optionB: '92', optionC: '108', optionD: '96', correctAns: 'd', score: 1 },
  { title: 'Which of these is NOT a programming language?', optionA: 'Python', optionB: 'Java', optionC: 'Photoshop', optionD: 'C++', correctAns: 'c', score: 2 }
];

// One row per student: the option chosen for each question in order (null = not answered)
const STUDENTS = [
  { rollno: 'DEMO26CS001', name: 'Aarav Sharma', answers: ['b', 'c', 'a', 'd', 'c'], violations: [] },
  { rollno: 'DEMO26CS002', name: 'Diya Patel', answers: ['b', 'a', 'a', 'd', 'c'], violations: [] },
  { rollno: 'DEMO26CS003', name: 'Rohan Iyer', answers: ['a', 'c', 'b', null, 'c'], violations: ['tab-switch'] },
  { rollno: 'DEMO26CS004', name: 'Sneha Reddy', answers: ['b', 'c', 'a', 'b', 'a'], violations: [] },
  { rollno: 'DEMO26CS005', name: 'Kabir Khan', answers: ['c', 'b', null, null, 'd'], violations: ['tab-switch', 'fullscreen-exit'], autoSubmitted: true }
];

async function removeDemo() {
  const cls = await Class.findOne({ name: CLASS_NAME });
  const tests = await Test.find({ name: TEST_NAME, ...(cls ? { class: cls._id } : {}) });
  for (const t of tests) {
    const tsIds = (await TestStudent.find({ test: t._id }).select('_id')).map((x) => x._id);
    await StudentAnswer.deleteMany({ testStudent: { $in: tsIds } });
    await TestStudent.deleteMany({ test: t._id });
    await Question.deleteMany({ test: t._id });
    await t.deleteOne();
  }
  if (cls) {
    await StudentRecord.deleteMany({ class: cls._id });
    await cls.deleteOne();
  }
  console.log(`[demo] removed ${tests.length} demo test(s)${cls ? ' and the demo class' : ''}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await removeDemo();
  if (process.argv.includes('--remove')) return mongoose.disconnect();

  const teacher = await Teacher.findOne().sort({ createdAt: 1 });
  if (!teacher) throw new Error('No teacher account found — run `npm run seed` first');

  const cls = await Class.create({ teacher: teacher._id, name: CLASS_NAME });
  const records = await StudentRecord.insertMany(
    STUDENTS.map((s) => ({ rollno: s.rollno, name: s.name, class: cls._id }))
  );

  const test = await Test.create({
    teacher: teacher._id,
    name: TEST_NAME,
    subject: 'General Knowledge',
    date: new Date(),
    totalQuestions: QUESTIONS.length,
    class: cls._id,
    status: 'COMPLETED',
    webcamProctoring: false
  });
  const questions = await Question.insertMany(QUESTIONS.map((q) => ({ ...q, test: test._id })));

  for (const [i, s] of STUDENTS.entries()) {
    let score = 0;
    const answerDocs = [];
    s.answers.forEach((opt, qi) => {
      if (!opt) return;
      const q = questions[qi];
      const isCorrect = opt === q.correctAns;
      if (isCorrect) { score += q.score; q.correctCount += 1; } else { q.wrongCount += 1; }
      answerDocs.push({ question: q._id, selectedOption: opt, isCorrect });
    });

    const ts = await TestStudent.create({
      test: test._id,
      student: records[i]._id,
      password: Math.random().toString(36).slice(2, 10),
      score,
      submitted: true,
      started: true,
      completedOnce: true,
      autoSubmitted: !!s.autoSubmitted,
      violations: s.violations.length,
      violationTypes: s.violations
    });
    await StudentAnswer.insertMany(answerDocs.map((a) => ({ ...a, testStudent: ts._id })));
  }
  await Promise.all(questions.map((q) => q.save()));

  console.log(`[demo] created "${TEST_NAME}" (COMPLETED) for ${teacher.email || teacher._id} — ${QUESTIONS.length} questions, ${STUDENTS.length} students`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('[demo] error:', err);
  process.exit(1);
});
