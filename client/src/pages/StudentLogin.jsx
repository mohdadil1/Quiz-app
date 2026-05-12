import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function StudentLogin() {
  const [rollno, setRollno] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!rollno || !name || !password) {
      setErr('Please enter roll number, name, and password');
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
      const { data } = await api.post('/students/login', { rollno: Number(rollno), name: name.trim(), password, deviceInfo });
      login(data.token, 'student', {
        rollno: data.rollno,
        name: data.name || name.trim(),
        testId: data.testId,
        testName: data.testName,
        testStatus: data.testStatus
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
            <label>Roll Number</label>
            <input
              type="text"
              className="form-control"
              value={rollno}
              onChange={(e) => setRollno(e.target.value)}
              placeholder="Roll Number"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
            <div className="form-check mt-1">
              <input
                type="checkbox"
                id="showPassword"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              <label htmlFor="showPassword" className="form-check-label">Show password</label>
            </div>
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
