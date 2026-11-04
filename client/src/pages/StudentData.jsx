import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

// Pick a test to view its student credentials (USN, password, violations)
export default function StudentData() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/tests')
      .then((r) => setTests(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <TeacherLayout title="Get Student Data" showBack>
      <div className="card">
        <div className="card-header"><h3>Select a Test</h3></div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : tests.length === 0 ? (
            <div className="empty-state"><h5>No tests yet</h5></div>
          ) : (
            tests.map((t) => (
              <div key={t._id} className="item-card" onClick={() => navigate(`/admin/tests/${t._id}/credentials`)}>
                <div className="flex-between">
                  <div>
                    <h5>{t.name}</h5>
                    <div className="item-meta">
                      <span>Subject: {t.subject}</span>
                      <span>Class: {t.class?.name || '—'}</span>
                    </div>
                  </div>
                  <div className="text-right text-muted">
                    <span className={`badge badge-${t.status.toLowerCase()}`}>{t.status}</span>
                    <div>{new Date(t.date).toLocaleDateString()}</div>
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
