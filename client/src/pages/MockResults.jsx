import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function MockResults() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/students/quiz/results');
        setResults(data);
      } catch (e) {
        setErr(e?.response?.data?.message || 'Could not load results');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="student-page">
        <div className="student-dashboard-card">
          <div className="loader" />
          <p className="text-muted mt-2" style={{ textAlign: 'center' }}>Loading results…</p>
        </div>
      </div>
    );
  }

  if (err || !results) {
    return (
      <div className="student-page">
        <div className="student-dashboard-card">
          <div className="alert alert-error">{err || 'No results found'}</div>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/student/dashboard')}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const percentage = Math.round((results.score / results.totalQuestions) * 100);

  return (
    <div className="student-page">
      <div className="student-dashboard-card">
        {/* Score Summary */}
        <div
          style={{
            background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%)',
            border: '1px solid #bbdefb',
            borderRadius: 10,
            padding: 30,
            textAlign: 'center',
            marginBottom: 30
          }}
        >
          <h2 style={{ margin: 0, color: '#1976d2', fontSize: '3rem' }}>{percentage}%</h2>
          <p style={{ margin: '8px 0 0 0', color: '#666', fontSize: 14 }}>
            You scored <strong>{results.score}</strong> out of <strong>{results.totalQuestions}</strong> points
          </p>
        </div>

        {/* Review Answers */}
        <h3 style={{ marginBottom: 20, borderBottom: '1px solid #ddd', paddingBottom: 10 }}>
          Review Your Answers
        </h3>

        <div>
          {results.results.map((q, idx) => {
            const studentAnswer = q.studentAnswer?.selected;
            const isCorrect = q.studentAnswer?.isCorrect;
            const optionLabels = { a: 'A', b: 'B', c: 'C', d: 'D' };
            const options = [
              { key: 'a', label: 'A', text: q.optionA },
              { key: 'b', label: 'B', text: q.optionB },
              { key: 'c', label: 'C', text: q.optionC },
              { key: 'd', label: 'D', text: q.optionD }
            ];

            return (
              <div
                key={q._id}
                style={{
                  background: '#f9f9f9',
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    marginBottom: 12
                  }}
                >
                  <div
                    style={{
                      background: isCorrect ? '#4caf50' : '#f44336',
                      color: 'white',
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 'bold',
                      flexShrink: 0
                    }}
                  >
                    {isCorrect ? '✓' : '✗'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#333' }}>
                      Q{idx + 1}: {q.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#999' }}>
                      {isCorrect ? 'Correct!' : 'Incorrect'}
                    </p>
                  </div>
                </div>

                {/* Options */}
                <div style={{ marginLeft: 40 }}>
                  {options.map(opt => {
                    const isStudentChoice = studentAnswer === opt.key;
                    const isCorrectChoice = opt.key === q.correctAns;
                    let bg = '#fff';
                    let borderColor = '#ddd';

                    if (isCorrectChoice) {
                      bg = '#e8f5e9';
                      borderColor = '#4caf50';
                    } else if (isStudentChoice && !isCorrect) {
                      bg = '#ffebee';
                      borderColor = '#f44336';
                    }

                    return (
                      <div
                        key={opt.key}
                        style={{
                          background: bg,
                          border: `2px solid ${borderColor}`,
                          borderRadius: 6,
                          padding: 10,
                          marginBottom: 8,
                          display: 'flex',
                          gap: 10
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 'bold',
                            color: borderColor,
                            minWidth: 20
                          }}
                        >
                          {opt.label}
                        </div>
                        <div style={{ flex: 1 }}>{opt.text}</div>
                        {isCorrectChoice && (
                          <div style={{ color: '#4caf50', fontWeight: 'bold' }}>✓ Correct</div>
                        )}
                        {isStudentChoice && !isCorrect && (
                          <div style={{ color: '#f44336', fontWeight: 'bold' }}>✗ Your answer</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 30 }}>
          <button
            className="btn btn-secondary"
            onClick={() => navigate('/student/dashboard')}
          >
            Back to Dashboard
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            Re-login and Retake
          </button>
        </div>
      </div>
    </div>
  );
}
