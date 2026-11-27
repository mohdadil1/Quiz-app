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
  // Classes start folded; ids of the ones the teacher opened
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggleOpen = (id) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOpen = data.length > 0 && data.every((c) => openIds.has(c._id));
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(data.map((c) => c._id)));

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
      <div className="class-list-head">
        <h2 className="section-title">Classes and Students</h2>
        {data.length > 1 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {loading ? (
        <div className="card"><div className="card-body"><div className="empty-state">Loading…</div></div></div>
      ) : data.length === 0 ? (
        <div className="card">
          <div className="card-body"><div className="empty-state"><h5>No classes yet</h5></div></div>
        </div>
      ) : (
        data.map((c) => {
          const open = openIds.has(c._id);
          return (
          <div key={c._id} className={`card class-card ${open ? 'is-open' : ''}`}>
            <div className="card-header class-card-header">
              <button
                type="button"
                className="class-card-toggle"
                aria-expanded={open}
                aria-controls={`class-${c._id}`}
                onClick={() => toggleOpen(c._id)}
              >
                <span className="class-card-chevron" aria-hidden="true">▸</span>
                <h3>{c.name}</h3>
                <span className="class-card-count">{c.students.length} {c.students.length === 1 ? 'student' : 'students'}</span>
              </button>
              <div className="flex flex-gap" style={{ alignItems: 'center' }}>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={deletingId === c._id}
                  onClick={() => handleDelete(c)}
                >
                  {deletingId === c._id ? 'Deleting…' : 'Delete Class'}
                </button>
              </div>
            </div>
            {open && (
            <div className="card-body" id={`class-${c._id}`}>
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
            )}
          </div>
          );
        })
      )}
    </section>
  );
}
