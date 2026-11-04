const mongoose = require('mongoose');

// A class belongs to one teacher; names only need to be unique within that teacher's classes
const classSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    name: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

classSchema.index({ teacher: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Class', classSchema);
