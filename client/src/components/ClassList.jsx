import { useEffect, useState } from 'react';
import api from '../api/client';
import SortHeader, { DEFAULT_SORT, sortStudents, nextSort } from './SortHeader';

// Every class with its students (shown at the bottom of Add Class / Student).
// Reloads whenever `refreshKey` changes; calls `onClassDeleted` after a class is removed.
export default function ClassList({ refreshKey = 0, onClassDeleted = () => {} }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [sortByClass, setSortByClass] = useState({}); // classId -> { key, dir }

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
                      </tr>
                    </thead>
                    <tbody>
                      {sortStudents(c.students, sortByClass[c._id] || DEFAULT_SORT).map((s, i) => (
                        <tr key={s._id}>
                          <td>{i + 1}</td>
                          <td>{s.rollno}</td>
                          <td>{s.name || <span className="text-muted">—</span>}</td>
                        </tr>
                      ))}
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
