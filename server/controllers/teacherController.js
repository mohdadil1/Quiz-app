const Teacher = require('../models/Teacher');
const Session = require('../models/Session');
const { sign } = require('../middleware/auth');
const crypto = require('crypto');
const { SignupCode, PasswordResetCode } = require('../models/EmailCode');
const { sendMail } = require('../config/mailer');

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const publicTeacher = (t) => ({ id: t._id, email: t.email, name: t.name || '', gender: t.gender || '', avatar: t.avatar || '' });
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const CODE_TTL_MS = 10 * 60 * 1000;   // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // at most one email per minute per address
const MAX_CODE_ATTEMPTS = 5;          // wrong guesses before the code is cancelled

// Create a fresh 6-digit code for `email` and mail it. Returns null on success, else { status, message }.
async function issueCode(Model, email, purpose) {
  const existing = await Model.findOne({ email });
  if (existing && Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.updatedAt.getTime())) / 1000);
    return { status: 429, message: `Please wait ${wait}s before requesting another code` };
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await Model.findOneAndUpdate(
    { email },
    { codeHash: hashCode(code), attempts: 0, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await sendMail({
      to: email,
      subject: `Your Quizora ${purpose} code: ${code}`,
      text: `Your Quizora ${purpose} code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Your Quizora ${purpose} code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`
    });
  } catch (err) {
    console.error(`[mail] failed to send ${purpose} code`, err);
    await Model.deleteOne({ email });
    return { status: 502, message: 'Could not send the email. Try again later.' };
  }
  return null;
}

// Check (and on success, use up) the pending code for `email`. Returns null if valid, else { status, message }.
async function consumeCode(Model, email, code) {
  const pending = await Model.findOne({ email });
  if (!pending || pending.expiresAt < new Date()) {
    return { status: 400, message: 'Code expired. Request a new code.' };
  }
  const given = Buffer.from(hashCode(String(code).trim()));
  const expected = Buffer.from(pending.codeHash);
  if (!crypto.timingSafeEqual(given, expected)) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      await pending.deleteOne();
      return { status: 400, message: 'Too many wrong attempts. Request a new code.' };
    }
    await pending.save();
    return { status: 400, message: 'Incorrect code' };
  }
  await pending.deleteOne();
  return null;
}

// POST /api/teachers/register/send-code  { email } — emails a 6-digit signup verification code
exports.sendSignupCode = async (req, res) => {
  const email = normaliseEmail(req.body.email);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (await Teacher.findOne({ email })) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }

  const error = await issueCode(SignupCode, email, 'signup verification');
  if (error) return res.status(error.status).json({ message: error.message });
  res.json({ ok: true, expiresInSeconds: CODE_TTL_MS / 1000 });
};

// POST /api/teachers/password/send-code  { email } — emails a password reset code.
// Answers the same whether or not the account exists, so it can't be used to discover accounts.
exports.sendPasswordResetCode = async (req, res) => {
  const email = normaliseEmail(req.body.email);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });

  if (await Teacher.exists({ email })) {
    const error = await issueCode(PasswordResetCode, email, 'password reset');
    if (error) return res.status(error.status).json({ message: error.message });
  }
  res.json({ ok: true, expiresInSeconds: CODE_TTL_MS / 1000 });
};

