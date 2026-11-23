import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';
import QuestionFields from '../components/QuestionFields';
import { emptyQuestion, questionPayload, validateQuestion } from '../components/questionTypes';

export default function AddQuestion() {
  const { id: testId } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyQuestion);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    const problem = validateQuestion(form);
    if (problem) {
      setErr(problem);
      return;
    }
    setLoading(true);
    try {
      await api.post('/questions', { testId, ...questionPayload(form) });
      navigate(`/admin/tests/${testId}`);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Failed to add question');
      setLoading(false);
    }
  };

  return (
    <TeacherLayout title="Add New Question" showBack>
      <div className="card" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card-header"><h3>New Question</h3></div>
        <div className="card-body">
          {err && <div className="alert alert-error">{err}</div>}
          <form onSubmit={handleSubmit}>
            <QuestionFields value={form} onChange={(changes) => setForm((f) => ({ ...f, ...changes }))} />
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
