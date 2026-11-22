const mongoose = require('mongoose');

// Log the connection target without the username/password
const redact = (uri = '') => uri.replace(/\/\/[^@/]*@/, '//***@');

// Reuses one connection per process — on Vercel the same warm function instance serves many requests
let connecting = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    const uri = process.env.MONGO_URI;
    // Vercel runs many copies of the API at once and each keeps its own pool, so keep
    // each pool small — the total must stay under the database's connection limit
    // (e.g. 500 on Atlas free/shared tiers). Raise MONGO_POOL_SIZE on a long-running server.
    connecting = mongoose.connect(uri, {
      maxPoolSize: Number(process.env.MONGO_POOL_SIZE) || 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60 * 1000,
      serverSelectionTimeoutMS: 10 * 1000
    })
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
