import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Self-host MediaPipe's WASM runtime at /mediapipe/wasm/ (used by webcam face tracking).
// Served straight from node_modules in dev and copied into dist on build, so the files
// never go into git and always match the installed @mediapipe/tasks-vision version.
const MEDIAPIPE_WASM_DIR = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
const MEDIAPIPE_WASM_URL = '/mediapipe/wasm/';

function mediapipeWasm() {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use(MEDIAPIPE_WASM_URL, (req, res, next) => {
        const file = path.join(MEDIAPIPE_WASM_DIR, path.basename(req.url.split('?')[0]));
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of fs.readdirSync(MEDIAPIPE_WASM_DIR)) {
        this.emitFile({
          type: 'asset',
          fileName: `mediapipe/wasm/${name}`,
          source: fs.readFileSync(path.join(MEDIAPIPE_WASM_DIR, name))
        });
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), mediapipeWasm()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'https://quiz-app-backend-cb2q.onrender.com'
    }
  }
});
