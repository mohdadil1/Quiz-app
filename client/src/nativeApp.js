// Talking to the Quizora Android and iOS apps (see android/ and ios/), when the site runs
// inside one of them.
// In a normal browser every function here falls back to the browser's own behaviour.

export const inQuizoraApp = () => typeof window !== 'undefined' && !!window.QuizoraApp;

// The app also reports focus and background changes itself, because in-app browsers
// don't always fire the page's own blur / visibilitychange events.
export const pageHidden = () => document.hidden || window.__quizoraHidden === true;
export const pageHasFocus = () => document.hasFocus() && window.__quizoraFocus !== false;

/**
 * Ask the app to lock down for a test: pin itself (Android screen pinning, or iOS
 * assessment mode where available), hide the system bars, keep the screen on. Resolves
 * with { pinned } once the system's prompt or transition (if any) has finished, so it
 * doesn't count as leaving the test.
 */
export function startAppExam(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!inQuizoraApp()) {
      resolve({ pinned: false });
      return;
    }
    let done = false;
    const finish = (detail) => {
      if (done) return;
      done = true;
      window.removeEventListener('quizora-exam-ready', onReady);
      resolve(detail || { pinned: false });
    };
    const onReady = (e) => finish(e.detail);
    window.addEventListener('quizora-exam-ready', onReady);
    setTimeout(() => finish({ pinned: false, timedOut: true }), timeoutMs);
    try {
      window.QuizoraApp.startExam();
    } catch {
      finish({ pinned: false });
    }
  });
}

export function endAppExam() {
  try {
    window.QuizoraApp?.endExam();
  } catch {
    // not in the app
  }
}
