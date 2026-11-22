import { useEffect, useRef } from 'react';

/**
 * Call `fn` repeatedly while `enabled`, every `minMs`–`maxMs` (a random gap each time,
 * so a whole exam hall doesn't hit the server in the same second). Pauses while the tab
 * is hidden and checks once as soon as it's visible again.
 */
export default function usePolling(fn, { minMs, maxMs = minMs, enabled = true }) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === 'hidden') return;
      const gap = minMs + Math.random() * Math.max(0, maxMs - minMs);
      timer = setTimeout(async () => {
        try { await fnRef.current(); } catch { /* the page shows its own errors */ }
        schedule();
      }, gap);
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fnRef.current();
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, minMs, maxMs]);
}
