import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function Statistics() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/tests?status=completed')
      .then((r) => setTests(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <TeacherLayout title="Statistics">
      <div className="card">
        <div className="card-header"><h3>Completed Quiz Tests</h3></div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : tests.length === 0 ? (
            <div className="empty-state"><h5>No completed tests yet</h5></div>
          ) : (
            tests.map((t) => (
              <div key={t._id} className="item-card" onClick={() => navigate(`/admin/tests/${t._id}/stats`)}>
                <div className="flex-between">
                  <div>
                    <h5>{t.name}</h5>
                    <div className="item-meta">
                      <span>Subject: {t.subject}</span>
                      <span>Class: {t.class?.name || '—'}</span>
                    </div>
                  </div>
                  <div className="text-right text-muted">
                    {new Date(t.date).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
