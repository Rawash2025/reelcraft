// Face detection + tracking, for face-aware reframing and layout.
//
// Uses MediaPipe FaceDetector (same tasks-vision package already loaded for
// segmentation). Detections are cheap and cached per source; the layout solver
// and the reframe engine read a smoothed face box so overlays avoid the face
// and zooms keep the eyes framed.

import { log } from './log.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detector = null;
let loading = null;
let failed = false;

export const faceTrackFailed = () => failed;

export async function initFaceTracker() {
  if (detector) return detector;
  if (failed) throw new Error('Face tracking unavailable.');
  if (loading) return loading;
  loading = (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
    }).catch(async () =>
      FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      })
    );
    return detector;
  })();
  try { return await loading; }
  catch (e) { failed = true; loading = null; throw new Error(`Face model load failed: ${e.message}`); }
}

let lastStamp = -1;

/**
 * Detect the primary face in an element. Returns a normalised box
 * { x, y, w, h, cx, cy } in 0..1, or null. Picks the largest face.
 */
export function detectFace(el, timeMs) {
  if (!detector || !el) return null;
  const W = el.videoWidth || el.naturalWidth;
  const H = el.videoHeight || el.naturalHeight;
  if (!W || !H) return null;
  const stamp = Math.max(Math.round(timeMs), lastStamp + 1);
  try {
    const res = detector.detectForVideo(el, stamp);
    lastStamp = stamp;
    const dets = res?.detections || [];
    if (!dets.length) return null;
    let best = dets[0];
    for (const d of dets) if (area(d) > area(best)) best = d;
    const b = best.boundingBox;
    return {
      x: b.originX / W, y: b.originY / H,
      w: b.width / W, h: b.height / H,
      cx: (b.originX + b.width / 2) / W,
      cy: (b.originY + b.height / 2) / H,
    };
  } catch (e) {
    log.throttle('face-fail', 3000, 'warn', 'face', 'detectForVideo threw', e.message);
    return null;
  }
}

const area = (d) => d.boundingBox.width * d.boundingBox.height;

/**
 * Smoothed face box over time. A raw per-frame box jitters; this low-pass
 * filters it so reframing does not shake. Falls back to a sensible default
 * (upper-centre) when no face is found — a seated talking head lives there.
 */
export class FaceSmoother {
  constructor({ alpha = 0.2, fallback = { cx: 0.5, cy: 0.36, w: 0.36, h: 0.28 } } = {}) {
    this.alpha = alpha;
    this.box = { ...fallback, cx: fallback.cx, cy: fallback.cy };
    this.fallback = fallback;
    this.have = false;
  }
  update(raw) {
    if (!raw) return this.box;
    const a = this.have ? this.alpha : 1; // snap on first detection
    this.box = {
      cx: lerp(this.box.cx, raw.cx, a),
      cy: lerp(this.box.cy, raw.cy, a),
      w: lerp(this.box.w, raw.w, a),
      h: lerp(this.box.h, raw.h, a),
    };
    this.have = true;
    return this.box;
  }
  current() { return this.box; }
}

const lerp = (a, b, t) => a + (b - a) * t;
