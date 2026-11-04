const mongoose = require('mongoose');

/**
 * Emailed 6-digit codes — one pending code per email, per purpose (signup / password reset).
 * Only a hash of the code is stored; MongoDB removes the document once it expires.
 */
function emailCodeModel(name) {
  const schema = new mongoose.Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      codeHash: { type: String, required: true },
      attempts: { type: Number, default: 0 },
      expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
  );
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return mongoose.model(name, schema);
}

module.exports = {
  SignupCode: emailCodeModel('SignupCode'),
  PasswordResetCode: emailCodeModel('PasswordResetCode')
};
