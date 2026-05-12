import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function TestFinished() {
  const location = useLocation();
  const navigate = useNavigate();
  const status = location.state?.status || 'Submitted';

  useEffect(() => {
    const t = setTimeout(() => navigate('/', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div className="center-page">
      <div className="center-card text-center">
        <h1>Test {status}</h1>
        <p className="text-muted">You will be logged out shortly…</p>
        <div className="loader" style={{ width: 40, height: 40, borderWidth: 4, margin: '24px auto 0' }} />
      </div>
    </div>
  );
}
