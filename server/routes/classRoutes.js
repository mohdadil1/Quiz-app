const router = require('express').Router();
const ctrl = require('../controllers/classController');
const { requireAuth } = require('../middleware/auth');

// Listing classes is open to both teachers and authenticated students (not needed, but harmless)
router.get('/', requireAuth('teacher'), ctrl.listClasses);
router.get('/data', requireAuth('teacher'), ctrl.viewData);
router.post('/', requireAuth('teacher'), ctrl.createClass);
router.get('/:id/students', requireAuth('teacher'), ctrl.listStudentsInClass);
router.post('/:id/students', requireAuth('teacher'), ctrl.addStudentToClass);

module.exports = router;
