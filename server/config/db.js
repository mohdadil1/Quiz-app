const mongoose = require('mongoose');

// Log the connection target without the username/password
const redact = (uri = '') => uri.replace(/\/\/[^@/]*@/, '//***@');

// Reuses one connection per process — on Vercel the same warm function instance serves many requests
let connecting = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    const uri = process.env.MONGO_URI;
    connecting = mongoose.connect(uri)
      .then((m) => {
        console.log(`[db] connected → ${redact(uri)}`);
        return m.connection;
      })
      .catch((err) => {
        connecting = null; // let the next request retry
        console.error('[db] connection error:', err.message);
        throw err;
      });
  }
  return connecting;
}

module.exports = connectDB;
