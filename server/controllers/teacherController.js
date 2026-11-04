const Teacher = require('../models/Teacher');
const Session = require('../models/Session');
const { sign } = require('../middleware/auth');
const crypto = require('crypto');
const SignupCode = require('../models/SignupCode');
const { sendMail } = require('../config/mailer');

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const publicTeacher = (t) => ({ id: t._id, email: t.email, name: t.name || '' });
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const CODE_TTL_MS = 10 * 60 * 1000;   // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // at most one email per minute per address
const MAX_CODE_ATTEMPTS = 5;          // wrong guesses before the code is cancelled

// POST /api/teachers/register/send-code  { email } — emails a 6-digit signup verification code
exports.sendSignupCode = async (req, res) => {
  const email = normaliseEmail(req.body.email);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (await Teacher.findOne({ email })) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }

  const existing = await SignupCode.findOne({ email });
  if (existing && Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.updatedAt.getTime())) / 1000);
    return res.status(429).json({ message: `Please wait ${wait}s before requesting another code` });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await SignupCode.findOneAndUpdate(
    { email },
    { codeHash: hashCode(code), attempts: 0, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await sendMail({
      to: email,
      subject: `Your Quizora verification code: ${code}`,
      text: `Your Quizora teacher signup code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Your Quizora teacher signup code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`
    });
  } catch (err) {
    console.error('[mail] failed to send signup code', err);
    await SignupCode.deleteOne({ email });
    return res.status(502).json({ message: 'Could not send the verification email. Try again later.' });
  }

  res.json({ ok: true, expiresInSeconds: CODE_TTL_MS / 1000 });
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

  const pending = await SignupCode.findOne({ email });
  if (!pending || pending.expiresAt < new Date()) {
    return res.status(400).json({ message: 'Verification code expired. Request a new code.' });
  }
  const given = Buffer.from(hashCode(String(code).trim()));
  const expected = Buffer.from(pending.codeHash);
  if (!crypto.timingSafeEqual(given, expected)) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      await pending.deleteOne();
      return res.status(400).json({ message: 'Too many wrong attempts. Request a new code.' });
    }
    await pending.save();
    return res.status(400).json({ message: 'Incorrect verification code' });
  }
  await pending.deleteOne();

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
  res.json(teacher);
};

// POST /api/teachers/logout
exports.logout = async (req, res) => {
  if (req.user.sessionId) {
    await Session.deleteOne({ sessionId: req.user.sessionId });
  }
  res.json({ ok: true });
};
