const router = require('express').Router();
const ctrl = require('../controllers/teacherController');
const { requireAuth } = require('../middleware/auth');

router.post('/login', ctrl.login);
router.get('/me', requireAuth('teacher'), ctrl.me);
router.post('/logout', requireAuth('teacher'), ctrl.logout);

module.exports = router;
