// Vercel serverless entry: every request is routed here (see vercel.json)
const app = require('../server');
const connectDB = require('../config/db');

module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch {
    return res.status(503).json({ message: 'Database unavailable, please retry' });
  }
  return app(req, res);
};
