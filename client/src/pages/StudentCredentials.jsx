import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function StudentCredentials() {
  const { id } = useParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingStudentId, setEditingStudentId] = useState(null);
  const [editRollno, setEditRollno] = useState('');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/tests/${id}/credentials`)
      .then((r) => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handlePrint = () => window.print();

  const handleRefresh = () => {
    setLoading(true);
    setError('');
    api.get(`/tests/${id}/credentials`)
      .then((r) => setRows(r.data))
      .catch(() => setError('Failed to refresh'))
      .finally(() => setLoading(false));
  };

  const handleDownloadCSV = () => {
    const header = 'Roll Number,Name,Password\n';
    const body = rows.map((r) => `${r.rollno},${r.name || ''},${r.password}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credentials-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TeacherLayout
      title="Student Credentials"
      actions={
        <>
          <button className="btn btn-secondary" onClick={handleRefresh} disabled={loading}>Refresh</button>
          <button className="btn btn-secondary" onClick={handleDownloadCSV}>Download CSV</button>
          <button className="btn btn-primary" onClick={handlePrint}>Print</button>
        </>
      }
    >
      <style>{`
        @media print {
          body, html { min-height: auto !important; height: auto !important; background: #fff !important; }
          .app-shell, .main, .content { min-height: auto !important; height: auto !important; overflow: visible !important; }
          .sidebar, .topbar, .topbar-right, .btn, .btn-primary, .btn-secondary, .btn-danger, .flex-gap { display: none !important; }
          .content { padding: 20px !important; }
          .card { box-shadow: none !important; overflow: visible !important; page-break-inside: avoid !important; }
          .table-wrap { overflow: visible !important; }
          .table { width: 100% !important; border-collapse: collapse !important; }
          .table thead { display: table-header-group !important; }
          .table tfoot { display: table-footer-group !important; }
          .table tr { page-break-inside: avoid !important; break-inside: avoid-column !important; }
          .table th, .table td { box-shadow: none !important; }
        }
        .badge-in-progress {
          background-color: lightgreen;
          color: #000;
        }
        .badge-logged-in {
          background-color: lightblue;
          color: #000;
        }
      `}</style>

      <div className="card">
        <div className="card-header">
          <h3>Login Credentials</h3>
          <span className="text-muted">{rows.length} student(s)</span>
        </div>
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state"><h5>No students in this test</h5></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Roll Number</th>
                    <th>Name</th>
                    <th>Password</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const isEditing = editingStudentId === r.studentId;
                    return (
                      <tr key={r.testStudentId || r.studentId || i}>
                        <td>{i + 1}</td>
                        <td>
                          {isEditing ? (
                            <input
                              type="number"
                              className="form-control"
                              value={editRollno}
                              onChange={(e) => setEditRollno(e.target.value)}
                            />
                          ) : (
                            r.rollno
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              className="form-control"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                            />
                          ) : (
                            r.name || '-'
                          )}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.password}</td>
                        <td>
                          <span className={`badge badge-${r.submitted ? 'completed' : r.active && r.started ? 'in-progress' : r.active ? 'logged-in' : 'pending'}`}>
                            {r.submitted ? 'Submitted' : r.active && r.started ? 'In Progress' : r.active ? 'Logged In' : 'Not started'}
                          </span>
                        </td>
                        <td>{r.score}</td>
                        <td>
                          {isEditing ? (
                            <div className="flex flex-gap">
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={saving}
                                onClick={async () => {
                                  setError('');
                                  setSaving(true);
                                  try {
                                    const { data } = await api.put(`/tests/${id}/students/${r.studentId}`, {
                                      rollno: editRollno === '' ? undefined : Number(editRollno),
                                      name: editName.trim()
                                    });
                                    setRows(rows.map((row) => row.studentId === r.studentId ? {
                                      ...row,
                                      rollno: data.rollno,
                                      name: data.name
                                    } : row));
                                    setEditingStudentId(null);
                                  } catch (e) {
                                    setError(e?.response?.data?.message || 'Failed to update student');
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              >
                                Save
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setEditingStudentId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                disabled={saving}
                                onClick={async () => {
                                  if (!confirm('Delete this student entry from the test?')) return;
                                  setError('');
                                  setSaving(true);
                                  try {
                                    await api.delete(`/tests/${id}/students/${r.testStudentId}`);
                                    setRows(rows.filter((row) => row.testStudentId !== r.testStudentId));
                                    setEditingStudentId(null);
                                  } catch (e) {
                                    setError(e?.response?.data?.message || 'Failed to delete student');
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-gap">
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setEditingStudentId(r.studentId);
                                  setEditRollno(r.rollno ?? '');
                                  setEditName(r.name || '');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={async () => {
                                  if (!confirm('Delete this student entry from the test?')) return;
                                  setError('');
                                  try {
                                    await api.delete(`/tests/${id}/students/${r.testStudentId}`);
                                    setRows(rows.filter((row) => row.testStudentId !== r.testStudentId));
                                  } catch (e) {
                                    setError(e?.response?.data?.message || 'Failed to delete student');
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
