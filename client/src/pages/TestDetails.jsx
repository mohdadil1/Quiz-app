import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';

export default function TestDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState(null);
  const [msg, setMsg] = useState(null); // { type, text }
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [guestRoll, setGuestRoll] = useState('');
  const [guestName, setGuestName] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const fileInputRef = useRef();

  const load = async () => {
    try {
      const { data } = await api.get(`/tests/${id}`);
      setTest(data);
    } catch (e) {
      setMsg({ type: 'error', text: 'Could not load test' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const saveGeneral = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/tests/${id}`, {
        name: test.name,
        subject: test.subject,
        date: test.date,
        totalQuestions: test.totalQuestions,
        status: test.status
      });
      setMsg({ type: 'success', text: 'General settings updated successfully' });
    } catch {
      setMsg({ type: 'error', text: 'Error updating settings' });
    }
  };

  const markCompleted = async () => {
    if (!confirm('Mark this test as completed? Students will no longer be able to take it.')) return;
    try {
      await api.post(`/tests/${id}/complete`);
      setMsg({ type: 'success', text: 'Test completed successfully' });
      setTimeout(() => navigate('/admin/dashboard'), 1200);
    } catch {
      setMsg({ type: 'error', text: 'Error updating status' });
    }
  };

  const deleteTest = async () => {
    if (!confirm('Delete this test permanently? All questions and student entries will be removed.')) return;
    try {
      await api.delete(`/tests/${id}`);
      setMsg({ type: 'success', text: 'Test deleted' });
      setTimeout(() => navigate('/admin/dashboard'), 1000);
    } catch {
      setMsg({ type: 'error', text: 'Error deleting test' });
    }
  };

  const addGuest = async (e) => {
    e.preventDefault();
    if (!guestRoll) return;
    try {
      await api.post(`/tests/${id}/guest-student`, { rollno: Number(guestRoll), name: guestName.trim() || undefined });
      setGuestRoll('');
      setGuestName('');
      setMsg({ type: 'success', text: 'Student added successfully' });
    } catch {
      setMsg({ type: 'error', text: 'Error adding student' });
    }
  };

  const deleteQuestion = async (qid) => {
    if (!confirm('Delete this question?')) return;
    try {
      await api.delete(`/questions/${qid}`);
      load();
    } catch {
      setMsg({ type: 'error', text: 'Error deleting question' });
    }
  };

  const editQuestion = (question) => {
    setEditingQuestion({ ...question });
  };

  const saveEditedQuestion = async () => {
    if (!editingQuestion) return;
    try {
      await api.put(`/questions/${editingQuestion._id}`, {
        title: editingQuestion.title,
        optionA: editingQuestion.optionA,
        optionB: editingQuestion.optionB,
        optionC: editingQuestion.optionC,
        optionD: editingQuestion.optionD,
        correctAns: editingQuestion.correctAns,
        score: editingQuestion.score
      });
      setEditingQuestion(null);
      setMsg({ type: 'success', text: 'Question updated successfully' });
      load();
    } catch (error) {
      setMsg({ type: 'error', text: error?.response?.data?.message || 'Error updating question' });
    }
  };

  const uploadFile = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return setMsg({ type: 'error', text: 'Please select a file first' });
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const { data } = await api.post(`/questions/upload?testId=${id}`, fd);
      setShowUpload(false);
      fileInputRef.current.value = '';
      setMsg({
        type: data.errors?.length ? 'info' : 'success',
        text: `Imported ${data.created} question(s)` +
          (data.errors?.length ? `, ${data.errors.length} row(s) skipped` : '')
      });
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e?.response?.data?.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <TeacherLayout title="Test Details"><div className="empty-state">Loading…</div></TeacherLayout>;
  if (!test) return <TeacherLayout title="Test Details"><div className="empty-state">Not found</div></TeacherLayout>;

  return (
    <TeacherLayout title="Test Details">
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="row row-2">
        {/* General settings */}
        <div className="card">
          <div className="card-header"><h3>General Settings</h3></div>
          <div className="card-body">
            <form onSubmit={saveGeneral}>
              <div className="form-group">
                <label>Test name</label>
                <input className="form-control" value={test.name} onChange={(e) => setTest({ ...test, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Subject</label>
                <input className="form-control" value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" className="form-control" value={test.date?.slice(0, 10)} onChange={(e) => setTest({ ...test, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Total questions</label>
                <input type="number" min="1" className="form-control" value={test.totalQuestions} onChange={(e) => setTest({ ...test, totalQuestions: Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select className="form-control" value={test.status} onChange={(e) => setTest({ ...test, status: e.target.value })}>
                  <option value="PENDING">PENDING</option>
                  <option value="RUNNING">RUNNING</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary btn-block">UPDATE</button>
            </form>
          </div>
        </div>

        {/* Other settings */}
        <div className="card">
          <div className="card-header"><h3>Other Settings</h3></div>
          <div className="card-body">
            <div className="row row-2">
              <button className="btn btn-primary" onClick={markCompleted}>MARK COMPLETED</button>
              <button className="btn btn-danger" onClick={deleteTest}>DELETE TEST</button>
            </div>
            <Link to={`/admin/tests/${id}/credentials`} className="btn btn-primary btn-block mt-2">
              GET STUDENT DATA
            </Link>
            <form onSubmit={addGuest} className="mt-3">
              <div className="form-group">
                <label>Add guest student to test</label>
                <input
                  type="number"
                  className="form-control"
                  value={guestRoll}
                  onChange={(e) => setGuestRoll(e.target.value)}
                  placeholder="Roll number"
                />
              </div>
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Student name (optional)"
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block">ADD</button>
            </form>
          </div>
        </div>
      </div>

      {/* Questions */}
      <div className="card">
        <div className="card-header">
          <h3>Test Questions ({test.questions?.length || 0})</h3>
          <div className="flex flex-gap">
            <button className="btn btn-secondary" onClick={() => setShowUpload(true)}>UPLOAD</button>
            <Link to={`/admin/tests/${id}/add-question`} className="btn btn-primary">ADD NEW QUESTION</Link>
          </div>
        </div>
        <div className="card-body">
          {test.questions?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>A</th>
                    <th>B</th>
                    <th>C</th>
                    <th>D</th>
                    <th>Correct</th>
                    <th>Score</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {test.questions.map((q, i) => (
                    <tr key={q._id}>
                      <td>{i + 1}</td>
                      <td>{q.title}</td>
                      <td>{q.optionA}</td>
                      <td>{q.optionB}</td>
                      <td>{q.optionC}</td>
                      <td>{q.optionD}</td>
                      <td>{q.correctAns?.toUpperCase()}</td>
                      <td>{q.score}</td>
                      <td>
                        <button className="btn btn-primary btn-sm mr-1" onClick={() => editQuestion(q)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteQuestion(q._id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><h5>No questions yet</h5></div>
          )}
        </div>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }} onClick={() => setShowUpload(false)}>
          <div className="card" style={{ maxWidth: 500, width: '90%', margin: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header"><h3>Import Spreadsheet</h3></div>
            <div className="card-body">
              <p className="text-muted mb-2">
                <strong>Columns (no header row):</strong> Question, Option A, Option B, Option C, Option D, Correct Option, Score.
              </p>
              <p className="text-muted mb-2"><strong>Accepted formats:</strong> .xls, .xlsx, .ods</p>
              <input type="file" ref={fileInputRef} accept=".xls,.xlsx,.ods" className="form-control mb-2" />
              <div className="flex flex-gap">
                <button className="btn btn-secondary" onClick={() => setShowUpload(false)} disabled={uploading}>Close</button>
                <button className="btn btn-primary" onClick={uploadFile} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit question modal */}
      {editingQuestion && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }} onClick={() => setEditingQuestion(null)}>
          <div className="card" style={{ maxWidth: 600, width: '90%', margin: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header"><h3>Edit Question</h3></div>
            <div className="card-body">
              <form onSubmit={(e) => { e.preventDefault(); saveEditedQuestion(); }}>
                <div className="form-group">
                  <label>Question</label>
                  <textarea
                    className="form-control"
                    value={editingQuestion.title}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, title: e.target.value })}
                    required
                  />
                </div>
                <div className="row row-2">
                  <div className="form-group">
                    <label>Option A</label>
                    <input
                      className="form-control"
                      value={editingQuestion.optionA}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, optionA: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Option B</label>
                    <input
                      className="form-control"
                      value={editingQuestion.optionB}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, optionB: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="row row-2">
                  <div className="form-group">
                    <label>Option C</label>
                    <input
                      className="form-control"
                      value={editingQuestion.optionC}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, optionC: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Option D</label>
                    <input
                      className="form-control"
                      value={editingQuestion.optionD}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, optionD: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="row row-2">
                  <div className="form-group">
                    <label>Correct Answer</label>
                    <select
                      className="form-control"
                      value={editingQuestion.correctAns}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAns: e.target.value })}
                      required
                    >
                      <option value="a">A</option>
                      <option value="b">B</option>
                      <option value="c">C</option>
                      <option value="d">D</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Score</label>
                    <input
                      type="number"
                      min="0"
                      className="form-control"
                      value={editingQuestion.score}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, score: Number(e.target.value) })}
                      required
                    />
                  </div>
                </div>
                <div className="flex flex-gap">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingQuestion(null)}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={saveEditedQuestion}>Save Changes</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
