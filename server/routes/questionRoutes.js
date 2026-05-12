const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/questionController');
const { requireAuth } = require('../middleware/auth');

// Use memory storage — we just parse in-memory and never need the file on disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.use(requireAuth('teacher'));

router.post('/', ctrl.createQuestion);
router.put('/:id', ctrl.updateQuestion);
router.delete('/:id', ctrl.deleteQuestion);
router.post('/upload', upload.single('file'), ctrl.uploadQuestions);

module.exports = router;
