// Deterministic face-track cache.
//
// Running the detector on every preview frame is non-deterministic (async,
// timing-dependent) and slow. Instead we sample the face across the clip ONCE
// into a track, smooth it, and interpolate at render time — synchronous,
// repeatable, and identical between preview and export. This is the cache the
// spec asks for (#18): [{ t, cx, cy, w, h, confidence }].

import { initFaceTracker, detectFace } from './faceTrack.js';
import { log } from './log.js';

// assetId -> { track: [...], building: Promise|null, fps }
const cache = new Map();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Cached track for an asset, or null if not built yet. */
export function getFaceTrack(assetId) {
  return cache.get(assetId)?.track || null;
}

/**
 * Build (or return) the face track for a video asset. Samples at `fps`,
 * detects the primary face, then applies a smoothing pass with velocity
 * limiting so the virtual camera never jitters. Idempotent + cached.
 */
export async function buildFaceTrack(asset, { fps = 8, onProgress } = {}) {
  if (!asset || asset.type !== 'video') return null;
  const existing = cache.get(asset.id);
  if (existing?.track) return existing.track;
  if (existing?.building) return existing.building;

  const building = (async () => {
    try {
      await initFaceTracker();
    } catch (e) {
      log.warn('faceCache', 'face model unavailable — reframe disabled', e.message);
      cache.set(asset.id, { track: [], fps });
      return [];
    }

    const v = document.createElement('video');
    v.src = asset.url;
    v.muted = true;
    v.playsInline = true;
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('face-track: video load failed'));
      setTimeout(res, 5000);
    });
    const dur = asset.duration || v.duration || 0;
    if (!dur) { cache.set(asset.id, { track: [], fps }); return []; }

    const raw = [];
    const step = 1 / fps;
    let stamp = 1;
    for (let t = 0; t <= dur + 1e-3; t += step) {
      v.currentTime = Math.min(t, dur);
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 300); });
      const box = detectFace(v, stamp++ * 1000 / fps + t * 1000);
      raw.push({ t: +t.toFixed(3), box });
      onProgress?.(clamp(t / dur, 0, 1));
    }
    try { v.src = ''; } catch { /* noop */ }

    const track = smooth(raw);
    cache.set(asset.id, { track, fps });
    log.info('faceCache', `built face track for ${asset.name}`, { samples: track.length, hits: track.filter((s) => s.confidence > 0).length });
    return track;
  })();

  cache.set(asset.id, { building, fps });
  return building;
}

// Smoothing with velocity limiting + face-loss hold. A raw per-sample box
// jitters; this produces the editorial "virtual camera" motion the spec wants.
function smooth(raw) {
  const out = [];
  let cur = null;      // last smoothed box
  let lostSince = -1;  // sample index where face was lost
  const inertia = 0.78;
  const maxVel = 0.03; // max movement per sample (frame-rate independent-ish)
  const fallback = { cx: 0.5, cy: 0.38, w: 0.34, h: 0.28 };

  raw.forEach((s, i) => {
    const det = s.box;
    if (det) {
      if (!cur) cur = { ...det };
      else {
        // dead-zone: ignore tiny movement
        const dx = det.cx - cur.cx, dy = det.cy - cur.cy;
        const move = Math.hypot(dx, dy);
        if (move > 0.006) {
          let nx = cur.cx * inertia + det.cx * (1 - inertia);
          let ny = cur.cy * inertia + det.cy * (1 - inertia);
          // velocity limit
          nx = cur.cx + clamp(nx - cur.cx, -maxVel, maxVel);
          ny = cur.cy + clamp(ny - cur.cy, -maxVel, maxVel);
          cur = {
            cx: nx, cy: ny,
            w: cur.w * inertia + det.w * (1 - inertia),
            h: cur.h * inertia + det.h * (1 - inertia),
          };
        }
      }
      lostSince = -1;
      out.push({ t: s.t, ...cur, confidence: 1 });
    } else {
      // Face lost: hold last position, then ease toward default after a delay.
      if (lostSince < 0) lostSince = i;
      const lostFor = i - lostSince;
      const base = cur || fallback;
      if (lostFor < 4) {
        out.push({ t: s.t, ...base, confidence: 0 }); // hold ~0.5s @8fps
      } else {
        const k = clamp((lostFor - 4) / 8, 0, 1); // ease over ~1s
        out.push({
          t: s.t,
          cx: lerp(base.cx, fallback.cx, k),
          cy: lerp(base.cy, fallback.cy, k),
          w: lerp(base.w, fallback.w, k),
          h: lerp(base.h, fallback.h, k),
          confidence: 0,
        });
      }
    }
  });
  return out;
}

/** Interpolate the smoothed face box at time t. Returns null if no track. */
export function faceAt(assetId, t) {
  const entry = cache.get(assetId);
  const track = entry?.track;
  if (!track || !track.length) return null;
  if (t <= track[0].t) return track[0];
  if (t >= track[track.length - 1].t) return track[track.length - 1];
  // binary-ish linear scan (tracks are short)
  for (let i = 1; i < track.length; i++) {
    if (track[i].t >= t) {
      const a = track[i - 1], b = track[i];
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k),
        w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k),
        confidence: Math.min(a.confidence, b.confidence),
      };
    }
  }
  return track[track.length - 1];
}

export function clearFaceCache(assetId) {
  if (assetId) cache.delete(assetId);
  else cache.clear();
}
