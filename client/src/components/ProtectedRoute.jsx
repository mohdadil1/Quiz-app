import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ role, children }) {
  const { token, role: currentRole } = useAuth();
  const location = useLocation();

  if (!token) {
    // Not signed in → send to the appropriate login page
    const loginPath = role === 'teacher' ? '/admin' : '/';
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  if (role && currentRole !== role) {
    // Signed in but wrong role — send them to their own landing
    const home = currentRole === 'teacher' ? '/admin/dashboard' : '/student/dashboard';
    return <Navigate to={home} replace />;
  }

  return children;
}
