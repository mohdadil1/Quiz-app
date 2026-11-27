import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

const PAGE = 10; // past tests shown at a time

const openCredentials = (navigate, t) => navigate(`/admin/tests/${t._id}/credentials`);
const onCardKey = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

// Pick a test to view its student credentials (USN, status, violations).
// Active tests are listed first; completed ones are folded into "Past tests", where
// they can be searched and deleted so the history doesn't grow without end.
export default function StudentData() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/tests')
      .then((r) => setTests(r.data))
      .catch(() => setMsg({ type: 'error', text: 'Could not load tests' }))
      .finally(() => setLoading(false));
  }, []);

  const active = tests.filter((t) => t.status !== 'COMPLETED');
  const past = tests.filter((t) => t.status === 'COMPLETED');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return past;
    return past.filter((t) =>
      [t.name, t.subject, t.class?.name].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [past, query]);
  const shown = matches.slice(0, limit);
  const allShownSelected = shown.length > 0 && shown.every((t) => selected.has(t._id));

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllShown = () => setSelected((prev) => {
    const next = new Set(prev);
    shown.forEach((t) => (allShownSelected ? next.delete(t._id) : next.add(t._id)));
    return next;
  });

  // Deleting removes each test with its questions, student entries and results
  const deleteTests = async (list) => {
    if (!list.length) return;
    const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} past tests`;
    if (!confirm(`Delete ${what}?\n\nThis permanently removes the test${list.length === 1 ? '' : 's'}, the questions and every student's results. This cannot be undone.`)) return;
    setMsg(null);
    setDeleting(true);
    const results = await Promise.allSettled(list.map((t) => api.delete(`/tests/${t._id}`)));
    const gone = new Set(list.filter((_, i) => results[i].status === 'fulfilled').map((t) => t._id));
    setTests((prev) => prev.filter((t) => !gone.has(t._id)));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    const failed = list.length - gone.size;
    setMsg(failed
      ? { type: 'error', text: `Deleted ${gone.size}, but ${failed} could not be deleted. Try again.` }
      : { type: 'success', text: list.length === 1 ? `Deleted ${what}` : `Deleted ${gone.size} past tests` });
    setDeleting(false);
  };

  const selectedTests = past.filter((t) => selected.has(t._id));

  return (
    <TeacherLayout title="Get Student Data" showBack>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-header">
          <h3>Active Tests</h3>
          {!loading && <span className="text-muted">{active.length}</span>}
        </div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : active.length === 0 ? (
            <div className="empty-state">
              <h5>No active tests</h5>
              {past.length > 0 && <p className="text-muted">Finished tests are under Past Tests below.</p>}
            </div>
          ) : (
            active.map((t) => (
              <div
                key={t._id}
                className="item-card"
                role="button"
                tabIndex={0}
                onClick={() => openCredentials(navigate, t)}
                onKeyDown={onCardKey(() => openCredentials(navigate, t))}
              >
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

      {!loading && past.length > 0 && (
        <div className="card past-tests">
          <button
            type="button"
            className="past-tests-toggle"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            <span className={`past-tests-chevron ${showPast ? 'is-open' : ''}`} aria-hidden="true">▸</span>
            <span className="past-tests-title">Past Tests</span>
            <span className="past-tests-count">{past.length}</span>
            <span className="text-muted past-tests-hint">{showPast ? 'Hide' : 'Show'}</span>
          </button>

          {showPast && (
            <div className="card-body">
              <div className="past-tests-toolbar">
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search by test, subject or class"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
                />
                <label className="form-check past-tests-selectall">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} disabled={!shown.length} />
                  <span>Select shown</span>
                </label>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={deleting || !selectedTests.length}
                  onClick={() => deleteTests(selectedTests)}
                >
                  {deleting ? 'Deleting…' : `Delete selected${selectedTests.length ? ` (${selectedTests.length})` : ''}`}
                </button>
              </div>

              {matches.length === 0 ? (
                <div className="empty-state"><h5>No past tests match "{query}"</h5></div>
              ) : (
                <ul className="past-list">
                  {shown.map((t) => (
                    <li key={t._id} className={`past-row ${selected.has(t._id) ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.name}`}
                        checked={selected.has(t._id)}
                        onChange={() => toggle(t._id)}
                      />
                      <button type="button" className="past-row-main" onClick={() => openCredentials(navigate, t)}>
                        <span className="past-row-name">{t.name}</span>
                        <span className="past-row-meta text-muted">
                          {t.subject} · {t.class?.name || '—'} · {new Date(t.date).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm past-row-delete"
                        disabled={deleting}
                        onClick={() => deleteTests([t])}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {matches.length > shown.length && (
                <div className="text-center mt-3">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more ({matches.length - shown.length} left)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </TeacherLayout>
  );
}
