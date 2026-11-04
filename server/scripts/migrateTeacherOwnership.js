/**
 * One-off migration for per-teacher accounts. Safe to run more than once.
 *
 *  1. Gives every class without an owner to the teacher whose tests use it most
 *     (or the oldest teacher account if no test uses it).
 *  2. Gives every guest (classless) student record an owner from the tests it is enrolled in.
 *     A guest shared by several teachers' tests is split into one record per teacher.
 *  3. Replaces the old global unique indexes (class name; rollno + class) with per-teacher ones.
 *
 *   node scripts/migrateTeacherOwnership.js --dry-run   # report only
 *   node scripts/migrateTeacherOwnership.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');
const Class = require('../models/Class');
const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');
const TestStudent = require('../models/TestStudent');

const OLD_INDEXES = [
  [Class, 'name_1'],
  [StudentRecord, 'rollno_1_class_1']
];

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const log = (msg) => console.log(`[migrate]${dryRun ? ' (dry run)' : ''} ${msg}`);
  await mongoose.connect(process.env.MONGO_URI);

  const fallbackTeacher = await Teacher.findOne().sort({ createdAt: 1 });
  if (!fallbackTeacher) throw new Error('No teacher accounts exist');

  // 1. Classes
  const orphanClasses = await Class.collection.find({ teacher: { $exists: false } }).toArray();
  for (const cls of orphanClasses) {
    const [top] = await Test.aggregate([
      { $match: { class: cls._id } },
      { $group: { _id: '$teacher', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 1 }
    ]);
    const owner = top?._id || fallbackTeacher._id;
    log(`class "${cls.name}" -> teacher ${owner}`);
    if (!dryRun) await Class.collection.updateOne({ _id: cls._id }, { $set: { teacher: owner } });
  }

  // 2. Guest students
  const guests = await StudentRecord.collection.find({ class: null, teacher: { $in: [null, undefined] } }).toArray();
  let assigned = 0;
  let split = 0;
  let unused = 0;
  for (const g of guests) {
    const enrolments = await TestStudent.find({ student: g._id }).populate('test', 'teacher').lean();
    const byTeacher = new Map();
    for (const e of enrolments) {
      const tid = e.test?.teacher ? String(e.test.teacher) : null;
      if (!tid) continue;
      if (!byTeacher.has(tid)) byTeacher.set(tid, []);
      byTeacher.get(tid).push(e._id);
    }
    if (byTeacher.size === 0) { unused += 1; continue; }

    const [firstTeacher, ...others] = [...byTeacher.keys()];
    assigned += 1;
    if (!dryRun) {
      await StudentRecord.collection.updateOne({ _id: g._id }, { $set: { teacher: new mongoose.Types.ObjectId(firstTeacher) } });
    }
    for (const tid of others) {
      split += 1;
      if (dryRun) continue;
      const copy = await StudentRecord.collection.insertOne({
        rollno: g.rollno, name: g.name ?? null, class: null,
        teacher: new mongoose.Types.ObjectId(tid), createdAt: new Date(), updatedAt: new Date()
      });
      await TestStudent.updateMany({ _id: { $in: byTeacher.get(tid) } }, { $set: { student: copy.insertedId } });
    }
  }
  log(`guest students: ${assigned} assigned, ${split} split per teacher, ${unused} not in any test (left as is)`);

  // 3. Indexes
  for (const [Model, name] of OLD_INDEXES) {
    const exists = (await Model.collection.indexes()).some((ix) => ix.name === name);
    if (!exists) continue;
    log(`drop index ${Model.collection.collectionName}.${name}`);
    if (!dryRun) await Model.collection.dropIndex(name);
  }
  if (!dryRun) {
    await Class.syncIndexes();
    await StudentRecord.syncIndexes();
    log('per-teacher indexes created');
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('[migrate] error:', err);
  process.exit(1);
});
