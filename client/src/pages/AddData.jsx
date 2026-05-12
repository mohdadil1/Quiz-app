import { useEffect, useState } from 'react';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function AddData() {
  const [classes, setClasses] = useState([]);
  const [msg, setMsg] = useState(null);

  const [newClass, setNewClass] = useState({ name: '', startingRollNumber: '', endingRollNumber: '' });
  const [extra, setExtra] = useState({ classId: '', rollno: '', name: '' });

  const loadClasses = () => api.get('/classes').then((r) => setClasses(r.data)).catch(() => {});

  useEffect(() => { loadClasses(); }, []);

  const submitClass = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: newClass.name,
        startingRollNumber: Number(newClass.startingRollNumber),
        endingRollNumber: Number(newClass.endingRollNumber)
      };
      const { data } = await api.post('/classes', payload);
      setMsg({ type: 'success', text: `Class "${data.class.name}" created with ${data.studentsCreated} students` });
      setNewClass({ name: '', startingRollNumber: '', endingRollNumber: '' });
      loadClasses();
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.message || 'Failed to add class' });
    }
  };

  const submitExtra = async (e) => {
    e.preventDefault();
    if (!extra.classId) return setMsg({ type: 'error', text: 'Select a class' });
    try {
      await api.post(`/classes/${extra.classId}/students`, { rollno: Number(extra.rollno), name: extra.name.trim() || undefined });
      setMsg({ type: 'success', text: 'Student added successfully' });
      setExtra({ classId: '', rollno: '', name: '' });
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.message || 'Failed to add student' });
    }
  };

  return (
    <TeacherLayout title="Add Class / Student">
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="row row-2">
        <div className="card">
          <div className="card-header"><h3>Add New Class</h3></div>
          <div className="card-body">
            <form onSubmit={submitClass}>
              <div className="form-group">
                <label>Class name</label>
                <input className="form-control" value={newClass.name}
                  onChange={(e) => setNewClass({ ...newClass, name: e.target.value })} required />
              </div>
              <div className="row row-2">
                <div className="form-group">
                  <label>Starting roll no.</label>
                  <input type="number" className="form-control" value={newClass.startingRollNumber}
                    onChange={(e) => setNewClass({ ...newClass, startingRollNumber: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Ending roll no.</label>
                  <input type="number" className="form-control" value={newClass.endingRollNumber}
                    onChange={(e) => setNewClass({ ...newClass, endingRollNumber: e.target.value })} required />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block">ADD CLASS</button>
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
                <label>Roll number</label>
                <input type="number" className="form-control" value={extra.rollno}
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
