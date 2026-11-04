import { useEffect, useState } from 'react';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

const DEFAULT_SORT = { key: 'rollno', dir: 'asc' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Sort students by 'rollno' or 'name'; blank names always go last regardless of direction
function sortStudents(students, { key, dir }) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...students].sort((a, b) => {
    const x = (a[key] ?? '').toString().trim();
    const y = (b[key] ?? '').toString().trim();
    if (!x || !y) return !x && !y ? 0 : !x ? 1 : -1;
    return sign * collator.compare(x, y);
  });
}

export default function ViewData() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [sortByClass, setSortByClass] = useState({}); // classId -> { key, dir }

  const toggleSort = (classId, key) => {
    setSortByClass((prev) => {
      const cur = prev[classId] || DEFAULT_SORT;
      const dir = cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
      return { ...prev, [classId]: { key, dir } };
    });
  };

  const SortHeader = ({ classId, sortKey, label }) => {
    const cur = sortByClass[classId] || DEFAULT_SORT;
    const active = cur.key === sortKey;
    return (
      <th
        onClick={() => toggleSort(classId, sortKey)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        aria-sort={active ? (cur.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title={`Sort by ${label}`}
      >
        {label} <span className={active ? '' : 'text-muted'}>{active ? (cur.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    );
  };

  useEffect(() => {
    api.get('/classes/data').then((r) => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (c) => {
    if (!confirm(`Delete class "${c.name}" and its ${c.students.length} students? This cannot be undone.`)) return;
    setError('');
    setDeletingId(c._id);
    try {
      await api.delete(`/classes/${c._id}`);
      setData((prev) => prev.filter((x) => x._id !== c._id));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete class');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <TeacherLayout title="View Data" showBack><div className="empty-state">Loading…</div></TeacherLayout>;

  return (
    <TeacherLayout title="View Data" showBack>
      {error && <div className="alert alert-error">{error}</div>}
      {data.length === 0 ? (
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
                        <SortHeader classId={c._id} sortKey="rollno" label="USN" />
                        <SortHeader classId={c._id} sortKey="name" label="Name" />
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
    </TeacherLayout>
  );
}
