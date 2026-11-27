import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { formatWhen } from '../components/TestScheduleFields';
import usePolling from '../components/usePolling';
import { useAuth } from '../context/AuthContext';
import ScoreCard from '../components/ScoreCard';
const PracticeBanner = React.lazy(() => import('../components/PracticeBanner'));

export default function StudentDashboard() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(false);

  // Fetches the test status without reloading the page (a reload would drop fullscreen).
  const loadDashboard = React.useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setChecking(true);
    try {
      const { data } = await api.get('/students/dashboard');
      setInfo(data);
      setErr('');
    } catch (e) {
      if (!quiet) setErr('Could not load your dashboard');
    } finally {
      setLoading(false);
      if (!quiet) setChecking(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // While waiting for the teacher, keep checking so "Start Test" appears on its own.
  const waiting = !!info && !info.submitted && !info.running && !info.closed;
  // Every 10–20 s at random, so a hall of 1000 waiting students is ~70 requests/s, not 200
  usePolling(() => loadDashboard({ quiet: true }), { minMs: 10000, maxMs: 20000, enabled: waiting });
  // Scheduled test: also check right after the opening time (spread over 0–8 s) so
  // "Start Test" appears promptly without everyone asking at the same instant
  const opensAt = info?.startAt ? new Date(info.startAt).getTime() : null;
  useEffect(() => {
    if (!waiting || !opensAt) return undefined;
    const wait = opensAt - Date.now() + 500 + Math.random() * 8000;
    if (wait < 0 || wait > 24 * 60 * 60 * 1000) return undefined;
    const timer = setTimeout(() => loadDashboard({ quiet: true }), wait);
    return () => clearTimeout(timer);
  }, [waiting, opensAt, loadDashboard]);

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
  const isTotalTime = !isMock && info?.timingMode === 'TOTAL';

  return (
    <div className="student-page">
      <div className="student-dashboard-card">
        {isMock && (
          <>
            {
              /* Lazily load the component via relative import to keep changes minimal */
            }
            <React.Suspense fallback={null}>
              <PracticeBanner variant="warning">
                PRACTICE MODE — This is a mock test with no proctoring. You may re-login and retake.
              </PracticeBanner>
            </React.Suspense>
          </>
        )}
        {/* Top bar: avatar + name + logout */}
        <div className="student-topbar">
          <div className="student-identity">
            <div className="student-avatar">{initial}</div>
            <div>
              <div className="student-greeting">{greeting},</div>
              <div className="student-name">{displayName}</div>
              {user?.rollno != null && (
                <div className="student-rollno-sub">USN: {user.rollno}</div>
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
                <h3>You have completed this test</h3>
                <p className="text-muted">
                  Your answers for <strong>{info.testName}</strong> have been submitted
                  {info.autoSubmitted ? ' (automatically, after too many warnings)' : ''}.
                  {!isMock && ' You can’t take it again.'}
                </p>
                {!isMock && <ScoreCard result={info.result} />}
                {isMock && (
                  <button
                    className="btn btn-primary btn-block btn-lg mt-4"
                    onClick={() => {
                      logout();
                      navigate('/student/login');
                    }}
                  >
                    Re-login and Retake →
                  </button>
                )}
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
                    <span className="meta-label">Timer</span>
                    <span className="meta-value">
                      {isMock ? 'None' : isTotalTime ? `${info.totalTimeMinutes} min total` : 'Per question'}
                    </span>
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
                    {isTotalTime ? (
                      <li>You have <strong>{info.totalTimeMinutes} minutes</strong> for the whole test.</li>
                    ) : (
                      <li>Each question has its <strong>own time limit</strong> — check the timer on screen.</li>
                    )}
                    <li>The test runs in fullscreen. Don&apos;t switch tabs.</li>
                    {info.webcamProctoring && <li>Your camera stays on — keep your face visible.</li>}
                    <li>You&apos;ll get 3 warnings before auto-submit.</li>
                  </ul>
                )}

                {info.endAt && (
                  <p className="schedule-note">
                    This test closes at <strong>{formatWhen(info.endAt)}</strong>. Answers sent after that won&apos;t count.
                  </p>
                )}

                <button className="btn btn-primary btn-block btn-lg mt-2" onClick={handleStart}>
                  Start Test →
                </button>
              </div>
            ) : info.closed ? (
              <div className="student-status-box student-status-waiting">
                <div className="status-icon">🔒</div>
                <h3>This test has closed</h3>
                <p className="text-muted">
                  <strong>{info.testName}</strong> is no longer open
                  {info.endAt ? ` — it closed at ${formatWhen(info.endAt)}` : ''}. Contact your teacher if you think this is a mistake.
                </p>
              </div>
            ) : (
              <div className="student-status-box student-status-waiting">
                <div className="status-icon">⏳</div>
                <h3>{info.startAt ? 'Test opens soon' : 'Waiting for teacher'}</h3>
                <p className="text-muted">
                  Your test <strong>{info.testName}</strong> hasn't started yet.
                  {info.startAt && new Date(info.startAt) > new Date()
                    ? <> It opens at <strong>{formatWhen(info.startAt)}</strong>.</>
                    : ' Wait until your teacher marks it as RUNNING.'}
                  {' '}This page updates automatically — no need to refresh.
                </p>
                <button
                  className="btn btn-secondary btn-sm mt-4"
                  onClick={() => loadDashboard()}
                  disabled={checking}
                >
                  {checking ? 'Checking…' : 'Check again'}
                </button>
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
