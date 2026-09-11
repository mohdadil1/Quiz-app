import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

function describeViolation(type) {
  return {
    'tab-switch': 'Switched browser tab or window',
    'fullscreen-exit': 'Exited fullscreen mode',
    'camera-disabled': 'Camera was disabled or disconnected'
  }[type] || type || 'Unknown violation';
}

export default function TestStats() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tests/${id}/scoreboard`)
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <TeacherLayout title="Test Statistics"><div className="empty-state">Loading…</div></TeacherLayout>;
  if (!data) return <TeacherLayout title="Test Statistics"><div className="empty-state">Not found</div></TeacherLayout>;

  return (
    <TeacherLayout
      title="Test Statistics"
      actions={
        <Link to={`/admin/tests/${id}/question-stats`} className="btn btn-secondary">
          Question Stats
        </Link>
      }
    >
      <div className="card">
        <div className="card-header"><h3>{data.test.name} — {data.test.subject}</h3></div>
        <div className="card-body">
          {data.rows.length === 0 ? (
            <div className="empty-state"><h5>No student entries</h5></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Roll No</th>
                    <th>Name</th>
                    <th>Score</th>
                    <th>Submitted?</th>
                    <th>Violations</th>
                    <th>Violation Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{r.rollno}</td>
                      <td>{r.name || '—'}</td>
                      <td>{r.score}</td>
                      <td>
                        {r.submitted ? (
                          r.autoSubmitted ? (
                            <span className="badge" style={{ background: '#fde2e2', color: '#a02020' }}>
                              Auto-submitted
                            </span>
                          ) : (
                            <span className="badge badge-completed">Yes</span>
                          )
                        ) : (
                          <span className="badge badge-pending">No</span>
                        )}
                      </td>
                      <td>{(r.violationTypes || []).length ? r.violationTypes.map(describeViolation).join(', ') : '—'}</td>
                      <td>
                        {r.violations > 0 ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                            {r.violations}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
