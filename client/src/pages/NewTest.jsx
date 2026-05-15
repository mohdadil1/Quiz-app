import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function NewTest() {
  const [classes, setClasses] = useState([]);
  const [form, setForm] = useState({
    name: '',
    subject: '',
    date: '',
    totalQuestions: '',
    status: 'PENDING',
    mode: 'STANDARD',
    classId: ''
  });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/classes').then((r) => setClasses(r.data)).catch(() => {});
  }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.classId) return setErr('Please select a class');
    setLoading(true);
    try {
      const { data } = await api.post('/tests', {
        ...form,
        totalQuestions: Number(form.totalQuestions)
      });
      navigate(`/admin/tests/${data._id}`);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to create test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TeacherLayout title="Create New Test">
      <div className="card" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card-header"><h3>New Test</h3></div>
        <div className="card-body">
          {err && <div className="alert alert-error">{err}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Test name (title)</label>
              <input className="form-control" value={form.name} onChange={update('name')} required />
            </div>
            <div className="form-group">
              <label>Subject name</label>
              <input className="form-control" value={form.subject} onChange={update('subject')} required />
            </div>
            <div className="form-group">
              <label>Test date</label>
              <input type="date" className="form-control" value={form.date} onChange={update('date')} required />
            </div>
            <div className="form-group">
              <label>Total questions count</label>
              <input type="number" min="1" className="form-control" value={form.totalQuestions} onChange={update('totalQuestions')} required />
            </div>
            <div className="row row-2">
              <div className="form-group">
                <label>Test status</label>
                <select className="form-control" value={form.status} onChange={update('status')}>
                  <option value="PENDING">PENDING</option>
                  <option value="RUNNING">RUNNING</option>
                </select>
              </div>
              <div className="form-group">
                <label>Test mode</label>
                <select className="form-control" value={form.mode} onChange={update('mode')}>
                  <option value="STANDARD">STANDARD</option>
                  <option value="MOCK">MOCK</option>
                </select>
              </div>
            </div>
            <div className="row row-2">
              <div className="form-group">
                <label>Class</label>
                <select className="form-control" value={form.classId} onChange={update('classId')} required>
                  <option value="">Select class…</option>
                  {classes.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="text-center mt-2">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Creating…' : 'CREATE TEST'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </TeacherLayout>
  );
}
