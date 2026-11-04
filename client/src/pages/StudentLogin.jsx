import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';

export default function StudentLogin() {
  const [rollno, setRollno] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!rollno.trim() || !password) {
      setErr('Please enter your USN and password');
      return;
    }
    setLoading(true);
    try {
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screenResolution: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      const { data } = await api.post('/students/login', { rollno: rollno.trim(), name: name.trim(), password, deviceInfo });
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
      navigate('/student/dashboard');
    } catch (e) {
      setErr('Wrong credentials entered');
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
            <label>Password</label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
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
