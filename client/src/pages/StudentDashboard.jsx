import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function StudentDashboard() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/students/dashboard');
        setInfo(data);
      } catch (e) {
        setErr('Could not load your dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleStart = () => {
    navigate('/student/quiz');
  };

  // First letter of the student's name for the avatar bubble
  const displayName = (user?.name && user.name.trim()) || `Student ${user?.rollno || ''}`;
  const initial = displayName.charAt(0).toUpperCase() || 'S';
  const greeting = getGreeting();
  const isMock = info?.isMock;

  return (
    <div className="student-page">
      <div className="student-dashboard-card">
        {/* Top bar: avatar + name + logout */}
        <div className="student-topbar">
          <div className="student-identity">
            <div className="student-avatar">{initial}</div>
            <div>
              <div className="student-greeting">{greeting},</div>
              <div className="student-name">{displayName}</div>
              {user?.rollno != null && (
                <div className="student-rollno-sub">Roll No: {user.rollno}</div>
              )}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
        </div>

        {/* Body */}
        {loading && (
          <div className="student-body-loading">
            <div className="loader" />
            <p className="text-muted mt-2">Loading your test…</p>
          </div>
        )}

        {err && <div className="alert alert-error">{err}</div>}

        {!loading && info && (
          <>
            {info.submitted ? (
              <div className="student-status-box student-status-done">
                <div className="status-icon">✓</div>
                <h3>Test completed</h3>
                <p className="text-muted">
                  You've already submitted <strong>{info.testName}</strong>. Thanks!
                </p>
              </div>
            ) : info.running ? (
              <div className="student-test-card">
                <div className="student-test-badge">Live</div>
                <h3 className="student-test-title">{info.testName}</h3>
                {isMock && <div className="student-test-mode">Mock Practice</div>}

                <div className="student-test-meta">
                  <div className="meta-item">
                    <span className="meta-label">Subject</span>
                    <span className="meta-value">{info.subject || '—'}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Questions</span>
                    <span className="meta-value">{info.totalQuestions}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Per question</span>
                    <span className="meta-value">1:00 min</span>
                  </div>
                </div>

                {isMock ? (
                  <ul className="student-instructions">
                    <li>This is a <strong>Mock Practice</strong> test with no anti-cheat restrictions.</li>
                    <li>No fullscreen, no warnings, and no auto-submit.</li>
                    <li>You can re-login and retake this mock test freely.</li>
                  </ul>
                ) : (
                  <ul className="student-instructions">
                    <li>You have <strong>1 minute</strong> per question.</li>
                    <li>The test runs in fullscreen. Don't switch tabs.</li>
                    <li>You'll get 3 warnings before auto-submit.</li>
                  </ul>
                )}

                <button className="btn btn-primary btn-block btn-lg" onClick={handleStart}>
                  Start Test →
                </button>
              </div>
            ) : (
              <div className="student-status-box student-status-waiting">
                <div className="status-icon">⏳</div>
                <h3>Waiting for teacher</h3>
                <p className="text-muted">
                  Your test <strong>{info.testName}</strong> hasn't started yet.
                  Wait until your teacher marks it as RUNNING.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
