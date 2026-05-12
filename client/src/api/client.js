import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://quiz-app-backend-cb2q.onrender.com/api'
});

// Attach the saved JWT (if any) to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('quizora_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the server says the token is bad/expired, wipe it and bounce to login
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const role = localStorage.getItem('quizora_role');
      localStorage.removeItem('quizora_token');
      localStorage.removeItem('quizora_role');
      localStorage.removeItem('quizora_user');
      // Only redirect if we're not already on a login page, otherwise we get a loop
      const path = window.location.pathname;
      if (path !== '/' && path !== '/admin') {
        window.location.href = role === 'teacher' ? '/admin' : '/';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
