import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const REDIRECT_SECONDS = 5;

// What to tell the student for each way a test can end (status comes from Quiz.finish)
function describe(status) {
  if (/auto-submitted/i.test(status)) {
    return { tone: 'danger', icon: '!', title: 'Test auto-submitted', text: 'Your test was submitted automatically after too many warnings. Your answers so far have been saved.' };
  }
  if (/aborted/i.test(status)) {
    return { tone: 'warning', icon: '■', title: 'Test ended', text: 'You ended the test early. Your answers so far have been saved.' };
  }
  return { tone: 'success', icon: '✓', title: 'Test submitted', text: 'Well done! Your answers have been saved. Your teacher will share the results.' };
}

export default function TestFinished() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tone, icon, title, text } = describe(location.state?.status || 'Completed');
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) {
      navigate('/', { replace: true });
      return undefined;
    }
    const t = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, navigate]);

  return (
    <div className="center-page">
      <div className="center-card text-center finish-card">
        <div className={`finish-icon finish-icon--${tone}`} aria-hidden="true">{icon}</div>
        <h1>{title}</h1>
        <p className="text-muted">{text}</p>
        <p className="finish-redirect">
          Returning to the login page in <strong>{secondsLeft}s</strong>
        </p>
        <button className="btn btn-secondary btn-block" onClick={() => navigate('/', { replace: true })}>
          Go to login now
        </button>
      </div>
    </div>
  );
}
