import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { logout, user } = useAuth();
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
        <div className="brand">
          Quizora
          {user?.email && (
            <NavLink to="/admin/profile" className="sidebar-account" title={`${user.email} — view profile`} onClick={handleNavClick}>
              <Avatar src={user.avatar} name={user.name} email={user.email} size={32} />
              <span>{user.name || user.email}</span>
            </NavLink>
          )}
        </div>
        <nav>
          <NavLink to="/admin/profile" onClick={handleNavClick}>Profile</NavLink>
          <NavLink to="/admin/dashboard" end onClick={handleNavClick}>Dashboard</NavLink>
          <NavLink to="/admin/data" onClick={handleNavClick}>Add Class / Student</NavLink>
          <NavLink to="/admin/student-data" onClick={handleNavClick}>Get Student Data</NavLink>
          <NavLink to="/admin/statistics" onClick={handleNavClick}>Statistics</NavLink>
          <NavLink to="/admin/view-data" onClick={handleNavClick}>View Data</NavLink>
          <a href="#logout" onClick={(e) => { e.preventDefault(); handleLogout(); }}>Logout</a>
        </nav>
        <div className="sidebar-credit">Made by Dil <span role="img" aria-label="love">❤️</span></div>
      </aside>
    </>
  );
}
