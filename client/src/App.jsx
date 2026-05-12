import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

// Public / login pages
import StudentLogin from './pages/StudentLogin';
import TeacherLogin from './pages/TeacherLogin';

// Teacher pages
import TeacherDashboard from './pages/TeacherDashboard';
import NewTest from './pages/NewTest';
import TestDetails from './pages/TestDetails';
import AddQuestion from './pages/AddQuestion';
import AddData from './pages/AddData';
import ViewData from './pages/ViewData';
import Statistics from './pages/Statistics';
import TestStats from './pages/TestStats';
import TestQuestionStats from './pages/TestQuestionStats';
import StudentCredentials from './pages/StudentCredentials';

// Student pages
import StudentDashboard from './pages/StudentDashboard';
import Quiz from './pages/Quiz';
import TestFinished from './pages/TestFinished';

export default function App() {
  const { role } = useAuth();

  useEffect(() => {
    document.body.classList.toggle('student-theme', role === 'student');
  }, [role]);
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<StudentLogin />} />
      <Route path="/admin" element={<TeacherLogin />} />

      {/* Teacher */}
      <Route
        path="/admin/dashboard"
        element={<ProtectedRoute role="teacher"><TeacherDashboard /></ProtectedRoute>}
      />
      <Route
        path="/admin/new-test"
        element={<ProtectedRoute role="teacher"><NewTest /></ProtectedRoute>}
      />
      <Route
        path="/admin/tests/:id"
        element={<ProtectedRoute role="teacher"><TestDetails /></ProtectedRoute>}
      />
      <Route
        path="/admin/tests/:id/add-question"
        element={<ProtectedRoute role="teacher"><AddQuestion /></ProtectedRoute>}
      />
      <Route
        path="/admin/tests/:id/credentials"
        element={<ProtectedRoute role="teacher"><StudentCredentials /></ProtectedRoute>}
      />
      <Route
        path="/admin/data"
        element={<ProtectedRoute role="teacher"><AddData /></ProtectedRoute>}
      />
      <Route
        path="/admin/view-data"
        element={<ProtectedRoute role="teacher"><ViewData /></ProtectedRoute>}
      />
      <Route
        path="/admin/statistics"
        element={<ProtectedRoute role="teacher"><Statistics /></ProtectedRoute>}
      />
      <Route
        path="/admin/tests/:id/stats"
        element={<ProtectedRoute role="teacher"><TestStats /></ProtectedRoute>}
      />
      <Route
        path="/admin/tests/:id/question-stats"
        element={<ProtectedRoute role="teacher"><TestQuestionStats /></ProtectedRoute>}
      />

      {/* Student */}
      <Route
        path="/student/dashboard"
        element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>}
      />
      <Route
        path="/student/quiz"
        element={<ProtectedRoute role="student"><Quiz /></ProtectedRoute>}
      />
      <Route path="/student/finished" element={<TestFinished />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
