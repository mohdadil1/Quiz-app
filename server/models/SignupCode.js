const mongoose = require('mongoose');

/**
 * Email verification code for teacher signup — one pending code per email.
 * Only a hash of the code is stored; MongoDB removes the document once it expires.
 */
const signupCodeSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

signupCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SignupCode', signupCodeSchema);
