/**
 * Seed script — creates a default teacher and a sample class (CS-A) with 5 students.
 * Safe to run multiple times — upserts where possible.
 *
 *   node seed.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Teacher = require('./models/Teacher');
const Class = require('./models/Class');
const StudentRecord = require('./models/StudentRecord');

(async () => {
  await connectDB();
  try {
    // Default teacher
    const email = 'admin@example.com';
    let teacher = await Teacher.findOne({ email });
    if (!teacher) {
      teacher = new Teacher({ email, password: 'admin' });
      await teacher.save();
      console.log(`[seed] created teacher: ${email} / admin`);
    } else {
      console.log(`[seed] teacher "${email}" already exists`);
    }

    // Sample class
    const className = 'CS-A';
    let cls = await Class.findOne({ name: className });
    if (!cls) {
      cls = await Class.create({ name: className });
      console.log(`[seed] created class: ${className}`);
    } else {
      console.log(`[seed] class "${className}" already exists`);
    }

    // Sample students with roll numbers 1..5 (skip any that already exist for this class)
    for (let r = 1; r <= 5; r++) {
      const exists = await StudentRecord.findOne({ rollno: r, class: cls._id });
      if (!exists) {
        await StudentRecord.create({ rollno: r, class: cls._id });
        console.log(`[seed]   + student roll ${r}`);
      }
    }

    console.log('[seed] done');
  } catch (err) {
    console.error('[seed] error:', err);
  } finally {
    await mongoose.connection.close();
  }
})();
