const jwt = require('jsonwebtoken');
const Session = require('../models/Session');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const EXPIRES = process.env.JWT_EXPIRES || '7d';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

/**
 * requireAuth(roles?) — verifies the Bearer token and (optionally) checks role.
 *   requireAuth()                  → any authenticated user
 *   requireAuth('teacher')         → only teachers
 *   requireAuth(['teacher','student'])
 */
function requireAuth(roles) {
  const allowed = roles
    ? Array.isArray(roles) ? roles : [roles]
    : null;

  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing token' });

    try {
      const decoded = jwt.verify(token, SECRET);
      if (allowed && !allowed.includes(decoded.role)) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // For students, verify TestStudent is active (skip for MOCK tests)
      if (decoded.role === 'student') {
        const TestStudent = require('../models/TestStudent');
        const ts = await TestStudent.findById(decoded.testStudentId).populate('test');
        if (!ts) return res.status(401).json({ message: 'Session expired' });
        if (ts.test?.mode !== 'MOCK' && !ts.active) {
          return res.status(401).json({ message: 'Session expired' });
        }
      }

      req.user = decoded; // { id, role, sessionId, ... }
      next();
    } catch (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
}

module.exports = { sign, requireAuth };
