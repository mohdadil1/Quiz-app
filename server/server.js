require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();

// Allow multiple origins for development and production
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_ORIGIN,
  'https://quiz-app-sigma-lemon-97.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server) and
    // allow explicit whitelisted origins.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Allow any localhost origins (different dev ports like :5174)
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return callback(null, true);
      }
    } catch (e) {
      // ignore parse errors
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quizora-api' }));

// Routes
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/tests', require('./routes/testRoutes'));
app.use('/api/questions', require('./routes/questionRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));

// 404
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// Error handler — any uncaught throw inside an async controller lands here
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;

(async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
})();
