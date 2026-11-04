import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function Statistics() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [msg, setMsg] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/tests?status=completed')
      .then((r) => setTests(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Deleting removes the test with its questions, student passwords and results
  const handleDelete = async (e, t) => {
    e.stopPropagation(); // the card itself opens the test's statistics
    if (!confirm(`Delete "${t.name}"?\n\nThis permanently removes the test, its questions and every student's results. This cannot be undone.`)) return;
    setMsg(null);
    setDeletingId(t._id);
    try {
      await api.delete(`/tests/${t._id}`);
      setTests((prev) => prev.filter((x) => x._id !== t._id));
      setMsg({ type: 'success', text: `Deleted "${t.name}"` });
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.message || 'Failed to delete test' });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <TeacherLayout title="Statistics" showBack>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
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
                  <div className="text-right text-muted flex flex-gap" style={{ alignItems: 'center' }}>
                    <span>{new Date(t.date).toLocaleDateString()}</span>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={deletingId === t._id}
                      onClick={(e) => handleDelete(e, t)}
                    >
                      {deletingId === t._id ? 'Deleting…' : 'Delete'}
                    </button>
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
