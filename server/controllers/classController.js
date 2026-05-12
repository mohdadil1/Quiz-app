const Class = require('../models/Class');
const StudentRecord = require('../models/StudentRecord');

// GET /api/classes
exports.listClasses = async (req, res) => {
  const classes = await Class.find().sort({ name: 1 });
  res.json(classes);
};

// POST /api/classes  { name, startingRollNumber, endingRollNumber }
exports.createClass = async (req, res) => {
  const { name, startingRollNumber, endingRollNumber } = req.body;
  if (!name || startingRollNumber == null || endingRollNumber == null) {
    return res.status(400).json({ message: 'name, startingRollNumber, endingRollNumber required' });
  }
  if (Number(endingRollNumber) < Number(startingRollNumber)) {
    return res.status(400).json({ message: 'endingRollNumber must be >= startingRollNumber' });
  }

  const exists = await Class.findOne({ name });
  if (exists) return res.status(409).json({ message: 'Class already exists' });

  const cls = await Class.create({ name });

  const docs = [];
  for (let r = Number(startingRollNumber); r <= Number(endingRollNumber); r++) {
    docs.push({ rollno: r, class: cls._id });
  }
  if (docs.length) await StudentRecord.insertMany(docs, { ordered: false });

  res.status(201).json({ class: cls, studentsCreated: docs.length });
};

// POST /api/classes/:id/students  { rollno }   — add a single extra student to a class
exports.addStudentToClass = async (req, res) => {
  const { id } = req.params;
  const { rollno, name } = req.body;
  if (!rollno) return res.status(400).json({ message: 'rollno required' });

  const cls = await Class.findById(id);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const student = await StudentRecord.create({ rollno, name: name ? String(name).trim() : null, class: cls._id });
  res.status(201).json(student);
};

// GET /api/classes/:id/students — list students in class
exports.listStudentsInClass = async (req, res) => {
  const { id } = req.params;
  const students = await StudentRecord.find({ class: id }).sort({ rollno: 1 });
  res.json(students);
};

// GET /api/classes/data — aggregated "View Data" page: all classes with their student counts + rolls
exports.viewData = async (req, res) => {
  const classes = await Class.find().sort({ name: 1 }).lean();
  const results = [];
  for (const c of classes) {
    const students = await StudentRecord.find({ class: c._id }).sort({ rollno: 1 }).lean();
    results.push({ ...c, students });
  }
  res.json(results);
};
