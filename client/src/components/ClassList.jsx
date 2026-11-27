import { useEffect, useState } from 'react';
import api from '../api/client';
import SortHeader, { DEFAULT_SORT, sortStudents, nextSort } from './SortHeader';

// Every class with its students (shown at the bottom of Add Class / Student), where each
// student's USN and name can be edited and a student can be removed from the class.
// Reloads whenever `refreshKey` changes; calls `onClassDeleted` after a class is removed.
export default function ClassList({ refreshKey = 0, onClassDeleted = () => {} }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [sortByClass, setSortByClass] = useState({}); // classId -> { key, dir }
  const [editing, setEditing] = useState(null); // { classId, id, rollno, name }
  const [busyId, setBusyId] = useState(null); // student being saved or deleted
  const [notice, setNotice] = useState('');

  const setStudents = (classId, update) => setData((prev) => prev.map((c) => (
    c._id === classId ? { ...c, students: update(c.students) } : c
  )));

  const saveStudent = async () => {
    const { classId, id, rollno, name } = editing;
    if (!rollno.trim()) return setError('USN cannot be empty');
    setError('');
    setNotice('');
    setBusyId(id);
    try {
      const { data: saved } = await api.put(`/classes/${classId}/students/${id}`, { rollno: rollno.trim(), name: name.trim() });
      setStudents(classId, (list) => list.map((s) => (s._id === id ? { ...s, rollno: saved.rollno, name: saved.name } : s)));
      setEditing(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update student');
    } finally {
      setBusyId(null);
    }
  };

  const deleteStudent = async (c, s) => {
    if (!confirm(`Remove ${s.rollno}${s.name ? ` (${s.name})` : ''} from "${c.name}"?\n\nThey are also removed from tests they have not started. Results from tests they already took are kept.`)) return;
    setError('');
    setNotice('');
    setBusyId(s._id);
    try {
      const { data: result } = await api.delete(`/classes/${c._id}/students/${s._id}`);
      setStudents(c._id, (list) => list.filter((x) => x._id !== s._id));
      if (editing?.id === s._id) setEditing(null);
      setNotice(result.keptResults
        ? `Removed ${s.rollno} from "${c.name}". Their results in ${result.keptResults} test(s) are kept.`
        : `Removed ${s.rollno} from "${c.name}".`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete student');
    } finally {
      setBusyId(null);
    }
  };

  const toggleSort = (classId, key) => {
    setSortByClass((prev) => ({ ...prev, [classId]: nextSort(prev[classId] || DEFAULT_SORT, key) }));
  };

  useEffect(() => {
    let cancelled = false;
    api.get('/classes/data')
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleDelete = async (c) => {
    if (!confirm(`Delete class "${c.name}" and its ${c.students.length} students? This cannot be undone.`)) return;
    setError('');
    setDeletingId(c._id);
    try {
      await api.delete(`/classes/${c._id}`);
      setData((prev) => prev.filter((x) => x._id !== c._id));
      onClassDeleted();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete class');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="class-list">
      <h2 className="section-title">Classes and Students</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {loading ? (
        <div className="card"><div className="card-body"><div className="empty-state">Loading…</div></div></div>
      ) : data.length === 0 ? (
        <div className="card">
          <div className="card-body"><div className="empty-state"><h5>No classes yet</h5></div></div>
        </div>
      ) : (
        data.map((c) => (
          <div key={c._id} className="card">
            <div className="card-header">
              <h3>{c.name}</h3>
              <div className="flex flex-gap" style={{ alignItems: 'center' }}>
                <span className="text-muted">{c.students.length} students</span>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={deletingId === c._id}
                  onClick={() => handleDelete(c)}
                >
                  {deletingId === c._id ? 'Deleting…' : 'Delete Class'}
                </button>
              </div>
            </div>
            <div className="card-body">
              {c.students.length === 0 ? (
                <div className="text-muted">No students</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <SortHeader label="USN" sortKey="rollno" sort={sortByClass[c._id] || DEFAULT_SORT} onSort={(k) => toggleSort(c._id, k)} />
                        <SortHeader label="Name" sortKey="name" sort={sortByClass[c._id] || DEFAULT_SORT} onSort={(k) => toggleSort(c._id, k)} />
                        <th className="class-list-actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortStudents(c.students, sortByClass[c._id] || DEFAULT_SORT).map((s, i) => {
                        const isEditing = editing?.id === s._id;
                        const busy = busyId === s._id;
                        const onKey = (e) => {
                          if (e.key === 'Enter') { e.preventDefault(); saveStudent(); }
                          if (e.key === 'Escape') setEditing(null);
                        };
                        return (
                          <tr key={s._id} className={isEditing ? 'is-editing' : ''}>
                            <td>{i + 1}</td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="form-control form-control-sm"
                                  value={editing.rollno}
                                  onChange={(e) => setEditing({ ...editing, rollno: e.target.value })}
                                  onKeyDown={onKey}
                                  aria-label="USN"
                                  autoFocus
                                />
                              ) : s.rollno}
                            </td>
                            <td>
                              {isEditing ? (
                                <input
                                  className="form-control form-control-sm"
                                  value={editing.name}
                                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                                  onKeyDown={onKey}
                                  placeholder="Name (optional)"
                                  aria-label="Name"
                                />
                              ) : (s.name || <span className="text-muted">—</span>)}
                            </td>
                            <td className="class-list-actions">
                              {isEditing ? (
                                <div className="flex flex-gap">
                                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={saveStudent}>
                                    {busy ? 'Saving…' : 'Save'}
                                  </button>
                                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                                </div>
                              ) : (
                                <div className="flex flex-gap">
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    disabled={busy}
                                    onClick={() => { setError(''); setEditing({ classId: c._id, id: s._id, rollno: s.rollno, name: s.name || '' }); }}
                                  >
                                    Edit
                                  </button>
                                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => deleteStudent(c, s)}>
                                    {busy ? 'Deleting…' : 'Delete'}
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
        ))
      )}
    </section>
  );
}
