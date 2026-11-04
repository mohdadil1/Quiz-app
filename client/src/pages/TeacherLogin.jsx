import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const getDeviceInfo = () => ({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  language: navigator.language,
  screenResolution: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
});

// Teacher login, plus "Create account" so each teacher gets their own private tests and classes
export default function TeacherLogin() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState(''); // email the current code was sent to
  const [resendIn, setResendIn] = useState(0);      // seconds until "Resend code" is allowed
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const isSignup = mode === 'signup';

  const codeSent = isSignup && codeSentTo !== '' && codeSentTo === email.trim().toLowerCase();

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const switchMode = (next) => {
    setMode(next);
    setErr('');
    setInfo('');
    setPassword('');
    setConfirmPassword('');
    setCode('');
    setCodeSentTo('');
  };

  const sendCode = async () => {
    setErr('');
    setInfo('');
    if (password.length < 6) return setErr('Password must be at least 6 characters');
    if (password !== confirmPassword) return setErr('Passwords do not match');
    setLoading(true);
    try {
      await api.post('/teachers/register/send-code', { email });
      setCodeSentTo(email.trim().toLowerCase());
      setCode('');
      setResendIn(60);
      setInfo(`We sent a 6-digit code to ${email.trim()}. It expires in 10 minutes.`);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Could not send the verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSignup && !codeSent) return sendCode();
    setErr('');
    if (isSignup) {
      if (password.length < 6) return setErr('Password must be at least 6 characters');
      if (password !== confirmPassword) return setErr('Passwords do not match');
    }
    setLoading(true);
    try {
      const { data } = isSignup
        ? await api.post('/teachers/register', { name: name.trim(), email, password, code: code.trim(), deviceInfo: getDeviceInfo() })
        : await api.post('/teachers/login', { email, password, deviceInfo: getDeviceInfo() });
      login(data.token, 'teacher', data.teacher, data.sessionId);
      navigate('/admin/dashboard');
    } catch (e) {
      setErr(isSignup ? (e?.response?.data?.message || 'Could not create account') : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-page">
      <div className="center-card">
        <h1>{isSignup ? 'Create Teacher Account' : 'Teacher Login'}</h1>
        {err && <div className="alert alert-error">{err}</div>}
        {info && !err && <div className="alert alert-info">{info}</div>}
        <form onSubmit={handleSubmit}>
          {isSignup && (
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
              />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input
              type={isSignup ? 'email' : 'text'}
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus={!isSignup}
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
          </div>
          {isSignup && (
            <div className="form-group">
              <label>Confirm password</label>
              <input
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}
          {codeSent && (
            <div className="form-group">
              <label>Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="form-control"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code from your email"
                autoFocus
                required
              />
              <div className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                Didn&apos;t get it? Check spam, or{' '}
                {resendIn > 0 ? (
                  <span>resend in {resendIn}s</span>
                ) : (
                  <a href="#resend" onClick={(e) => { e.preventDefault(); sendCode(); }}>resend code</a>
                )}
              </div>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading || (codeSent && code.length !== 6)}>
            {!isSignup
              ? (loading ? 'Logging in…' : 'Login')
              : !codeSent
                ? (loading ? 'Sending code…' : 'Send Verification Code')
                : (loading ? 'Creating account…' : 'Create Account')}
          </button>
        </form>
        <div className="text-center mt-3">
          {isSignup ? (
            <a href="#login" className="text-muted" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>
              Already have an account? Log in
            </a>
          ) : (
            <a href="#signup" className="text-muted" onClick={(e) => { e.preventDefault(); switchMode('signup'); }}>
              New teacher? Create an account
            </a>
          )}
        </div>
        <div className="text-center mt-2">
          <Link to="/" className="text-muted">Student login →</Link>
        </div>
      </div>
    </div>
  );
}
