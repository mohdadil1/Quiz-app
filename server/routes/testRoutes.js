const router = require('express').Router();
const ctrl = require('../controllers/testController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth('teacher'));

router.get('/', ctrl.listTests);
router.post('/', ctrl.createTest);
router.get('/:id', ctrl.getTest);
router.put('/:id', ctrl.updateTest);
router.delete('/:id', ctrl.deleteTest);
router.post('/:id/complete', ctrl.completeTest);
router.post('/:id/guest-student', ctrl.addGuestStudent);
router.get('/:id/credentials', ctrl.listCredentials);
router.put('/:id/students/:studentId', ctrl.updateStudentRecord);
router.delete('/:id/students/:studentId', ctrl.deleteStudentRecord);
router.get('/:id/scoreboard', ctrl.scoreboard);
router.get('/:id/question-stats', ctrl.questionStats);

module.exports = router;
