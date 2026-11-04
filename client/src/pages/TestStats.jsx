import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

function describeViolation(type) {
  return {
    'tab-switch': 'Switched browser tab or window',
    'fullscreen-exit': 'Exited fullscreen mode',
    'camera-disabled': 'Camera was disabled or disconnected',
    'looking-away': 'Looked away from the screen',
    'face-not-visible': 'Face not visible to the camera',
    'multiple-faces': 'More than one face in camera view'
  }[type] || type || 'Unknown violation';
}

export default function TestStats() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const load = (showLoading) => {
      if (showLoading) setLoading(true);
      api.get(`/tests/${id}/scoreboard`)
        .then((r) => { if (!cancelled) setData(r.data); })
        .catch(() => {})
        .finally(() => { if (!cancelled && showLoading) setLoading(false); });
    };
    load(true);
    const intervalId = setInterval(() => load(false), 5000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [id]);

  if (loading) return <TeacherLayout title="Test Statistics" showBack><div className="empty-state">Loading…</div></TeacherLayout>;
  if (!data) return <TeacherLayout title="Test Statistics" showBack><div className="empty-state">Not found</div></TeacherLayout>;

  return (
    <TeacherLayout
      title="Test Statistics"
      showBack
      actions={
        <>
          <Link to={`/admin/tests/${id}/question-stats`} className="btn btn-secondary">
            Question Stats
          </Link>
          <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        </>
      }
    >
      <style>{`
        @media print {
          body, html { min-height: auto !important; height: auto !important; background: #fff !important; }
          .app-shell, .main, .content { min-height: auto !important; height: auto !important; overflow: visible !important; }
          .sidebar, .topbar, .btn, .print-hide { display: none !important; }
          .content { padding: 20px !important; }
          .card { box-shadow: none !important; overflow: visible !important; }
          .table-wrap { overflow: visible !important; }
          .table { width: 100% !important; border-collapse: collapse !important; }
          .table thead { display: table-header-group !important; }
          .table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .table a { color: inherit !important; text-decoration: none !important; }
          /* Print only #, USN, Name and Score — drop Submitted?, Violations, Violation Details */
          .stats-table th:nth-child(n+5),
          .stats-table td:nth-child(n+5) { display: none !important; }
        }
      `}</style>
      <div className="card">
        <div className="card-header"><h3>{data.test.name} — {data.test.subject}</h3></div>
        <div className="card-body">
          {data.rows.length > 0 && (
            <p className="text-muted print-hide">Click a student to see their answer for every question.</p>
          )}
          {data.rows.length === 0 ? (
            <div className="empty-state"><h5>No student entries</h5></div>
          ) : (
            <div className="table-wrap">
              <table className="table stats-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>USN</th>
                    <th>Name</th>
                    <th>Score</th>
                    <th>Submitted?</th>
                    <th>Violations</th>
                    <th>Violation Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr
                      key={r.testStudentId || i}
                      onClick={() => navigate(`/admin/tests/${id}/students/${r.testStudentId}/answers`)}
                      style={{ cursor: 'pointer' }}
                      title="View this student's answers"
                    >
                      <td>{i + 1}</td>
                      <td><Link to={`/admin/tests/${id}/students/${r.testStudentId}/answers`} onClick={(e) => e.stopPropagation()}>{r.rollno}</Link></td>
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
                      <td>
                        {r.violations > 0 ? (
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                            {r.violations}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td>{(r.violationTypes || []).length ? r.violationTypes.map(describeViolation).join(', ') : '—'}</td>
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
