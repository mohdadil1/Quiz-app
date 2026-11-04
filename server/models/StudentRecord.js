const mongoose = require('mongoose');

/**
 * StudentRecord is the persistent roster of students (was `student_data` in PHP).
 * Each record has a USN (stored in `rollno`, e.g. "1AB21CS001") and belongs to a Class.
 * A per-test entry is stored separately in TestStudent (was `students` table).
 * Guest students (class = null) carry `teacher` instead, so each teacher's guests stay private.
 */
const studentRecordSchema = new mongoose.Schema(
  {
    rollno: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, trim: true, default: null },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null }
  },
  { timestamps: true }
);

studentRecordSchema.index({ rollno: 1, class: 1, teacher: 1 }, { unique: true });

module.exports = mongoose.model('StudentRecord', studentRecordSchema);
