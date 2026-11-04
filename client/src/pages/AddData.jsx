import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

const NEW_CLASS = '__new__';

// Read the first sheet of an Excel/CSV file into [{ rollno, name }].
// Uses the "USN"/"Roll" and "Name" header columns if present, else columns A and B.
async function parseStudentSheet(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  const cell = (v) => String(v ?? '').trim();
  let usnCol = 0;
  let nameCol = 1;
  let start = 0;
  const headerIdx = rows.findIndex((r) => r.some((v) => /^(usn|roll)/i.test(cell(v))));
  if (headerIdx !== -1) {
    const header = rows[headerIdx].map(cell);
    usnCol = header.findIndex((h) => /^(usn|roll)/i.test(h));
    nameCol = header.findIndex((h) => /name/i.test(h));
    start = headerIdx + 1;
  }

  return rows.slice(start)
    .map((r) => ({ rollno: cell(r[usnCol]).toUpperCase(), name: nameCol >= 0 ? cell(r[nameCol]) : '' }))
    .filter((s) => s.rollno);
}

export default function AddData() {
  const [classes, setClasses] = useState([]);
  const [msg, setMsg] = useState(null);

  const [extra, setExtra] = useState({ classId: '', rollno: '', name: '' });
  const [upload, setUpload] = useState({ classId: '', newClassName: '' });
  const [parsed, setParsed] = useState(null); // { fileName, students: [{ rollno, name }] }
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const loadClasses = () => api.get('/classes').then((r) => setClasses(r.data)).catch(() => {});

  useEffect(() => { loadClasses(); }, []);

  const submitExtra = async (e) => {
    e.preventDefault();
    if (!extra.classId) return setMsg({ type: 'error', text: 'Select a class' });
    try {
      await api.post(`/classes/${extra.classId}/students`, { rollno: extra.rollno.trim(), name: extra.name.trim() || undefined });
      setMsg({ type: 'success', text: 'Student added successfully' });
      setExtra({ classId: '', rollno: '', name: '' });
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.message || 'Failed to add student' });
    }
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    setParsed(null);
    if (!file) return;
    try {
      const students = await parseStudentSheet(file);
      if (students.length === 0) {
        setMsg({ type: 'error', text: 'No USNs found in the file. Put USNs in a column headed "USN".' });
        return;
      }
      setParsed({ fileName: file.name, students });
      setMsg(null);
    } catch {
      setMsg({ type: 'error', text: 'Could not read that file. Upload an .xlsx, .xls or .csv file.' });
    }
  };

  const submitUpload = async (e) => {
    e.preventDefault();
    if (!parsed) return setMsg({ type: 'error', text: 'Choose a file first' });
    const isNew = upload.classId === NEW_CLASS;
    if (!upload.classId) return setMsg({ type: 'error', text: 'Select a class' });
    if (isNew && !upload.newClassName.trim()) return setMsg({ type: 'error', text: 'Enter a name for the new class' });

    setUploading(true);
    try {
      let classId = upload.classId;
      let className = classes.find((c) => c._id === classId)?.name;
      if (isNew) {
        const { data } = await api.post('/classes', { name: upload.newClassName.trim() });
        classId = data.class._id;
        className = data.class.name;
      }
      const { data } = await api.post(`/classes/${classId}/students/bulk`, { students: parsed.students });
      setMsg({
        type: 'success',
        text: `Added ${data.added} students to "${className}"` + (data.skipped ? ` (${data.skipped} already existed, skipped)` : '')
      });
      setUpload({ classId: '', newClassName: '' });
      setParsed(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadClasses();
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.message || 'Failed to upload students' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <TeacherLayout title="Add Class / Student" showBack>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="row row-2">
        <div className="card">
          <div className="card-header"><h3>Upload Student List (Excel)</h3></div>
          <div className="card-body">
            <p className="text-muted">
              Upload an .xlsx, .xls or .csv file with a <strong>USN</strong> column and an optional <strong>Name</strong> column.
              If there is no header row, the first column is read as USN and the second as Name.
            </p>
            <form onSubmit={submitUpload}>
              <div className="row row-2">
                <div className="form-group">
                  <label>Class</label>
                  <select className="form-control" value={upload.classId}
                    onChange={(e) => setUpload({ ...upload, classId: e.target.value })} required>
                    <option value="">Select class…</option>
                    <option value={NEW_CLASS}>+ Create new class</option>
                    {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>
                {upload.classId === NEW_CLASS && (
                  <div className="form-group">
                    <label>New class name</label>
                    <input className="form-control" value={upload.newClassName}
                      onChange={(e) => setUpload({ ...upload, newClassName: e.target.value })} required />
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>File</label>
                <input ref={fileInputRef} type="file" className="form-control"
                  accept=".xlsx,.xls,.csv" onChange={onFileChange} required />
              </div>
              {parsed && (
                <div className="form-group text-muted">
                  Found <strong>{parsed.students.length}</strong> students in {parsed.fileName}
                  {' '}(first: {parsed.students.slice(0, 3).map((s) => s.rollno).join(', ')}{parsed.students.length > 3 ? ', …' : ''})
                </div>
              )}
              <button type="submit" className="btn btn-primary btn-block" disabled={uploading || !parsed}>
                {uploading ? 'UPLOADING…' : 'UPLOAD STUDENTS'}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Add Extra Student to Existing Class</h3></div>
          <div className="card-body">
            <form onSubmit={submitExtra}>
              <div className="form-group">
                <label>Class</label>
                <select className="form-control" value={extra.classId}
                  onChange={(e) => setExtra({ ...extra, classId: e.target.value })} required>
                  <option value="">Select class…</option>
                  {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>USN</label>
                <input type="text" className="form-control" placeholder="e.g. 1AB21CS061" value={extra.rollno}
                  onChange={(e) => setExtra({ ...extra, rollno: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input type="text" className="form-control" value={extra.name}
                  onChange={(e) => setExtra({ ...extra, name: e.target.value })} placeholder="Student name (optional)" />
              </div>
              <button type="submit" className="btn btn-primary btn-block">ADD STUDENT</button>
            </form>
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}
