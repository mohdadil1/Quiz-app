import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function TestQuestionStats() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tests/${id}/question-stats`)
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <TeacherLayout title="Question Statistics"><div className="empty-state">Loading…</div></TeacherLayout>;
  if (!data) return <TeacherLayout title="Question Statistics"><div className="empty-state">Not found</div></TeacherLayout>;

  return (
    <TeacherLayout title="Question Statistics">
      <div className="card">
        <div className="card-header"><h3>{data.test.name}</h3></div>
        <div className="card-body">
          {data.questions.length === 0 ? (
            <div className="empty-state"><h5>No questions in this test</h5></div>
          ) : (
            data.questions.map((q, i) => {
              const total = q.correctCount + q.wrongCount;
              const pct = total > 0 ? Math.round((q.correctCount / total) * 100) : 0;
              return (
                <div key={q.id} className="item-card" style={{ cursor: 'default' }}>
                  <h5>Q{i + 1}. {q.title}</h5>
                  <div className="flex-between mt-2" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    <span>✓ Correct: <strong style={{ color: 'var(--success)' }}>{q.correctCount}</strong></span>
                    <span>✗ Wrong: <strong style={{ color: 'var(--danger)' }}>{q.wrongCount}</strong></span>
                    <span>Success rate: <strong>{pct}%</strong></span>
                  </div>
                  {total > 0 && (
                    <div style={{
                      marginTop: 10,
                      height: 8,
                      background: '#eee',
                      borderRadius: 4,
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: 'var(--success)',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
