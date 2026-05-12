const Teacher = require('../models/Teacher');
const Session = require('../models/Session');
const { sign } = require('../middleware/auth');
const crypto = require('crypto');

// POST /api/teachers/login
exports.login = async (req, res) => {
  const { email, password, deviceInfo } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }
  const teacher = await Teacher.findOne({ email });
  if (!teacher) return res.status(401).json({ message: 'Invalid credentials' });

  const ok = await teacher.comparePassword(password);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

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
  res.json({ token, sessionId, teacher: { id: teacher._id, email: teacher.email } });
};

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
