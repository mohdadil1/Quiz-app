const router = require('express').Router();
const ctrl = require('../controllers/teacherController');
const { requireAuth } = require('../middleware/auth');

router.post('/register/send-code', ctrl.sendSignupCode);
router.post('/register', ctrl.register);
router.post('/password/send-code', ctrl.sendPasswordResetCode);
router.post('/password/reset', ctrl.resetPassword);
router.post('/login', ctrl.login);
router.get('/me', requireAuth('teacher'), ctrl.me);
router.put('/me', requireAuth('teacher'), ctrl.updateProfile);
router.post('/me/password', requireAuth('teacher'), ctrl.changePassword);
router.post('/logout', requireAuth('teacher'), ctrl.logout);

module.exports = router;
