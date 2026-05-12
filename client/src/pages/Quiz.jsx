import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// How many anti-cheat violations before the test is auto-submitted
const MAX_WARNINGS = 3;

// Per-question time limit in seconds
const QUESTION_TIME_LIMIT = 60;

export default function Quiz() {
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null); // visual feedback only

  // Anti-cheat state
  const [warnings, setWarnings] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [started, setStarted] = useState(false); // show "Start" screen first (needed for fullscreen)

  // Per-question timer (in seconds remaining)
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_LIMIT);

  // Refs so event listeners always see the latest values
  const warningsRef = useRef(0);
  const finishedRef = useRef(false);   // so we don't trigger warnings after auto-submit
  const submittingRef = useRef(false); // guard against double-skip from timer + click
  const idxRef = useRef(0);

  const { logout, user } = useAuth();
  const navigate = useNavigate();

  // -------- Load questions --------
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/students/quiz/questions');
        if (!data.length) setErr('This test has no questions yet.');
        setQuestions(data);
      } catch (e) {
        setErr(e?.response?.data?.message || 'Could not load questions');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // -------- Finish helpers --------
  const finish = useCallback(async (aborted, autoSubmitted = false) => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    // Exit fullscreen if we're in it
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    try {
      await api.post('/students/quiz/finish', { aborted, autoSubmitted });
    } catch (e) {
      console.error(e);
    }
    logout();
    navigate('/student/finished', {
      state: { status: autoSubmitted ? 'Auto-submitted (too many violations)' : aborted ? 'Aborted' : 'Completed' }
    });
  }, [logout, navigate]);

  // -------- Answer / skip a question --------
  // `option` is 'a'|'b'|'c'|'d' for an answer, or null for a timeout-skip.
  const submitAnswerOrSkip = useCallback(async (option) => {
    if (submittingRef.current || finishedRef.current) return;
    const currentIdx = idxRef.current;
    const q = questions[currentIdx];
    if (!q) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSelected(option);

    try {
      if (option) {
        await api.post('/students/quiz/answer', {
          questionId: q._id,
          selectedOption: option
        });
      }
      // For timeout-skips we don't call the answer endpoint — the server simply
      // never records an answer for this question, which is the correct
      // "0-score, no correct, no wrong" behavior.

      if (currentIdx + 1 >= questions.length) {
        finish(false);
      } else {
        const next = currentIdx + 1;
        idxRef.current = next;
        setIdx(next);
        setSelected(null);
        setTimeLeft(QUESTION_TIME_LIMIT);
        submittingRef.current = false;
        setSubmitting(false);
      }
    } catch (e) {
      setErr(e?.response?.data?.message || 'Error submitting answer');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [questions, finish]);

  // -------- Per-question countdown --------
  useEffect(() => {
    if (!started || loading || submitting || finishedRef.current) return;
    if (!questions.length) return;

    // tick down every second
    const intervalId = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalId);
          // Move to next question (or finish) as a timeout-skip
          submitAnswerOrSkip(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
    // Re-arm the timer whenever the question index changes or the user starts the test
  }, [idx, started, loading, submitting, questions.length, submitAnswerOrSkip]);

  // -------- Violation handler --------
  const handleViolation = useCallback(async (reason) => {
    if (finishedRef.current || !started) return;

    warningsRef.current += 1;
    const count = warningsRef.current;
    setWarnings(count);
    setShowWarning(true);

    // Fire-and-forget: log it on the server so the teacher can see
    try {
      await api.post('/students/quiz/violation', { type: reason });
    } catch (e) { /* non-fatal */ }

    if (count >= MAX_WARNINGS) {
      alert(`You have violated the test rules ${count} times. Your test will be auto-submitted.`);
      finish(true, true);
    }
  }, [started, finish]);

  // -------- Anti-cheat: tab switch / window blur --------
  useEffect(() => {
    if (!started) return;

    const onVisibilityChange = () => {
      if (document.hidden) handleViolation('tab-switch');
    };
    const onBlur = () => handleViolation('window-blur');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
    };
  }, [started, handleViolation]);

  // -------- Anti-cheat: fullscreen --------
  useEffect(() => {
    if (!started) return;

    const onFullscreenChange = () => {
      if (!document.fullscreenElement && !finishedRef.current) {
        handleViolation('fullscreen-exit');
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [started, handleViolation]);

  // -------- Anti-cheat: block right-click, copy, devtools shortcuts --------
  useEffect(() => {
    if (!started) return;

    const blockContext = (e) => e.preventDefault();
    const blockCopy = (e) => e.preventDefault();
    const blockKeys = (e) => {
      if (e.key === 'F12') { e.preventDefault(); return; }
      if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && ['u', 'U', 's', 'S', 'p', 'P'].includes(e.key)) {
        e.preventDefault();
        return;
      }
    };

    document.addEventListener('contextmenu', blockContext);
    document.addEventListener('copy', blockCopy);
    document.addEventListener('cut', blockCopy);
    document.addEventListener('keydown', blockKeys);

    return () => {
      document.removeEventListener('contextmenu', blockContext);
      document.removeEventListener('copy', blockCopy);
      document.removeEventListener('cut', blockCopy);
      document.removeEventListener('keydown', blockKeys);
    };
  }, [started]);

  // -------- Anti-cheat: warn before closing / reloading --------
  useEffect(() => {
    if (!started) return;
    const beforeUnload = (e) => {
      if (finishedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [started]);

  // -------- Start the test (also enters fullscreen) --------
  const handleStart = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => {
          setTimeLeft(QUESTION_TIME_LIMIT);
          setStarted(true);
        })
        .catch(() => {
          setTimeLeft(QUESTION_TIME_LIMIT);
          setStarted(true);
        });
    } else {
      setTimeLeft(QUESTION_TIME_LIMIT);
      setStarted(true);
    }
  };

  const handleManualLogout = () => {
    if (confirm('Are you sure you want to abort the test? Your progress so far will be saved.')) {
      finish(true);
    }
  };

  // -------- Loading / error states --------
  if (loading) {
    return <div className="quiz-container"><div className="loader" /></div>;
  }

  if (err && !questions.length) {
    return (
      <div className="quiz-container">
        <div className="quiz-card">
          <div className="alert alert-error">{err}</div>
          <button className="btn btn-primary" onClick={() => finish(true)}>Back to login</button>
        </div>
      </div>
    );
  }

  // Greet the student by name on the start screen
  const studentName = (user?.name && user.name.trim()) || `Student ${user?.rollno || ''}`;

  // -------- "Start Test" screen (required to trigger fullscreen from a user gesture) --------
  if (!started) {
    return (
      <div className="quiz-container">
        <div className="quiz-card">
          <h2 style={{ color: 'var(--primary)', marginBottom: 8 }}>Ready to begin, {studentName}?</h2>
          <p className="text-muted mb-2">
            Before you start, please read the rules carefully:
          </p>
          <ul style={{ paddingLeft: 20, marginBottom: 20, lineHeight: 1.8 }}>
            <li>You have <strong>{QUESTION_TIME_LIMIT} seconds per question</strong>. When time runs out, the next question loads automatically.</li>
            <li>The test will run in <strong>fullscreen mode</strong>.</li>
            <li><strong>Do not</strong> switch tabs, minimize, or exit fullscreen.</li>
            <li>Right-click, copy, and developer tools are disabled.</li>
            <li>
              You get <strong>{MAX_WARNINGS} warnings</strong>. On the {ordinal(MAX_WARNINGS)} violation,
              your test will be <strong>auto-submitted</strong>.
            </li>
            <li>The test has <strong>{questions.length} question(s)</strong>.</li>
          </ul>
          <button className="btn btn-primary btn-block" onClick={handleStart}>
            I understand — Start Test
          </button>
        </div>
      </div>
    );
  }

  // -------- Active quiz --------
  const q = questions[idx];
  const remaining = MAX_WARNINGS - warnings;
  const progressPct = ((idx) / questions.length) * 100;

  // Timer visual state: green > yellow > red as time runs out
  const timerLevel =
    timeLeft <= 10 ? 'danger' :
    timeLeft <= 20 ? 'warning' :
    'ok';

  return (
    <div className="quiz-container">
      {showWarning && (
        <div
          className="alert alert-error"
          style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>
            ⚠️ <strong>Warning {warnings}/{MAX_WARNINGS}:</strong> Do not switch tabs, minimize, or exit fullscreen.
            {' '}{remaining > 0 ? `${remaining} warning${remaining === 1 ? '' : 's'} remaining before auto-submit.` : ''}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowWarning(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header bar: progress + timer + abort */}
      <div className="quiz-header-bar">
        <div className="quiz-header-info">
          <div className="quiz-student-tag">
            <span className="dot" />
            {studentName}
          </div>
          <div className="quiz-progress-text">
            Question <strong>{idx + 1}</strong> / {questions.length}
            {warnings > 0 && (
              <span style={{ marginLeft: 12, color: 'var(--danger)', fontWeight: 600 }}>
                · {warnings}/{MAX_WARNINGS} warnings
              </span>
            )}
          </div>
        </div>

        <div className={`quiz-timer quiz-timer-${timerLevel}`}>
          <svg className="quiz-timer-ring" viewBox="0 0 36 36">
            <circle className="quiz-timer-ring-bg" cx="18" cy="18" r="15.9155" />
            <circle
              className="quiz-timer-ring-fg"
              cx="18"
              cy="18"
              r="15.9155"
              strokeDasharray={`${(timeLeft / QUESTION_TIME_LIMIT) * 100}, 100`}
            />
          </svg>
          <div className="quiz-timer-text">
            {formatTime(timeLeft)}
          </div>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={handleManualLogout}>Abort</button>
      </div>

      {/* Progress bar */}
      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="quiz-card">
        {submitting ? (
          <div className="loader" />
        ) : (
          <>
            <div className="question-header">
              <span className="question-number">{idx + 1}</span>
              <div className="question-title">{q.title}</div>
            </div>
            <div className="quiz-options">
              {[
                { letter: 'a', text: q.optionA },
                { letter: 'b', text: q.optionB },
                { letter: 'c', text: q.optionC },
                { letter: 'd', text: q.optionD }
              ].map(opt => (
                <button
                  key={opt.letter}
                  className={`option-btn ${selected === opt.letter ? 'is-selected' : ''}`}
                  onClick={() => submitAnswerOrSkip(opt.letter)}
                  disabled={submitting}
                >
                  <span className="option-letter">{opt.letter.toUpperCase()}</span>
                  <span className="option-text">{opt.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Tiny helper: 1 → "1st", 2 → "2nd", 3 → "3rd", etc.
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// 65 → "1:05"
function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
