import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

// Random id that stays in this browser, so the server can tell devices apart
// (Chrome on Android reports almost the same user agent on every phone).
function getDeviceId() {
  const KEY = 'quizora_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

// Shown once after this browser was signed out because the test was opened elsewhere
function takeSignedOutNotice() {
  try {
    const msg = sessionStorage.getItem('quizora_signed_out');
    sessionStorage.removeItem('quizora_signed_out');
    return msg || '';
  } catch {
    return '';
  }
}

// Fullscreen has to be requested straight from the click, so it is asked for
// when the Login button is pressed (before the network call) and kept on the dashboard.
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  try {
    request?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  } catch { /* not supported */ }
}

function leaveFullscreen() {
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  try {
    exit?.call(document)?.catch?.(() => {});
  } catch { /* ignore */ }
}

export default function StudentLogin() {
  const [rollno, setRollno] = useState('');
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [err, setErr] = useState(takeSignedOutNotice);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!rollno.trim() || accessCode.length !== 4) {
      setErr('Please enter your USN and the 4-digit access code');
      return;
    }
    enterFullscreen();
    setLoading(true);
    try {
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screenResolution: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      const { data } = await api.post('/students/login', { rollno: rollno.trim(), name: name.trim(), accessCode, deviceInfo, deviceId: getDeviceId() });
      login(data.token, 'student', {
        rollno: data.rollno,
        name: data.name || name.trim(),
        testId: data.testId,
        testName: data.testName,
        testStatus: data.testStatus,
        testMode: data.testMode,
        webcamProctoring: data.webcamProctoring !== false,
        timingMode: data.timingMode || 'PER_QUESTION',
        totalTimeMinutes: data.totalTimeMinutes
      });
      if (data.testMode === 'MOCK') leaveFullscreen(); // practice tests don't use fullscreen
      navigate('/student/dashboard');
    } catch (e) {
      leaveFullscreen();
      if (e?.response?.status === 429) {
        setErr(e.response.data?.message || 'Too many login attempts. Please wait a few minutes and try again.');
      } else if (e?.response?.data?.message === 'TEST_OPEN_ON_ANOTHER_DEVICE') {
        setErr('You are already logged in to this test on another device. Continue on that device, or ask your teacher to unlock it. This attempt has been recorded.');
      } else {
        setErr('Wrong USN or access code');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-page">
      <div className="center-card">
        <h1>Student Login</h1>
        {err && <div className="alert alert-error">{err}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>USN</label>
            <input
              type="text"
              className="form-control"
              value={rollno}
              onChange={(e) => setRollno(e.target.value)}
              placeholder="USN (e.g. 1AB21CS001)"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Name <span className="text-muted">(optional)</span></label>
            <input
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="form-group">
            <label>Access code</label>
            <input
              type="text"
              className="form-control access-code-input"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-digit code from your teacher"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
        <div className="text-center mt-3">
          <Link to="/admin" className="text-muted">Teacher login →</Link>
        </div>
      </div>
    </div>
  );
}
