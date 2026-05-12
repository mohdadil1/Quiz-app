import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function TeacherLayout({ title, children, actions }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Auto-close sidebar on route change (covers non-NavLink navigation too)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Lock body scroll while sidebar is open on mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              aria-label="Toggle navigation menu"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <span></span>
              <span></span>
              <span></span>
            </button>
            <h2>{title}</h2>
          </div>
          {actions && <div className="topbar-right">{actions}</div>}
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
