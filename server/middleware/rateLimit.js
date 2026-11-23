const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Brute-force protection for the login and emailed-code endpoints.
 *
 * A whole exam hall often reaches the server through one college IP, so the strict
 * limits are keyed by IP *and* account (USN or email): one student typing a wrong
 * password can't lock out everyone else, but nobody can try thousands of passwords
 * against one account. A looser per-IP limit stops one machine spraying many accounts.
 *
 * Note: the counters live in memory, so on Vercel each warm instance counts on its
 * own. That still stops casual brute-forcing; for a hard global limit plug a shared
 * store (e.g. rate-limit-redis / rate-limit-mongo) into `store`.
 */

const MINUTE = 60 * 1000;
const ip = (req) => ipKeyGenerator(req.ip || '');
const field = (req, name) => String(req.body?.[name] || '').trim().toLowerCase().slice(0, 200);

function limiter({ windowMs, limit, key, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key,
    // Only failed attempts count, so a successful login never uses up the allowance
    skipSuccessfulRequests: true,
    message: { message },
    // Never let the limiter itself take the API down
    passOnStoreError: true
  });
}

const TOO_MANY_LOGINS = 'Too many login attempts. Please wait a few minutes and try again.';
const TOO_MANY_CODES = 'Too many code requests. Please wait a while and try again.';

// Student login: 10 wrong tries per USN per IP every 15 minutes, 300 per IP (a big exam hall)
const studentLogin = [
  limiter({ windowMs: 15 * MINUTE, limit: 300, key: ip, message: TOO_MANY_LOGINS }),
  limiter({ windowMs: 15 * MINUTE, limit: 10, key: (req) => `${ip(req)}|${field(req, 'rollno')}`, message: TOO_MANY_LOGINS })
];

// Teacher login: 10 wrong tries per email every 15 minutes, 50 per IP
const teacherLogin = [
  limiter({ windowMs: 15 * MINUTE, limit: 50, key: ip, message: TOO_MANY_LOGINS }),
  limiter({ windowMs: 15 * MINUTE, limit: 10, key: (req) => `${ip(req)}|${field(req, 'email')}`, message: TOO_MANY_LOGINS })
];

// Sending emailed codes (signup / password reset): every request counts, success or not
const sendCode = [
  rateLimit({
    windowMs: 60 * MINUTE,
    limit: 5,
    keyGenerator: (req) => `send|${field(req, 'email')}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: TOO_MANY_CODES },
    passOnStoreError: true
  }),
  rateLimit({
    windowMs: 60 * MINUTE,
    limit: 30,
    keyGenerator: (req) => `send|${ip(req)}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: TOO_MANY_CODES },
    passOnStoreError: true
  })
];

// Checking a code (register / reset password): wrong guesses count
const verifyCode = [
  limiter({ windowMs: 15 * MINUTE, limit: 30, key: ip, message: TOO_MANY_LOGINS }),
  limiter({ windowMs: 15 * MINUTE, limit: 10, key: (req) => `verify|${field(req, 'email')}`, message: TOO_MANY_LOGINS })
];

module.exports = { studentLogin, teacherLogin, sendCode, verifyCode };
