const router = require('express').Router();
const ctrl = require('../controllers/teacherController');
const { requireAuth } = require('../middleware/auth');
const limits = require('../middleware/rateLimit');

router.post('/register/send-code', limits.sendCode, ctrl.sendSignupCode);
router.post('/register', limits.verifyCode, ctrl.register);
router.post('/password/send-code', limits.sendCode, ctrl.sendPasswordResetCode);
router.post('/password/reset', limits.verifyCode, ctrl.resetPassword);
router.post('/login', limits.teacherLogin, ctrl.login);
router.get('/me', requireAuth('teacher'), ctrl.me);
router.put('/me', requireAuth('teacher'), ctrl.updateProfile);
router.post('/me/password', requireAuth('teacher'), ctrl.changePassword);
router.post('/logout', requireAuth('teacher'), ctrl.logout);

module.exports = router;
