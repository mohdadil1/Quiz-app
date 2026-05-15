const router = require('express').Router();
const ctrl = require('../controllers/studentController');
const { requireAuth } = require('../middleware/auth');

// Public
router.post('/login', ctrl.login);

// Authenticated student
router.get('/dashboard', requireAuth('student'), ctrl.dashboard);
router.get('/quiz/questions', requireAuth('student'), ctrl.getQuestions);
router.post('/quiz/answer', requireAuth('student'), ctrl.submitAnswer);
router.post('/quiz/finish', requireAuth('student'), ctrl.finish);
router.get('/quiz/results', requireAuth('student'), ctrl.getResults);
router.post('/quiz/violation', requireAuth('student'), ctrl.logViolation);
router.post('/logout', requireAuth('student'), ctrl.logout);

module.exports = router;
