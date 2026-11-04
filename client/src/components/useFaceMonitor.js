import { useEffect, useRef, useState } from 'react';

/**
 * Webcam face monitoring for proctored tests, using MediaPipe Face Landmarker (runs fully in-browser).
 *
 * Reports a violation when, continuously for longer than the grace period, the student:
 *   - 'looking-away'      turns their head away or looks hard to the side
 *   - 'face-not-visible'  leaves the frame / covers the camera
 *   - 'multiple-faces'    has someone else in view
 *
 * A violation is reported once per episode — the student has to look back at the screen
 * before the same episode can count again, so one long glance away is one warning, not three.
 */

// Self-hosted: the WASM runtime is copied from node_modules by vite.config.js,
// the model lives in public/mediapipe/
const WASM_URL = '/mediapipe/wasm';
const MODEL_URL = '/mediapipe/face_landmarker.task';

const DETECT_INTERVAL_MS = 200;
// How long a problem must last before it counts as a violation
const GRACE_MS = { 'looking-away': 2000, 'face-not-visible': 3000, 'multiple-faces': 1500 };

// Head pose thresholds, as the nose's position between the face edges (0.5 = centred)
const YAW_MIN = 0.3;    // turned to one side
const YAW_MAX = 0.7;    // turned to the other side
const PITCH_MIN = 0.3;  // looking up
const PITCH_MAX = 0.72; // looking well down (some downward tilt is normal while reading)
// Eye blendshape score (0..1) that counts as eyes turned hard to the side
const EYE_SIDE_MAX = 0.7;

// Face mesh landmark indices
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const CHEEK_LEFT = 234;
const CHEEK_RIGHT = 454;

let landmarkerPromise = null;
function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: true
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        return FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
    })().catch((err) => {
      landmarkerPromise = null; // allow a retry on the next test start
      throw err;
    });
  }
  return landmarkerPromise;
}

function isLookingAway(landmarks, blendshapes) {
  const nose = landmarks[NOSE_TIP];
  const left = landmarks[CHEEK_LEFT];
  const right = landmarks[CHEEK_RIGHT];
  const top = landmarks[FOREHEAD];
  const bottom = landmarks[CHIN];

  const width = right.x - left.x;
  const height = bottom.y - top.y;
  if (Math.abs(width) < 1e-3 || Math.abs(height) < 1e-3) return true;

  const yaw = (nose.x - left.x) / width;
  const pitch = (nose.y - top.y) / height;
  if (yaw < YAW_MIN || yaw > YAW_MAX || pitch < PITCH_MIN || pitch > PITCH_MAX) return true;

  if (blendshapes) {
    const score = (name) => blendshapes.find((c) => c.categoryName === name)?.score || 0;
    // Both eyes turned the same way = looking sideways (one eye "in" + the other "out")
    const lookingLeft = Math.min(score('eyeLookOutLeft'), score('eyeLookInRight'));
    const lookingRight = Math.min(score('eyeLookInLeft'), score('eyeLookOutRight'));
    if (Math.max(lookingLeft, lookingRight) > EYE_SIDE_MAX) return true;
  }
  return false;
}

/**
 * @param {React.RefObject<HTMLVideoElement>} videoRef  the <video> showing the webcam stream
 * @param {boolean} enabled                              monitor only while the test is running
 * @param {(type: string) => void} onViolation           called once per sustained problem
 * @returns {{ status: 'loading'|'ok'|'looking-away'|'face-not-visible'|'multiple-faces'|'unavailable' }}
 */
export default function useFaceMonitor(videoRef, enabled, onViolation) {
  const [status, setStatus] = useState('loading');
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let intervalId = null;
    let problem = null;       // current problem type, or null when all good
    let problemSince = 0;
    let reported = false;     // already reported this episode
    let lastVideoTime = -1;

    loadLandmarker()
      .then((landmarker) => {
        if (cancelled) return;
        setStatus('ok');
        intervalId = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;

          let result;
          try {
            result = landmarker.detectForVideo(video, performance.now());
          } catch {
            return;
          }

          const faces = result.faceLandmarks || [];
          let next = null;
          if (faces.length === 0) next = 'face-not-visible';
          else if (faces.length > 1) next = 'multiple-faces';
          else if (isLookingAway(faces[0], result.faceBlendshapes?.[0]?.categories)) next = 'looking-away';

          const now = Date.now();
          if (next !== problem) {
            problem = next;
            problemSince = now;
            reported = false;
            setStatus(next || 'ok');
          } else if (problem && !reported && now - problemSince >= GRACE_MS[problem]) {
            reported = true;
            onViolationRef.current(problem);
          }
        }, DETECT_INTERVAL_MS);
      })
      .catch((err) => {
        console.error('[face-monitor] could not start face tracking', err);
        if (!cancelled) setStatus('unavailable');
      });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled, videoRef]);

  return { status };
}
