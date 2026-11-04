import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { RichText } from '../components/RichTextEditor';
import useFaceMonitor from '../components/useFaceMonitor';
const PracticeBanner = React.lazy(() => import('../components/PracticeBanner'));

// How many anti-cheat violations before the test is auto-submitted
const MAX_WARNINGS = 3;

// Fallback for questions created before per-question timing was added.
const DEFAULT_QUESTION_TIME_LIMIT = 60;

function getQuestionTimeLimit(question) {
  const minutes = Number(question?.timeLimit);
  return (Number.isFinite(minutes) && minutes >= 0.25 ? minutes : 1) * 60;
}

// Banner text for the most recent violation
const VIOLATION_MESSAGES = {
  'tab-switch': 'Do not switch tabs or minimize the window.',
  'fullscreen-exit': 'Do not exit fullscreen.',
  'camera-disabled': 'Keep your camera turned on.',
  'looking-away': 'Keep looking at the screen.',
  'face-not-visible': 'Keep your face visible to the camera.',
  'multiple-faces': 'Only you may be in front of the camera.'
};

// Camera badge label/colour for each face-monitor status
const CAMERA_STATUS = {
  loading: { label: 'Starting face tracking…', tone: 'muted' },
  ok: { label: 'Camera active', tone: 'ok' },
  'looking-away': { label: 'Look at the screen!', tone: 'alert' },
  'face-not-visible': { label: 'Face not visible!', tone: 'alert' },
  'multiple-faces': { label: 'Multiple faces!', tone: 'alert' },
  unavailable: { label: 'Camera active', tone: 'ok' }
};

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

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
  const [lastViolation, setLastViolation] = useState(null);
  const [fullscreenError, setFullscreenError] = useState('');
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [started, setStarted] = useState(false); // show "Start" screen first (needed for fullscreen)

  // Per-question timer (in seconds remaining)
  const [timeLeft, setTimeLeft] = useState(DEFAULT_QUESTION_TIME_LIMIT);
  // Total-time tests: seconds left for the whole test (deadline comes from the server)
  const [totalLeft, setTotalLeft] = useState(null);
  const totalDeadlineRef = useRef(null);

  // Refs so event listeners always see the latest values
  const warningsRef = useRef(0);
  const finishedRef = useRef(false);   // so we don't trigger warnings after auto-submit
  const submittingRef = useRef(false); // guard against double-skip from timer + click
  const idxRef = useRef(0);
  const timerDeadlineRef = useRef(null);
  const questionsLoadStartedRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const enteredFullscreenRef = useRef(false);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const isMock = user?.testMode === 'MOCK';
  const webcamRequired = !isMock && user?.webcamProctoring !== false;
  const isTotalTime = !isMock && user?.timingMode === 'TOTAL';
  const totalSeconds = (Number(user?.totalTimeMinutes) || 30) * 60;

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!videoRef.current || !cameraStreamRef.current) return;
    videoRef.current.srcObject = cameraStreamRef.current;
  }, [cameraReady, started]);

  // -------- Load questions --------
  useEffect(() => {
    if (questionsLoadStartedRef.current) return undefined;
    questionsLoadStartedRef.current = true;

    (async () => {
      try {
        const { data } = await api.get('/students/quiz/questions');
        if (!data.length) setErr('This test has no questions yet.');
        setQuestions(data);
      } catch (e) {
        if (e?.response?.status === 410) {
          // Already submitted — the dashboard shows "test completed"
          navigate('/student/dashboard', { replace: true });
          return;
        }
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
    if (getFullscreenElement()) {
      const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
      exitFullscreen?.call(document).catch?.(() => {});
    }
    stopCamera();

    try {
      await api.post('/students/quiz/finish', { aborted, autoSubmitted });
    } catch (e) {
      console.error(e);
    }
    if (isMock) {
      navigate('/student/mock-results');
    } else {
      logout();
      navigate('/student/finished', {
        state: { status: autoSubmitted ? 'Auto-submitted (too many violations)' : aborted ? 'Aborted' : 'Completed' }
      });
    }
  }, [logout, navigate, isMock, stopCamera]);

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
        submittingRef.current = false;
        setSubmitting(false);
      }
    } catch (e) {
      if (e?.response?.status === 410) {
        finish(false); // time is up (or already submitted) — wrap up instead of showing an error
        return;
      }
      setErr(e?.response?.data?.message || 'Error submitting answer');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [questions, finish]);

  // -------- Per-question countdown --------
  useEffect(() => {
    if (isMock || isTotalTime) return;
    if (!started || loading || submitting || finishedRef.current) return;
    const question = questions[idx];
    if (!question) return;

    const duration = getQuestionTimeLimit(question);
    timerDeadlineRef.current = Date.now() + duration * 1000;
    setTimeLeft(duration);

    const intervalId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((timerDeadlineRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(intervalId);
        submitAnswerOrSkip(null);
      }
    }, 250);

    return () => clearInterval(intervalId);
  }, [idx, started, loading, submitting, questions, submitAnswerOrSkip, isMock, isTotalTime]);

  // -------- Whole-test countdown (total-time mode) --------
  useEffect(() => {
    if (!isTotalTime || !started || !totalDeadlineRef.current) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((totalDeadlineRef.current - Date.now()) / 1000));
      setTotalLeft(left);
      if (left === 0) {
        clearInterval(intervalId);
        finish(false);
      }
    };
    const intervalId = setInterval(tick, 250);
    tick();
    return () => clearInterval(intervalId);
  }, [isTotalTime, started, finish]);

  // -------- Violation handler --------
  const handleViolation = useCallback(async (reason) => {
    if (isMock || finishedRef.current || !started) return;

    // A single tab/fullscreen transition can emit more than one browser event.
    const now = Date.now();
    if (now - lastViolationAtRef.current < 1000) return;
    lastViolationAtRef.current = now;

    warningsRef.current += 1;
    const count = warningsRef.current;
    setWarnings(count);
    setLastViolation(reason);
    setShowWarning(true);

    // Fire-and-forget: log it on the server so the teacher can see
    let recordedCount = count;
    try {
      const { data } = await api.post('/students/quiz/violation', { type: reason });
      recordedCount = Number(data?.violations) || count;
      setWarnings(recordedCount);
    } catch (e) { /* non-fatal */ }

    if (recordedCount >= MAX_WARNINGS) {
      // Submit immediately — an alert() here would block the JS thread (and the
      // finish request) until dismissed, and the student could close the tab first.
      finish(true, true);
    }
  }, [isMock, started, finish]);

  // -------- Anti-cheat: camera track --------
  useEffect(() => {
    if (!webcamRequired || !started || !cameraStreamRef.current) return;
    const track = cameraStreamRef.current.getVideoTracks()[0];
    if (!track) return;

    const onCameraEnded = () => {
      setCameraReady(false);
      handleViolation('camera-disabled');
    };
    track.addEventListener('ended', onCameraEnded);
    return () => track.removeEventListener('ended', onCameraEnded);
  }, [webcamRequired, started, cameraReady, handleViolation]);

  // -------- Anti-cheat: face / gaze tracking on the webcam --------
  const { status: faceStatus } = useFaceMonitor(
    videoRef,
    webcamRequired && started && cameraReady,
    handleViolation
  );

  // -------- Anti-cheat: tab switch --------
  useEffect(() => {
    if (isMock || !started) return;

    const onVisibilityChange = () => {
      if (document.hidden) handleViolation('tab-switch');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isMock, started, handleViolation]);

  // -------- Anti-cheat: fullscreen --------
  useEffect(() => {
    if (isMock || !started) return;

    const onFullscreenChange = () => {
      if (finishedRef.current) return;
      if (!getFullscreenElement() && enteredFullscreenRef.current) {
        setOutOfFullscreen(true);
        handleViolation('fullscreen-exit');
      } else if (getFullscreenElement()) {
        setOutOfFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, [isMock, started, handleViolation]);

  // -------- Anti-cheat: block right-click, copy, devtools shortcuts --------
  useEffect(() => {
    if (isMock || !started) return;

    const blockContext = (e) => e.preventDefault();
    const blockCopy = (e) => e.preventDefault();
    const blockKeys = (e) => {
      const key = e.key.toLowerCase();
      const blockedFunctionKey = /^f(?:1[0-2]|[1-9])$/.test(key);
      const blockedShortcut = (e.ctrlKey || e.metaKey) &&
        ['a', 'c', 'i', 'j', 'p', 's', 'u', 'v', 'x'].includes(key);
      const blockedNavigation = e.altKey && ['arrowleft', 'arrowright'].includes(key);

      if (blockedFunctionKey || blockedShortcut || blockedNavigation || key === 'escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'ContextMenu') {
        e.preventDefault();
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
  }, [isMock, started]);

  // -------- Anti-cheat: warn before closing / reloading --------
  useEffect(() => {
    if (isMock || !started) return;
    const beforeUnload = (e) => {
      if (finishedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isMock, started]);

  // -------- Start the test (also enters fullscreen) --------
  // Tell the server the test has started; total-time tests get their remaining time back
  const beginTest = async () => {
    try {
      const { data } = await api.post('/students/quiz/start');
      if (isTotalTime) {
        const left = Number.isFinite(data?.remainingSeconds) ? data.remainingSeconds : totalSeconds;
        totalDeadlineRef.current = Date.now() + left * 1000;
        setTotalLeft(left);
      }
    } catch {
      if (isTotalTime) {
        totalDeadlineRef.current = Date.now() + totalSeconds * 1000;
        setTotalLeft(totalSeconds);
      }
    }
    setStarted(true);
  };

  const handleStart = async () => {
    if (isMock) {
      setStarted(true);
      return;
    }

    if (webcamRequired) {
      setCameraError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('A webcam is required, but this browser does not support camera access.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraStreamRef.current = stream;
        setCameraReady(true);
      } catch {
        setCameraError('Camera access is required to start this proctored test. Allow camera access and try again.');
        return;
      }
    }

    const el = document.documentElement;
    const requestFullscreen = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!requestFullscreen) {
      setFullscreenError('Fullscreen is not supported on this device. The test will continue with tab and window monitoring.');
      await beginTest();
      return;
    }

    setFullscreenError('');
    try {
      await requestFullscreen.call(el, { navigationUI: 'hide' });
      if (!getFullscreenElement()) throw new Error('Fullscreen request was not accepted');
      enteredFullscreenRef.current = true;
    } catch {
      setFullscreenError('Fullscreen permission was unavailable. The test will continue with tab and window monitoring.');
    }
    await beginTest();
  };

  const handleResumeFullscreen = async () => {
    const el = document.documentElement;
    const requestFullscreen = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!requestFullscreen) {
      setOutOfFullscreen(false);
      return;
    }
    try {
      await requestFullscreen.call(el, { navigationUI: 'hide' });
      if (getFullscreenElement()) setOutOfFullscreen(false);
    } catch {
      // Stay blocked — the student must click again to grant fullscreen.
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
    const minutes = Math.round(totalSeconds / 60);
    const rules = isMock
      ? [
          ['📝', 'This is a practice test — no timer, no proctoring, no warnings.'],
          ['🔁', 'You can switch tabs, reload, and retake it as often as you like.']
        ]
      : [
          isTotalTime
            ? ['⏱️', <>One timer for the whole test. You can&apos;t go back, but you can <strong>Skip</strong> a question.</>]
            : ['⏱️', 'Each question has its own timer. When it runs out, the next question loads.'],
          ['🖥️', <>The test runs in <strong>fullscreen</strong>. Don&apos;t switch tabs or minimise.</>],
          ...(webcamRequired
            ? [['📷', <>Keep your camera on, your face visible, and <strong>look at the screen</strong>.</>]]
            : []),
          ['🚫', 'Right-click, copy and developer tools are disabled.'],
          ['⚠️', <>On the <strong>{ordinal(MAX_WARNINGS)} warning</strong> your test is submitted automatically.</>]
        ];

    return (
      <div className="quiz-container quiz-start">
        <div className="quiz-card quiz-start-card">
          <h2 className="quiz-start-title">Ready to begin, {studentName}?</h2>
          <p className="text-muted">Read these rules, then start when you&apos;re ready.</p>

          <div className="quiz-start-chips">
            <div className="quiz-start-chip">
              <span className="chip-value">{questions.length}</span>
              <span className="chip-label">question{questions.length === 1 ? '' : 's'}</span>
            </div>
            <div className="quiz-start-chip">
              <span className="chip-value">{isMock ? '—' : isTotalTime ? `${minutes} min` : 'Per Q'}</span>
              <span className="chip-label">{isMock ? 'no timer' : isTotalTime ? 'total time' : 'timer'}</span>
            </div>
            <div className="quiz-start-chip">
              <span className="chip-value">{isMock ? '—' : MAX_WARNINGS}</span>
              <span className="chip-label">{isMock ? 'no warnings' : 'warnings max'}</span>
            </div>
          </div>

          <ul className="quiz-start-rules">
            {rules.map(([icon, text], i) => (
              <li key={i}>
                <span className="rule-icon" aria-hidden="true">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          {fullscreenError && <div className="alert alert-error">{fullscreenError}</div>}
          {cameraError && <div className="alert alert-error">{cameraError}</div>}
          <button className="btn btn-primary btn-block btn-lg" onClick={handleStart}>
            I understand — Start Test
          </button>
        </div>
      </div>
    );
  }

  // -------- Active quiz --------
  const q = questions[idx];
  const questionTimeLimit = getQuestionTimeLimit(q);
  const remaining = MAX_WARNINGS - warnings;
  const progressPct = ((idx) / questions.length) * 100;

  // Timer shows the whole-test countdown in total-time mode, else this question's countdown
  const shownTime = isTotalTime ? (totalLeft ?? totalSeconds) : timeLeft;
  const shownLimit = isTotalTime ? totalSeconds : questionTimeLimit;

  // Timer visual state: green > yellow > red as time runs out
  const timerLevel = isTotalTime
    ? (shownTime <= 60 ? 'danger' : shownTime <= 300 ? 'warning' : 'ok')
    : (shownTime <= 10 ? 'danger' : shownTime <= 20 ? 'warning' : 'ok');

  return (
    <div className="quiz-container">
      {isMock && (
        <React.Suspense fallback={null}>
          <PracticeBanner variant="danger">PRACTICE MODE — No proctoring, no timers enforced.</PracticeBanner>
        </React.Suspense>
      )}
      {fullscreenError && (
        <div className="alert alert-error" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          {fullscreenError}
        </div>
      )}
      {showWarning && (
        <div
          className="alert alert-error"
          style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
        >
          <span>
            ⚠️ <strong>Warning {warnings}/{MAX_WARNINGS}:</strong>{' '}
            {VIOLATION_MESSAGES[lastViolation] || 'Do not switch tabs, minimize, or exit fullscreen.'}
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

      {outOfFullscreen && !isMock && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, textAlign: 'center', padding: 20
          }}
        >
          <div className="quiz-card" style={{ maxWidth: 420 }}>
            <h3 style={{ color: 'var(--danger)', marginBottom: 8 }}>You left fullscreen mode</h3>
            <p className="text-muted mb-2">
              This is a recorded violation. You must return to fullscreen to keep answering questions.
              The countdown keeps running while you're out.
            </p>
            <button className="btn btn-primary btn-block" onClick={handleResumeFullscreen}>
              Resume Fullscreen
            </button>
          </div>
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

        {webcamRequired && (
          <div
            className={`quiz-camera quiz-camera--${CAMERA_STATUS[faceStatus].tone}`}
            title="Webcam proctoring is active"
            role="status"
            aria-live="polite"
          >
            <video ref={videoRef} autoPlay muted playsInline />
            <span><span className="quiz-camera-dot" /> {CAMERA_STATUS[faceStatus].label}</span>
          </div>
        )}

        {!isMock ? (
          <div className={`quiz-timer quiz-timer-${timerLevel}`} title={isTotalTime ? 'Time left for the whole test' : 'Time left for this question'}>
            <svg className="quiz-timer-ring" viewBox="0 0 36 36">
              <circle className="quiz-timer-ring-bg" cx="18" cy="18" r="15.9155" />
              <circle
                className="quiz-timer-ring-fg"
                cx="18"
                cy="18"
                r="15.9155"
                strokeDasharray={`${(shownTime / shownLimit) * 100}, 100`}
              />
            </svg>
            <div className="quiz-timer-text">
              {formatTime(shownTime)}
            </div>
          </div>
        ) : (
          <div className="quiz-timer quiz-timer-ok">
            <div className="quiz-timer-text">Practice Mode</div>
          </div>
        )}

        <button className="btn btn-secondary btn-sm quiz-abort-btn" onClick={handleManualLogout}>Abort</button>
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
              <div className="question-title"><RichText value={q.title} /></div>
            </div>
            <div className="quiz-options">
              {(q.optionOrder || ['a', 'b', 'c', 'd']).map((key, pos) => (
                <button
                  key={key}
                  className={`option-btn ${selected === key ? 'is-selected' : ''}`}
                  onClick={() => submitAnswerOrSkip(key)}
                  disabled={submitting || outOfFullscreen}
                >
                  {/* Shown letter follows the (possibly shuffled) position; the original key is what's sent */}
                  <span className="option-letter">{'ABCD'[pos]}</span>
                  <span className="option-text">{q[`option${key.toUpperCase()}`]}</span>
                </button>
              ))}
            </div>
            {isTotalTime && (
              <div className="text-right mt-2">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => submitAnswerOrSkip(null)}
                  disabled={submitting || outOfFullscreen}
                >
                  Skip question →
                </button>
              </div>
            )}
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
