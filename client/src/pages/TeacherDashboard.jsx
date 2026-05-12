import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function TeacherDashboard() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/tests?status=active');
        setTests(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <TeacherLayout
      title="Dashboard"
      actions={
        <Link to="/admin/new-test" className="btn btn-secondary btn-responsive">
          <span className="btn-text-full">+ New Test</span>
          <span className="btn-text-short">+ New</span>
        </Link>
      }
    >
      <div className="card">
        <div className="card-header">
          <h3>Pending Quiz Tests</h3>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : tests.length === 0 ? (
            <div className="empty-state">
              <h5>No tests yet</h5>
              <p className="text-muted">Click "New Test" above to create one.</p>
            </div>
          ) : (
            tests.map((t) => (
              <div
                key={t._id}
                className="item-card"
                onClick={() => navigate(`/admin/tests/${t._id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/admin/tests/${t._id}`);
                  }
                }}
              >
                <div className="item-card-row">
                  <div className="item-card-main">
                    <h5 className="item-title">
                      <span className="item-name">{t.name}</span>
                      <span className={`badge badge-${t.status.toLowerCase()}`}>
                        {t.status}
                      </span>
                    </h5>
                    <div className="item-meta">
                      <span><strong>Subject:</strong> {t.subject}</span>
                      <span><strong>Class:</strong> {t.class?.name || '—'}</span>
                    </div>
                  </div>
                  <div className="item-card-date text-muted">
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