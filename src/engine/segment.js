// Person segmentation, so b-roll can sit *behind* the speaker.
//
// This is the effect that reads as expensive: the footage plays behind the
// person rather than covering them. MediaPipe's selfie segmenter is built for
// exactly this and runs comfortably at frame rate.
//
// Everything degrades gracefully — if the model will not load, the caller
// falls back to compositing b-roll over the top instead of behind.

import { log } from './log.js';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

// Which category index the model uses for the subject.
const PERSON_CATEGORY = 0;

let segmenter = null;
let loading = null;
let failed = false;

export const segmentationFailed = () => failed;
export const segmentationReady = () => !!segmenter;

/** Load once. Safe to call repeatedly. */
export async function initSegmenter(onStatus = () => {}) {
  if (segmenter) return segmenter;
  if (failed) throw new Error('Segmentation unavailable.');
  if (loading) return loading;

  loading = (async () => {
    onStatus('Loading segmentation model…');
    const { ImageSegmenter, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

    const make = (delegate) =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });

    try {
      segmenter = await make('GPU');
    } catch {
      onStatus('GPU unavailable — using CPU');
      segmenter = await make('CPU');
    }
    return segmenter;
  })();

  try {
    return await loading;
  } catch (e) {
    failed = true;
    loading = null;
    throw new Error(`Could not load segmentation: ${e.message}`);
  }
}

// One scratch canvas for the mask, reused every frame.
let maskCanvas = null;
let maskCtx = null;
let lastStamp = -1;
let haveMask = false;

// The first mask usually lands after the frame that asked for it. Without a
// repaint the canvas keeps the fallback (un-masked) frame forever, which looks
// exactly like segmentation being broken. Whoever owns the canvas registers
// here and gets one repaint when the first mask is ready.
let onFirstMask = null;
export const setMaskListener = (fn) => { onFirstMask = fn; };

/**
 * Produce an alpha mask of the person in `el` — opaque where the person is,
 * transparent elsewhere. Returns null when the model is not ready, which the
 * renderer treats as "composite normally".
 *
 * `timeMs` must increase monotonically; MediaPipe rejects a repeated stamp.
 */
export function personMask(el, timeMs) {
  if (!segmenter || !el) return null;
  const w = el.videoWidth || el.naturalWidth;
  const h = el.videoHeight || el.naturalHeight;
  if (!w || !h) return null;

  // MediaPipe rejects a repeated or decreasing timestamp, so the stamp is
  // forced strictly upward. (An earlier version compared it to lastStamp for
  // caching, which could never match and therefore never cached.)
  const stamp = Math.max(Math.round(timeMs), lastStamp + 1);

  let out = null;
  try {
    // Synchronous form: with no callback, segmentForVideo RETURNS the result.
    // The callback overload resolves later, which meant the draw that asked for
    // the mask never received one and always took the fallback path.
    const result = segmenter.segmentForVideo(el, stamp);
    {
      const mask = result && result.categoryMask;
      if (!mask) return maskCanvas;
      const mw = mask.width;
      const mh = mask.height;
      const data = mask.getAsUint8Array();

      if (!maskCanvas || maskCanvas.width !== mw || maskCanvas.height !== mh) {
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = mw;
        maskCanvas.height = mh;
        maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      }

      const img = maskCtx.createImageData(mw, mh);
      // Polarity determined empirically, not from the docs: this build of the
      // selfie segmenter labels the PERSON 0 and the background non-zero.
      // Reading it the other way round silently keeps the background and
      // discards the speaker, which looks like the plate punched through them.
      for (let i = 0, p = 0; i < data.length; i++, p += 4) {
        const on = data[i] === PERSON_CATEGORY ? 255 : 0;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255;
        img.data[p + 3] = on;
      }
      maskCtx.putImageData(img, 0, 0);
      mask.close();
      out = maskCanvas;
      if (!haveMask) {
        haveMask = true;
        // Defer so we never repaint from inside the paint that triggered this.
        if (onFirstMask) setTimeout(() => onFirstMask(), 0);
      }
      if (typeof result.close === 'function') result.close();
    }
  } catch (e) {
    log.throttle('seg-fail', 2000, 'warn', 'segment', 'segmentForVideo threw', e.message);
    return maskCanvas; // stale mask beats a flicker
  }

  lastStamp = stamp;
  return out || maskCanvas;
}

export function resetSegmenter() {
  lastStamp = -1;
  haveMask = false;
}

/**
 * Run one segmentation up front so the first painted frame already has a mask,
 * instead of showing the un-masked fallback until something repaints.
 */
export function primeMask(el) {
  if (!segmenter || !el) return false;
  try {
    personMask(el, performance.now());
    return haveMask;
  } catch {
    return false;
  }
}
