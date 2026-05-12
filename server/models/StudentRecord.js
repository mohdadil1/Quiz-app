const mongoose = require('mongoose');

/**
 * StudentRecord is the persistent roster of students (was `student_data` in PHP).
 * Each record has a roll number and belongs to a Class.
 * A per-test entry is stored separately in TestStudent (was `students` table).
 */
const studentRecordSchema = new mongoose.Schema(
  {
    rollno: { type: Number, required: true },
    name: { type: String, trim: true, default: null },
    class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null }
  },
  { timestamps: true }
);

studentRecordSchema.index({ rollno: 1, class: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('StudentRecord', studentRecordSchema);
