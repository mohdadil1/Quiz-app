import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/admin');
  };

  // Close sidebar after any nav click on mobile
  const handleNavClick = () => onClose();

  return (
    <>
      {/* Backdrop — only visible on mobile when sidebar is open */}
      <div
        className={`sidebar-backdrop ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand">Quizora</div>
        <nav>
          <NavLink to="/admin/dashboard" end onClick={handleNavClick}>Dashboard</NavLink>
          <NavLink to="/admin/data" onClick={handleNavClick}>Add Class / Student</NavLink>
          <NavLink to="/admin/statistics" onClick={handleNavClick}>Statistics</NavLink>
          <NavLink to="/admin/view-data" onClick={handleNavClick}>View Data</NavLink>
          <a href="#logout" onClick={(e) => { e.preventDefault(); handleLogout(); }}>Logout</a>
        </nav>
      </aside>
    </>
  );
}
