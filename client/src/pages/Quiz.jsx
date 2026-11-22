import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { imageUrl } from '../api/client';
import Picture from '../components/Picture';
import { useAuth } from '../context/AuthContext';
import { RichText } from '../components/RichTextEditor';
import useFaceMonitor from '../components/useFaceMonitor';
const PracticeBanner = React.lazy(() => import('../components/PracticeBanner'));

// How many anti-cheat violations before the test is auto-submitted
const MAX_WARNINGS = 3;

// After the student comes back (visible + focused + fullscreen), ignore follow-on
// signals for this long: the camera restarts and the face tracker sees black frames.
const RETURN_GRACE_MS = 5000;

// Leaving-the-test violations. When one action fires several of these at once, only the
// first counts. A different one arriving this long after a plain fullscreen exit is a new action.
const LEAVE_REASONS = new Set(['tab-switch', 'assistant-opened', 'focus-lost', 'fullscreen-exit']);
const SEPARATE_ACTION_MS = 2000;

// Fallback for questions created before per-question timing was added.
const DEFAULT_QUESTION_TIME_LIMIT = 60;

function getQuestionTimeLimit(question) {
  const minutes = Number(question?.timeLimit);
  return (Number.isFinite(minutes) && minutes >= 0.25 ? minutes : 1) * 60;
}

// Banner text for the most recent violation: what was detected + what to do
const VIOLATION_MESSAGES = {
  'tab-switch': 'Tab switching detected. Stay on the test tab and do not minimise the browser.',
  'assistant-opened': 'Google Assistant / screen assistant detected (Assistant, Gemini or Circle to Search). Do not open assistants or overlays during the test.',
  'focus-lost': 'Switching to another window or app detected. Keep the test window active.',
  'fullscreen-exit': 'Fullscreen exit detected. Stay in fullscreen.',
  'camera-disabled': 'Camera turned off. Keep your camera on.',
  'looking-away': 'Looking away detected. Keep looking at the screen.',
  'face-not-visible': 'Face not visible. Keep your face in front of the camera.',
  'multiple-faces': 'Multiple faces detected. Only you may be in front of the camera.'
};

// Phones/tablets: a visible page losing focus there means an assistant or overlay opened
function isMobileDevice() {
  if (navigator.userAgentData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// Camera badge label/colour for each face-monitor status
const CAMERA_STATUS = {
  loading: { label: 'Starting face tracking…', tone: 'muted' },
  ok: { label: 'Camera active', tone: 'ok' },
  'looking-away': { label: 'Look at the screen!', tone: 'alert' },
  'face-not-visible': { label: 'Face not visible!', tone: 'alert' },
  'multiple-faces': { label: 'Multiple faces!', tone: 'alert' },
  unavailable: { label: 'Camera active', tone: 'ok' }
};

// Proctored tests on Android must run in Google Chrome: other Android browsers
// (Samsung Internet, MIUI, Opera, in-app WebViews…) don't report focus loss reliably
// when an assistant/overlay opens. Desktop browsers are not restricted.
function isAndroidNonChrome() {
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua)) return false;
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands) && brands.length) {
    return !brands.some((b) => b.brand === 'Google Chrome');
  }
  // Fallback for browsers without User-Agent Client Hints
  const notChrome = /SamsungBrowser|MiuiBrowser|XiaoMi|OPR\/|Opera|EdgA|Firefox|FxiOS|UCBrowser|YaBrowser|HeyTapBrowser|VivoBrowser|OppoBrowser|Brave|DuckDuckGo|; wv\)|Version\/\d/i;
  return !/Chrome\/\d/.test(ua) || notChrome.test(ua);
}

