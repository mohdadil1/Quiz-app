import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';

const getDeviceInfo = () => ({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  language: navigator.language,
  screenResolution: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
});

const TITLES = { login: 'Teacher Login', signup: 'Create Teacher Account', forgot: 'Reset Password' };
const SEND_CODE_URL = { signup: '/teachers/register/send-code', forgot: '/teachers/password/send-code' };

// Teacher login, "Create account" (email-verified) and "Forgot password" (emailed reset code)
export default function TeacherLogin() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
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
  const isForgot = mode === 'forgot';

  const codeSent = mode !== 'login' && codeSentTo !== '' && codeSentTo === email.trim().toLowerCase();
  // Signup asks for the password before sending the code; reset asks for the new one after
  const showPasswordFields = !isForgot || codeSent;

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

  const checkNewPassword = () => {
    if (password.length < 6) return 'Password must be at least 6 characters';
    if (password !== confirmPassword) return 'Passwords do not match';
    return '';
  };

  const sendCode = async () => {
    setErr('');
    setInfo('');
    if (isSignup) {
      const problem = checkNewPassword();
      if (problem) return setErr(problem);
    }
    setLoading(true);
    try {
      await api.post(SEND_CODE_URL[mode], { email });
      setCodeSentTo(email.trim().toLowerCase());
      setCode('');
      setResendIn(60);
      setInfo(isForgot
        ? `If an account exists for ${email.trim()}, we sent it a 6-digit code. It expires in 10 minutes.`
        : `We sent a 6-digit code to ${email.trim()}. It expires in 10 minutes.`);
    } catch (e) {
      setErr(e?.response?.data?.message || 'Could not send the code');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode !== 'login' && !codeSent) return sendCode();
    setErr('');
    if (mode !== 'login') {
      const problem = checkNewPassword();
      if (problem) return setErr(problem);
    }
    setLoading(true);
    try {
      const deviceInfo = getDeviceInfo();
      const { data } = mode === 'login'
        ? await api.post('/teachers/login', { email, password, deviceInfo })
        : isSignup
          ? await api.post('/teachers/register', { name: name.trim(), email, password, code: code.trim(), deviceInfo })
          : await api.post('/teachers/password/reset', { email, password, code: code.trim(), deviceInfo });
      login(data.token, 'teacher', data.teacher, data.sessionId);
      navigate('/admin/dashboard');
    } catch (e) {
      const fallback = { login: 'Login failed', signup: 'Could not create account', forgot: 'Could not reset password' }[mode];
      setErr(mode === 'login' ? fallback : (e?.response?.data?.message || fallback));
    } finally {
      setLoading(false);
    }
  };

  const submitLabel = mode === 'login'
    ? (loading ? 'Logging in…' : 'Login')
    : !codeSent
      ? (loading ? 'Sending code…' : isForgot ? 'Send Reset Code' : 'Send Verification Code')
      : isForgot
        ? (loading ? 'Resetting…' : 'Reset Password')
        : (loading ? 'Creating account…' : 'Create Account');

  return (
    <div className="center-page">
      <div className="center-card">
        <h1>{TITLES[mode]}</h1>
        {isForgot && !codeSent && (
          <p className="text-muted">Enter your account email and we&apos;ll send you a code to set a new password.</p>
        )}
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
              type={mode === 'login' ? 'text' : 'email'}
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus={!isSignup}
              autoComplete="email"
              required
            />
          </div>
          {codeSent && (
            <div className="form-group">
              <label>{isForgot ? 'Reset code' : 'Verification code'}</label>
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
          {showPasswordFields && (
            <div className="form-group">
              <label>{isForgot ? 'New password' : 'Password'}</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? 'Your password' : 'At least 6 characters'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              {mode === 'login' && (
                <div className="text-right mt-2" style={{ fontSize: '0.85rem' }}>
                  <a href="#forgot" onClick={(e) => { e.preventDefault(); switchMode('forgot'); }}>Forgot password?</a>
                </div>
              )}
            </div>
          )}
          {showPasswordFields && mode !== 'login' && (
            <div className="form-group">
              <label>{isForgot ? 'Confirm new password' : 'Confirm password'}</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading || (codeSent && code.length !== 6)}>
            {submitLabel}
          </button>
        </form>
        <div className="text-center mt-3">
          {mode === 'login' ? (
            <a href="#signup" className="text-muted" onClick={(e) => { e.preventDefault(); switchMode('signup'); }}>
              New teacher? Create an account
            </a>
          ) : (
            <a href="#login" className="text-muted" onClick={(e) => { e.preventDefault(); switchMode('login'); }}>
              {isForgot ? 'Back to login' : 'Already have an account? Log in'}
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
