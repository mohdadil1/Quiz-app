/**
 * One-off migration: convert StudentRecord.rollno from Number to String (USN support).
 * Run once after deploying the USN change:  node scripts/migrateRollnoToString.js
 * Pass --dry-run to only report how many records would change.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const StudentRecord = require('../models/StudentRecord');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGO_URI);
  const coll = StudentRecord.collection;

  const numeric = await coll.countDocuments({ rollno: { $type: 'number' } });
  console.log(`[migrate] ${numeric} student record(s) with numeric rollno`);

  if (!dryRun && numeric > 0) {
    const result = await coll.updateMany(
      { rollno: { $type: 'number' } },
      [{ $set: { rollno: { $toString: '$rollno' } } }]
    );
    console.log(`[migrate] converted ${result.modifiedCount} record(s)`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('[migrate] error:', err);
  process.exit(1);
});