// Faint repeated "USN · Name · date" tile drawn over the question. A web page can't stop
// Circle to Search / Gemini / screenshots, but any captured or shared image shows who it came from.
function watermarkBackground(text) {
  const safe = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">`
    + `<text x="160" y="80" text-anchor="middle" dominant-baseline="middle" transform="rotate(-24 160 80)" `
    + `font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="rgba(128,128,128,0.22)">${safe}</text></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

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
  // Answers that need a Submit press: ticked options ('ac') for multiple-correct, typed text for numeric
  const [picks, setPicks] = useState('');
  const [numberText, setNumberText] = useState('');
  // The current unsent answer, so a per-question timeout sends it instead of skipping
  const draftRef = useRef(null);

  // Anti-cheat state
  const [warnings, setWarnings] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [lastViolation, setLastViolation] = useState(null);
  const [fullscreenError, setFullscreenError] = useState('');
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);
  const [windowFocused, setWindowFocused] = useState(true); // question is hidden while false
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [started, setStarted] = useState(false); // show "Start" screen first (needed for fullscreen)
  const [cameraEpoch, setCameraEpoch] = useState(0); // bumps when the camera stream is restarted

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
  const suppressBlurRef = useRef(false); // our own confirm() dialog also blurs the window
  // "Away episode": from the moment the student leaves (home button, call, tab switch,
  // overlay, fullscreen exit) until they're back + RETURN_GRACE_MS. One episode = one warning.
  const awayRef = useRef({ away: false, counted: false, reason: null, countedAt: 0, graceUntil: 0 });
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
  }, [cameraReady, started, cameraEpoch]);

  // Phones stop the camera when the browser goes to the background (home button,
  // incoming call). Turn it back on silently instead of counting it as a violation.
  const restartCamera = useCallback(async () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = stream;
      setCameraReady(true);
      setCameraEpoch((n) => n + 1);
      return true;
    } catch {
      cameraStreamRef.current = null;
      setCameraReady(false);
      return false;
    }
  }, []);

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
  // `option` is the answer ('b', 'ac' for multiple-correct, '9.8' for numeric), or null for a skip.
  const submitAnswerOrSkip = useCallback(async (option) => {
    if (submittingRef.current || finishedRef.current) return;
    const currentIdx = idxRef.current;
    const q = questions[currentIdx];
    if (!q) return;

    submittingRef.current = true;
    setSubmitting(true);
    setErr('');
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
        setPicks('');
        setNumberText('');
        draftRef.current = null;
        setErr('');
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

  // -------- Fetch the next question's pictures early so they show instantly --------
  useEffect(() => {
    const next = questions[idx + 1];
    if (!next) return;
    [next.image, ...Object.values(next.optionImages || {})].filter(Boolean).forEach((key) => {
      const img = new Image();
      img.src = imageUrl(key);
    });
  }, [idx, questions]);

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
        // Time's up: send whatever was ticked / typed so far, otherwise skip
        submitAnswerOrSkip(draftRef.current);
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
  // Returns true if the violation was counted, false if it was ignored.
  const handleViolation = useCallback((reason) => {
    if (isMock || finishedRef.current || !started) return false;

    // A single tab/fullscreen transition can emit more than one browser event.
    const now = Date.now();
    if (now - lastViolationAtRef.current < 1000) return false;

    // While away (and just after coming back), everything that happens is part of the
    // same incident: hidden page, fullscreen exit, camera stopping, black frames…
    // Count only the first one.
    // The first signal names the warning (Assistant, tab switch, or just fullscreen exit).
    const a = awayRef.current;
    if (a.away || now < a.graceUntil) {
      // Exception: the student only left fullscreen (page still visible and focused) and
      // later — as a separate action — opens an assistant or switches away. That's a new warning.
      const separateAction = a.counted && a.reason === 'fullscreen-exit'
        && LEAVE_REASONS.has(reason) && reason !== 'fullscreen-exit'
        && now - a.countedAt > SEPARATE_ACTION_MS;
      if (a.counted && !separateAction) return false;
      a.counted = true;
      a.reason = reason;
      a.countedAt = now;
    }
    lastViolationAtRef.current = now;

    warningsRef.current += 1;
    const count = warningsRef.current;
    setWarnings(count);
    setLastViolation(reason);
    setShowWarning(true);

    // Log it on the server so the teacher can see
    (async () => {
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
    })();
    return true;
  }, [isMock, started, finish]);

  // -------- Anti-cheat: camera track --------
  useEffect(() => {
    if (!webcamRequired || !started || !cameraStreamRef.current) return;
    const track = cameraStreamRef.current.getVideoTracks()[0];
    if (!track) return;

    const onCameraEnded = async () => {
      if (finishedRef.current) return;
      // Backgrounded (home button / call): the camera is restarted when the student returns.
      if (document.hidden || awayRef.current.away) return;
      // Try to switch it back on; only a camera that stays off is a violation.
      if (!(await restartCamera())) handleViolation('camera-disabled');
    };
    track.addEventListener('ended', onCameraEnded);
    return () => track.removeEventListener('ended', onCameraEnded);
  }, [webcamRequired, started, cameraReady, cameraEpoch, handleViolation, restartCamera]);

  // -------- Anti-cheat: face / gaze tracking on the webcam --------
  const { status: faceStatus } = useFaceMonitor(
    videoRef,
    webcamRequired && started && cameraReady,
    handleViolation
  );

  // -------- Anti-cheat: leaving the test (tab switch, assistant, other app, fullscreen exit) --------
  // One action fires several browser events: switching tabs on a phone also blurs the
  // window and drops fullscreen; Google Assistant / Gemini / Circle to Search blur the
  // window (and may drop fullscreen) while the page stays visible. So collect the events
  // for a moment and record ONE violation that names what actually happened.
  useEffect(() => {
    if (isMock || !started) return;

    const CLASSIFY_DELAY_MS = 700;
    let pending = null; // { hidden, blurred, fullscreenExit, timer }
    let lost = false;   // focus currently lost (one violation per episode)

    const classify = () => {
      const p = pending;
      pending = null;
      if (!p || finishedRef.current) return;
      if (p.hidden || document.hidden) {
        handleViolation('tab-switch');
      } else if (p.blurred && !document.hasFocus()) {
        // Page still visible but something else has focus
        handleViolation(isMobileDevice() ? 'assistant-opened' : 'focus-lost');
      } else if (p.fullscreenExit && !getFullscreenElement() && enteredFullscreenRef.current) {
        handleViolation('fullscreen-exit');
      }
    };
    // Start an away episode (if one isn't already open)
    const markAway = () => {
      const a = awayRef.current;
      if (a.away) return;
      a.away = true;
      // Still inside the previous episode's grace window = same incident, keep its count
      if (Date.now() >= a.graceUntil) a.counted = false;
    };
    // Close the episode once the student is fully back on the test
    const checkBack = () => {
      const a = awayRef.current;
      if (!a.away || finishedRef.current) return;
      if (document.hidden || !document.hasFocus()) return;
      const canFullscreen = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
      if (enteredFullscreenRef.current && canFullscreen && !getFullscreenElement()) return;
      a.away = false;
      a.graceUntil = Date.now() + RETURN_GRACE_MS;
      // Phones stop the camera in the background: turn it back on
      if (webcamRequired) {
        const track = cameraStreamRef.current?.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') {
          restartCamera().then((ok) => {
            if (!ok) setTimeout(() => handleViolation('camera-disabled'), RETURN_GRACE_MS + 100);
          });
        }
      }
    };

    const note = (signal) => {
      if (finishedRef.current) return;
      markAway();
      if (!pending) {
        pending = { hidden: false, blurred: false, fullscreenExit: false };
        pending.timer = setTimeout(classify, CLASSIFY_DELAY_MS);
      }
      pending[signal] = true;
    };

    const onVisibilityChange = () => {
      if (document.hidden) note('hidden');
      else checkBack();
    };

    const onBlur = () => {
      if (lost || finishedRef.current || suppressBlurRef.current) return;
      lost = true;
      setWindowFocused(false); // hide the question right away
      note('blurred');
    };
    const onFocus = () => {
      lost = false;
      setWindowFocused(true);
      checkBack();
    };

    const onFullscreenChange = () => {
      if (finishedRef.current) return;
      if (!getFullscreenElement() && enteredFullscreenRef.current) {
        setOutOfFullscreen(true);
        note('fullscreenExit');
      } else if (getFullscreenElement()) {
        setOutOfFullscreen(false);
        checkBack();
      }
    };

    // Backup check: some phones/overlays never fire 'blur', so poll focus directly.
    const pollId = setInterval(() => {
      if (suppressBlurRef.current) return;
      const focused = document.hasFocus();
      if (!focused && !lost) onBlur();
      else if (focused && lost) onFocus();
      else checkBack();
    }, 500);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    if (!document.hasFocus()) onBlur();
    return () => {
      if (pending) clearTimeout(pending.timer);
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, [isMock, started, handleViolation, webcamRequired, restartCamera]);

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
    if (isAndroidNonChrome()) return; // start button is disabled; guard anyway

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
    if (getFullscreenElement()) {
      // Already fullscreen since login
      enteredFullscreenRef.current = true;
      await beginTest();
      return;
    }
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
    suppressBlurRef.current = true;
    const ok = confirm('Are you sure you want to abort the test? Your progress so far will be saved.');
    suppressBlurRef.current = false;
    setWindowFocused(true);
    if (ok) finish(true);
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
  const watermarkText = watermarkBackground(
    [user?.rollno, user?.name?.trim(), new Date().toLocaleDateString()].filter(Boolean).join(' · ')
  );

  // -------- "Start Test" screen (required to trigger fullscreen from a user gesture) --------
  if (!started) {
    const minutes = Math.round(totalSeconds / 60);
    const requireChrome = !isMock && isAndroidNonChrome();
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
          ['🚫', 'Right-click, copy, text selection and developer tools are disabled.'],
          ['🤖', <>Don&apos;t open <strong>Google Assistant, Gemini, Circle to Search</strong> or any overlay — the question hides and it counts as a warning.</>],
          ['📵', <>Turn on <strong>Do Not Disturb</strong> before starting so calls and notifications can&apos;t interrupt you. If a call comes in or you leave by mistake, it counts as <strong>only one</strong> warning — come back, tap <strong>Resume Fullscreen</strong> and carry on. Your answers are saved.</>],
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
          {requireChrome && (
            <div className="alert alert-error">
              This test must be taken in <strong>Google Chrome</strong>. Open this page in Chrome
              (install it from the Play Store if needed), log in again, and start the test there.
            </div>
          )}
          <button className="btn btn-primary btn-block btn-lg" onClick={handleStart} disabled={requireChrome}>
            I understand — Start Test
          </button>
        </div>
      </div>
    );
  }

  // -------- Active quiz --------
  const q = questions[idx];
  const questionType = q?.type || 'MCQ';
  const numberValid = isNumberText(numberText);
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
            {VIOLATION_MESSAGES[lastViolation] || 'Suspicious activity detected.'}
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
              This counts as one warning (only one, however long you were away). Return to fullscreen
              to keep answering — your answers so far are saved. The countdown keeps running while you&apos;re out.
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

      <div className={`quiz-card ${isMock ? '' : 'quiz-card--protected'}`}>
        {!isMock && (
          <div className="quiz-watermark" aria-hidden="true" style={{ backgroundImage: watermarkText }} />
        )}
        {submitting ? (
          <div className="loader" />
        ) : !windowFocused && !isMock ? (
          <div className="quiz-hidden-notice" role="alert">
            <h3>Question hidden</h3>
            <p className="text-muted">
              The test window lost focus. Close any assistant, overlay or other app
              and tap here to continue. This has been recorded.
            </p>
          </div>
        ) : (
          <>
            <div className="question-header">
              <span className="question-number">{idx + 1}</span>
              <div className="question-title" aria-hidden={isMock ? undefined : 'true'}><RichText value={q.title} /></div>
            </div>
            {q.image && (
              <div className="question-picture">
                <Picture imageKey={q.image} zoomable />
              </div>
            )}
            {err && <div className="alert alert-error" role="alert">{err}</div>}
            {questionType === 'MULTI' && (
              <p className="quiz-type-hint">Select all correct options, then press Submit answer.</p>
            )}
            {questionType === 'NUMERIC' ? (
              <form
                className="quiz-numeric"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (numberValid) submitAnswerOrSkip(numberText.trim());
                }}
              >
                <label htmlFor="numeric-answer">Your answer</label>
                <input
                  id="numeric-answer"
                  className="form-control"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Type a number"
                  value={numberText}
                  onChange={(e) => {
                    const text = e.target.value;
                    setNumberText(text);
                    draftRef.current = isNumberText(text) ? text.trim() : null;
                  }}
                  disabled={submitting || outOfFullscreen}
                  autoFocus
                />
                {numberText.trim() !== '' && !numberValid && (
                  <div className="quiz-input-error">Enter a number, e.g. 42, -3.5 or 0.25</div>
                )}
                <button type="submit" className="btn btn-primary quiz-submit-answer" disabled={!numberValid || submitting || outOfFullscreen}>
                  Submit answer
                </button>
              </form>
            ) : (
              <div className="quiz-options" role={questionType === 'MULTI' ? 'group' : undefined}>
                {(q.optionOrder || ['a', 'b', 'c', 'd']).map((key, pos) => {
                  const ticked = questionType === 'MULTI' ? picks.includes(key) : selected === key;
                  return (
                    <button
                      key={key}
                      className={`option-btn ${questionType === 'MULTI' ? 'option-btn--multi' : ''} ${ticked ? 'is-selected' : ''}`}
                      onClick={() => {
                        if (questionType !== 'MULTI') {
                          submitAnswerOrSkip(key);
                          return;
                        }
                        const next = picks.includes(key) ? picks.replace(key, '') : [...picks, key].sort().join('');
                        setPicks(next);
                        draftRef.current = next || null;
                      }}
                      disabled={submitting || outOfFullscreen}
                      aria-pressed={questionType === 'MULTI' ? ticked : undefined}
                      aria-label={isMock ? undefined : `Option ${'ABCD'[pos]}`}
                    >
                      {/* Shown letter follows the (possibly shuffled) position; the original key is what's sent */}
                      <span className="option-letter">{questionType === 'MULTI' && ticked ? '✓' : 'ABCD'[pos]}</span>
                      <span className="option-text" aria-hidden={isMock ? undefined : 'true'}>
                        {q.optionImages?.[key] && <Picture imageKey={q.optionImages[key]} className="option-picture" alt={`Option ${'ABCD'[pos]}`} />}
                        {q[`option${key.toUpperCase()}`]}
                      </span>
                    </button>
                  );
                })}
                {questionType === 'MULTI' && (
                  <button
                    className="btn btn-primary quiz-submit-answer"
                    onClick={() => submitAnswerOrSkip(picks)}
                    disabled={!picks || submitting || outOfFullscreen}
                  >
                    Submit answer
                  </button>
                )}
              </div>
            )}
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

// Same rule as the server: optional sign, digits with an optional decimal point, optional exponent
function isNumberText(text) {
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(String(text).trim().replace(/,/g, ''));
}
