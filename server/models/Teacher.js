const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const teacherSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    gender: { type: String, enum: ['', 'male', 'female', 'other', 'prefer-not-to-say'], default: '' },
    // Profile picture as a small data: URL (resized in the browser) — kept in the DB since Vercel has no disk
    avatar: { type: String, default: '' },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true }
  },
  { timestamps: true }
);

// Hash on save if modified
teacherSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

teacherSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('Teacher', teacherSchema);
