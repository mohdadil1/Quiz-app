const Class = require('../models/Class');
const StudentRecord = require('../models/StudentRecord');
const Test = require('../models/Test');

// Sort USNs like "1AB21CS2" before "1AB21CS10"
const USN_ORDER = { locale: 'en', numericOrdering: true };

// Expand a USN range such as 1AB21CS001..1AB21CS060 — same prefix, trailing digits incremented
// with the start's zero padding preserved. Returns { usns } or { error }.
function expandUsnRange(start, end) {
  const a = String(start).trim().toUpperCase().match(/^(.*?)(\d+)$/);
  const b = String(end).trim().toUpperCase().match(/^(.*?)(\d+)$/);
  if (!a || !b) return { error: 'Starting and ending USN must end in digits' };
  if (a[1] !== b[1]) return { error: `Starting and ending USN must share the same prefix (${a[1]} vs ${b[1]})` };
  const from = Number(a[2]);
  const to = Number(b[2]);
  if (to < from) return { error: 'Ending USN must be after starting USN' };
  if (to - from >= 1000) return { error: 'USN range too large (max 1000 students)' };
  const usns = [];
  for (let n = from; n <= to; n++) usns.push(a[1] + String(n).padStart(a[2].length, '0'));
  return { usns };
}

// Every class endpoint only sees the logged-in teacher's own classes
const ownClass = (id, req) => Class.findOne({ _id: id, teacher: req.user.id });

// GET /api/classes
exports.listClasses = async (req, res) => {
  const classes = await Class.find({ teacher: req.user.id }).sort({ name: 1 });
  res.json(classes);
};

// POST /api/classes  { name, startingRollNumber?, endingRollNumber? }
// The range is a pair of USNs (e.g. 1AB21CS001 / 1AB21CS060). Omit both to create an empty class.
exports.createClass = async (req, res) => {
  const { name, startingRollNumber, endingRollNumber } = req.body;
  if (!name) return res.status(400).json({ message: 'name required' });
  const hasStart = startingRollNumber != null && String(startingRollNumber).trim() !== '';
  const hasEnd = endingRollNumber != null && String(endingRollNumber).trim() !== '';
  if (hasStart !== hasEnd) {
    return res.status(400).json({ message: 'Provide both starting and ending USN, or neither' });
  }

  let usns = [];
  if (hasStart) {
    const range = expandUsnRange(startingRollNumber, endingRollNumber);
    if (range.error) return res.status(400).json({ message: range.error });
    usns = range.usns;
  }

  const exists = await Class.findOne({ teacher: req.user.id, name: String(name).trim() });
  if (exists) return res.status(409).json({ message: 'Class already exists' });

  let cls;
  try {
    cls = await Class.create({ teacher: req.user.id, name });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Class already exists' });
    throw err;
  }

  const docs = usns.map((rollno) => ({ rollno, class: cls._id }));
  if (docs.length) await StudentRecord.insertMany(docs, { ordered: false });

  res.status(201).json({ class: cls, studentsCreated: docs.length });
};

// POST /api/classes/:id/students  { rollno }   — add a single extra student to a class
exports.addStudentToClass = async (req, res) => {
  const { id } = req.params;
  const { rollno, name } = req.body;
  if (!rollno) return res.status(400).json({ message: 'rollno required' });

  const cls = await ownClass(id, req);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  try {
    const student = await StudentRecord.create({ rollno: String(rollno), name: name ? String(name).trim() : null, class: cls._id });
    res.status(201).json(student);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A student with this USN already exists in this class' });
    throw err;
  }
};

// POST /api/classes/:id/students/bulk  { students: [{ rollno, name? }] } — e.g. rows from an uploaded Excel sheet.
// USNs already in the class are skipped, not overwritten.
exports.bulkAddStudents = async (req, res) => {
  const { id } = req.params;
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'students list required' });
  }
  if (students.length > 5000) return res.status(400).json({ message: 'Too many students (max 5000)' });

  const cls = await ownClass(id, req);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  // Normalise and de-duplicate within the upload itself
  const byUsn = new Map();
  for (const s of students) {
    const usn = String(s?.rollno ?? '').trim().toUpperCase();
    if (!usn) continue;
    const name = s?.name != null && String(s.name).trim() ? String(s.name).trim() : null;
    if (!byUsn.has(usn)) byUsn.set(usn, name);
  }
  if (byUsn.size === 0) return res.status(400).json({ message: 'No USNs found in the upload' });

  const existing = await StudentRecord.find({ class: cls._id, rollno: { $in: [...byUsn.keys()] } }).select('rollno').lean();
  const existingSet = new Set(existing.map((s) => s.rollno));
  const docs = [...byUsn]
    .filter(([usn]) => !existingSet.has(usn))
    .map(([rollno, name]) => ({ rollno, name, class: cls._id }));
  if (docs.length) await StudentRecord.insertMany(docs, { ordered: false });

  res.status(201).json({ added: docs.length, skipped: existingSet.size });
};

// GET /api/classes/:id/students — list students in class
exports.listStudentsInClass = async (req, res) => {
  const cls = await ownClass(req.params.id, req);
  if (!cls) return res.status(404).json({ message: 'Class not found' });
  const students = await StudentRecord.find({ class: cls._id }).sort({ rollno: 1 }).collation(USN_ORDER);
  res.json(students);
};

// GET /api/classes/data — aggregated "View Data" page: all classes with their student counts + rolls
exports.viewData = async (req, res) => {
  const classes = await Class.find({ teacher: req.user.id }).sort({ name: 1 }).lean();
  const results = [];
  for (const c of classes) {
    const students = await StudentRecord.find({ class: c._id }).sort({ rollno: 1 }).collation(USN_ORDER).lean();
    results.push({ ...c, students });
  }
  res.json(results);
};

// DELETE /api/classes/:id — removes the class and its student roster.
// Refused while any test still references the class, so test results are never orphaned.
exports.deleteClass = async (req, res) => {
  const cls = await ownClass(req.params.id, req);
  if (!cls) return res.status(404).json({ message: 'Class not found' });

  const testCount = await Test.countDocuments({ class: cls._id });
  if (testCount > 0) {
    return res.status(409).json({
      message: `Cannot delete class: ${testCount} test(s) still use it. Delete those tests first.`
    });
  }

  const { deletedCount } = await StudentRecord.deleteMany({ class: cls._id });
  await cls.deleteOne();
  res.json({ ok: true, studentsDeleted: deletedCount });
};
