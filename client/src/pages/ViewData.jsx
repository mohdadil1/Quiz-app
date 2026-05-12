import { useEffect, useState } from 'react';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function ViewData() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/classes/data').then((r) => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <TeacherLayout title="View Data"><div className="empty-state">Loading…</div></TeacherLayout>;

  return (
    <TeacherLayout title="View Data">
      {data.length === 0 ? (
        <div className="card">
          <div className="card-body"><div className="empty-state"><h5>No classes yet</h5></div></div>
        </div>
      ) : (
        data.map((c) => (
          <div key={c._id} className="card">
            <div className="card-header">
              <h3>{c.name}</h3>
              <span className="text-muted">{c.students.length} students</span>
            </div>
            <div className="card-body">
              {c.students.length === 0 ? (
                <div className="text-muted">No students</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>#</th><th>Roll Number</th></tr>
                    </thead>
                    <tbody>
                      {c.students.map((s, i) => (
                        <tr key={s._id}>
                          <td>{i + 1}</td>
                          <td>{s.rollno}</td>
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
