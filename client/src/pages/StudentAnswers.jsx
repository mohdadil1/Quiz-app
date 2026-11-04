import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import TeacherLayout from '../components/TeacherLayout';
import { RichText } from '../components/RichTextEditor';

const RESULT_BADGE = {
  right: { label: 'Right', style: { background: '#e3f8d6', color: '#3a6d15' } },
  wrong: { label: 'Wrong', style: { background: '#fde2e2', color: '#a02020' } },
  skipped: { label: 'Not answered', style: { background: '#eceef3', color: '#6c757d' } }
};

const resultOf = (q) => (q.selectedOption == null ? 'skipped' : q.isCorrect ? 'right' : 'wrong');

// Per-student breakdown: which option they chose for each question and whether it was right
export default function StudentAnswers() {
  const { id, testStudentId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tests/${id}/students/${testStudentId}/answers`)
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, testStudentId]);

  if (loading) return <TeacherLayout title="Student Answers" showBack><div className="empty-state">Loading…</div></TeacherLayout>;
  if (!data) return <TeacherLayout title="Student Answers" showBack><div className="empty-state">Not found</div></TeacherLayout>;

  const counts = { right: 0, wrong: 0, skipped: 0 };
  data.questions.forEach((q) => { counts[resultOf(q)] += 1; });
  const who = data.student.name ? `${data.student.rollno} — ${data.student.name}` : data.student.rollno;

  return (
    <TeacherLayout title="Student Answers" showBack>
      <div className="card">
        <div className="card-header">
          <h3>{who}</h3>
          <span className="text-muted">{data.test.name} — {data.test.subject}</span>
        </div>
        <div className="card-body">
          <div className="flex" style={{ flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px' }}>
            <span>Score: <strong>{data.score} / {data.maxScore}</strong></span>
            <span style={{ color: 'var(--success)' }}>Right: <strong>{counts.right}</strong></span>
            <span style={{ color: 'var(--danger)' }}>Wrong: <strong>{counts.wrong}</strong></span>
            <span>Not answered: <strong>{counts.skipped}</strong></span>
            {!data.student.submitted && <span className="badge badge-pending">Not submitted</span>}
            {data.student.autoSubmitted && <span className="badge" style={RESULT_BADGE.wrong.style}>Auto-submitted</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {data.questions.length === 0 ? (
            <div className="empty-state"><h5>No questions in this test</h5></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Question</th>
                    <th>Student&apos;s Answer</th>
                    <th>Correct Answer</th>
                    <th>Result</th>
                    <th>Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {data.questions.map((q, i) => {
                    const result = resultOf(q);
                    return (
                      <tr key={q.id}>
                        <td>{i + 1}</td>
                        <td><RichText value={q.title} /></td>
                        <td>
                          {q.selectedOption ? (
                            <span style={{ color: q.isCorrect ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                              {q.selectedOption.toUpperCase()}. <RichText value={q.options[q.selectedOption]} />
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>{q.correctAns.toUpperCase()}. <RichText value={q.options[q.correctAns]} /></td>
                        <td><span className="badge" style={RESULT_BADGE[result].style}>{RESULT_BADGE[result].label}</span></td>
                        <td>{q.isCorrect ? q.score : 0} / {q.score}</td>
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
