require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const Question = require('../models/Question');

async function seed() {
  await connectDB();

  const testId = '6a07539487bf7b892d91f27f'; // existing MOCK test id

  const questions = [
    {
      test: new mongoose.Types.ObjectId(testId),
      title: 'Which language runs in a web browser?',
      optionA: 'Java',
      optionB: 'C',
      optionC: 'Python',
      optionD: 'JavaScript',
      correctAns: 'd',
      score: 1
    },
    {
      test: new mongoose.Types.ObjectId(testId),
      title: 'What does CSS stand for?',
      optionA: 'Central Style Sheets',
      optionB: 'Cascading Style Sheets',
      optionC: 'Computer Style Sheets',
      optionD: 'Creative Style System',
      correctAns: 'b',
      score: 1
    },
    {
      test: new mongoose.Types.ObjectId(testId),
      title: 'Which HTML tag is used for the largest heading?',
      optionA: '<h1>',
      optionB: '<heading>',
      optionC: '<head>',
      optionD: '<title>',
      correctAns: 'a',
      score: 1
    }
  ];

  try {
    const created = await Question.insertMany(questions);
    console.log(`[seed] inserted ${created.length} questions for test ${testId}`);
  } catch (err) {
    console.error('[seed] error inserting questions:', err.message);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
}

seed();
