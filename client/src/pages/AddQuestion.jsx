import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function AddQuestion() {
  const { id: testId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    correctAns: 'A',
    score: 1
  });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      await api.post('/questions', { testId, ...form, score: Number(form.score) });
      navigate(`/admin/tests/${testId}`);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to add question');
      setLoading(false);
    }
  };

  return (
    <TeacherLayout title="Add New Question">
      <div className="card" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card-header"><h3>New Question</h3></div>
        <div className="card-body">
          {err && <div className="alert alert-error">{err}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Question title</label>
              <input className="form-control" value={form.title} onChange={update('title')} required />
            </div>
            <div className="row row-2">
              <div className="form-group">
                <label>Option A</label>
                <input className="form-control" value={form.optionA} onChange={update('optionA')} required />
              </div>
              <div className="form-group">
                <label>Option B</label>
                <input className="form-control" value={form.optionB} onChange={update('optionB')} required />
              </div>
              <div className="form-group">
                <label>Option C</label>
                <input className="form-control" value={form.optionC} onChange={update('optionC')} required />
              </div>
              <div className="form-group">
                <label>Option D</label>
                <input className="form-control" value={form.optionD} onChange={update('optionD')} required />
              </div>
            </div>
            <div className="row row-2">
              <div className="form-group">
                <label>Correct answer</label>
                <select className="form-control" value={form.correctAns} onChange={update('correctAns')}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                </select>
              </div>
              <div className="form-group">
                <label>Score</label>
                <input type="number" min="1" className="form-control" value={form.score} onChange={update('score')} required />
              </div>
            </div>
            <div className="text-center">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Adding…' : 'ADD QUESTION'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </TeacherLayout>
  );
}