// POST /api/teachers/password/reset  { email, code, password } — sets a new password and logs in
exports.resetPassword = async (req, res) => {
  const { code, password, deviceInfo } = req.body;
  const email = normaliseEmail(req.body.email);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (!code) return res.status(400).json({ message: 'Enter the code sent to your email' });
  if (String(password || '').length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

  const error = await consumeCode(PasswordResetCode, email, code);
  if (error) return res.status(error.status).json({ message: error.message });

  const teacher = await Teacher.findOne({ email });
  if (!teacher) return res.status(400).json({ message: 'Code expired. Request a new code.' });
  teacher.password = password; // hashed by the pre-save hook
  await teacher.save();

  // startSession also signs out every other device
  res.json(await startSession(teacher, deviceInfo, req));
};

// POST /api/teachers/register  { name, email, password, code } — code is the one emailed by send-code
exports.register = async (req, res) => {
  const { name, password, code, deviceInfo } = req.body;
  const email = normaliseEmail(req.body.email);
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  if (!code) return res.status(400).json({ message: 'Enter the verification code sent to your email' });

  if (await Teacher.findOne({ email })) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }

  const error = await consumeCode(SignupCode, email, code);
  if (error) return res.status(error.status).json({ message: error.message });

  let teacher;
  try {
    teacher = await Teacher.create({ name: name ? String(name).trim() : '', email, password });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'An account with this email already exists' });
    throw err;
  }
  res.status(201).json(await startSession(teacher, deviceInfo, req));
};

// POST /api/teachers/login
exports.login = async (req, res) => {
  const { password, deviceInfo } = req.body;
  const email = normaliseEmail(req.body.email);
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }
  const teacher = await Teacher.findOne({ email });
  if (!teacher) return res.status(401).json({ message: 'Invalid credentials' });

  const ok = await teacher.comparePassword(password);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  res.json(await startSession(teacher, deviceInfo, req));
};

async function startSession(teacher, deviceInfo, req) {
  // Invalidate old sessions for this teacher (single session per teacher)
  await Session.deleteMany({ teacher: teacher._id });

  // Create new session
  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = await Session.create({
    sessionId,
    teacher: teacher._id,
    deviceInfo: deviceInfo || {},
    ipAddress: req.ip || req.connection.remoteAddress
  });

  const token = sign({ id: teacher._id.toString(), role: 'teacher', email: teacher.email, sessionId });
  return { token, sessionId, teacher: publicTeacher(teacher) };
}

// GET /api/teachers/me
exports.me = async (req, res) => {
  const teacher = await Teacher.findById(req.user.id).select('-password');
  if (!teacher) return res.status(404).json({ message: 'Not found' });
  res.json(publicTeacher(teacher));
};

const GENDERS = ['', 'male', 'female', 'other', 'prefer-not-to-say'];
const AVATAR_MAX_CHARS = 300 * 1024; // ~220 KB image once base64-decoded
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// PUT /api/teachers/me  { name?, gender?, avatar? } — avatar '' removes the picture
exports.updateProfile = async (req, res) => {
  const teacher = await Teacher.findById(req.user.id);
  if (!teacher) return res.status(404).json({ message: 'Not found' });
  const { name, gender, avatar } = req.body;

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length > 80) return res.status(400).json({ message: 'Name is too long (max 80 characters)' });
    teacher.name = trimmed;
  }
  if (gender !== undefined) {
    if (!GENDERS.includes(gender)) return res.status(400).json({ message: 'Invalid gender' });
    teacher.gender = gender;
  }
  if (avatar !== undefined) {
    if (avatar && (avatar.length > AVATAR_MAX_CHARS || !AVATAR_PATTERN.test(avatar))) {
      return res.status(400).json({ message: 'Profile picture must be a PNG, JPEG or WebP image under 200 KB' });
    }
    teacher.avatar = avatar || '';
  }

  await teacher.save();
  res.json(publicTeacher(teacher));
};

// POST /api/teachers/me/password  { currentPassword, newPassword } — keeps this session, signs out other devices
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Current and new password required' });
  if (String(newPassword).length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });

  const teacher = await Teacher.findById(req.user.id);
  if (!teacher) return res.status(404).json({ message: 'Not found' });
  if (!(await teacher.comparePassword(currentPassword))) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }

  teacher.password = newPassword; // hashed by the pre-save hook
  await teacher.save();
  await Session.deleteMany({ teacher: teacher._id, sessionId: { $ne: req.user.sessionId } });
  res.json({ ok: true });
};

// POST /api/teachers/logout
exports.logout = async (req, res) => {
  if (req.user.sessionId) {
    await Session.deleteOne({ sessionId: req.user.sessionId });
  }
  res.json({ ok: true });
};
