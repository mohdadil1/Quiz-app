import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('quizora_token'));
  const [role, setRole] = useState(() => localStorage.getItem('quizora_role'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('quizora_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('quizora_sessionId'));

  const login = useCallback((token, role, user, sessionId) => {
    localStorage.setItem('quizora_token', token);
    localStorage.setItem('quizora_role', role);
    localStorage.setItem('quizora_user', JSON.stringify(user));
    if (sessionId) {
      localStorage.setItem('quizora_sessionId', sessionId);
      setSessionId(sessionId);
    }
    setToken(token);
    setRole(role);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) {
        if (role === 'teacher') {
          await api.post('/teachers/logout');
        } else if (role === 'student') {
          await api.post('/students/logout');
        }
      }
    } catch (e) {
      // Ignore logout errors
    }
    localStorage.removeItem('quizora_token');
    localStorage.removeItem('quizora_role');
    localStorage.removeItem('quizora_user');
    localStorage.removeItem('quizora_sessionId');
    setToken(null);
    setRole(null);
    setUser(null);
    setSessionId(null);
  }, [token, role]);

  return (
    <AuthContext.Provider value={{ token, role, user, sessionId, login, logout, isAuthed: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
