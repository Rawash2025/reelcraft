// Automated QC pass over a project before render.
//
// Checks the timeline for the failures the spec lists — text/overlays out of
// bounds, eyes covered, zero-size or negative-duration events, missing assets,
// duration mismatches — and returns { passed, warnings, errors }. Straight-
// forward layout errors are auto-fixed by nudging the offending overlay inside
// bounds, and the caller can re-run.
import { faceAt } from '../engine/faceCache.js';
import { SAFE_ZONES, solvePlacement } from '../engine/layout.js';
import { PIP_POS } from '../engine/overlays.js';

const overlaps = (a, b) =>
  !(a.x + a.w / 2 < b.x - b.w / 2 || a.x - a.w / 2 > b.x + b.w / 2 ||
    a.y + a.h / 2 < b.y - b.h / 2 || a.y - a.h / 2 > b.y + b.h / 2);

const boxOf = (c) => {
  if (c.kind === 'card') return { x: c.x, y: c.y, w: c.w, h: c.h };
  if (c.kind === 'pip') {
    const pos = PIP_POS[c.pos] || PIP_POS.TOP_RIGHT;
    const size = c.size ?? 0.24;
    return { x: pos.x, y: pos.y, w: size, h: size * 1.4 };
  }
  if (c.kind === 'document') return { x: 0.5, y: c.y ?? 0.46, w: c.w ?? 0.56, h: c.h ?? 0.6 };
  // Hero/text are centred and auto-fit to the safe width, so use a conservative
  // box that will not false-positive on the horizontal safe zone.
  if (c.kind === 'text' || c.kind === 'hero') return { x: c.x ?? 0.5, y: c.y ?? 0.3, w: 0.72, h: 0.18 };
  return null;
};

export function runQC(state, { autofix = true, safe = 'reels' } = {}) {
  const errors = [];
  const warnings = [];
  const fixes = [];
  const zone = SAFE_ZONES[safe] || SAFE_ZONES.reels;
  const dur = state.duration ?? 0;
  const assetIds = new Set(state.assets.map((a) => a.id));

  const overlay = state.tracks.find((t) => t.kind === 'overlay');
  const video = state.tracks.find((t) => t.kind === 'video');

  // Duration / empty checks.
  if (!dur || dur < 0.1) errors.push('timeline has no duration');
  if (!video?.clips?.length) errors.push('no video on the timeline');

  for (const track of state.tracks) {
    for (const c of track.clips) {
      const where = `${c.kind || track.kind}@${(c.start ?? 0).toFixed(1)}s`;
      if ((c.duration ?? 0) <= 0) errors.push(`${where}: non-positive duration`);
      if ((c.start ?? 0) < -0.001) errors.push(`${where}: negative start`);
      if (c.start > dur + 0.1) warnings.push(`${where}: starts after the video ends`);
      // Missing asset references.
      if (c.assetId && !assetIds.has(c.assetId)) errors.push(`${where}: missing asset ${c.assetId}`);
      if (c.assetIds) for (const id of c.assetIds) if (!assetIds.has(id)) errors.push(`${where}: missing collage asset ${id}`);

      // Bounds + zero-size for positioned overlays.
      const box = boxOf(c);
      if (box && track.kind === 'overlay' && c.kind !== 'pip') {
        if ((box.w ?? 0) <= 0 || (box.h ?? 0) <= 0) errors.push(`${where}: zero-size overlay`);
        const outL = box.x - box.w / 2 < zone.left - 0.02;
        const outR = box.x + box.w / 2 > 1 - zone.right + 0.02;
        const outT = box.y - box.h / 2 < zone.top - 0.02;
        const outB = box.y + box.h / 2 > 1 - zone.bottom + 0.02;
        if (outL || outR || outT || outB) {
          if (autofix && c.kind === 'card') {
            const nx = Math.min(Math.max(box.x, zone.left + box.w / 2), 1 - zone.right - box.w / 2);
            const ny = Math.min(Math.max(box.y, zone.top + box.h / 2), 1 - zone.bottom - box.h / 2);
            fixes.push({ track: track.id, clip: c.id, patch: { x: nx, y: ny } });
            warnings.push(`${where}: nudged inside safe zone`);
          } else {
            warnings.push(`${where}: extends outside the safe zone`);
          }
        }
      }
    }
  }

  // Candidate slots the solver can move an eye-covering overlay into.
  const candidates = [
    { x: 0.2, y: 0.28 }, { x: 0.8, y: 0.28 }, { x: 0.2, y: 0.72 }, { x: 0.8, y: 0.72 },
    { x: 0.18, y: 0.5 }, { x: 0.82, y: 0.5 }, { x: 0.5, y: 0.8 },
  ];

  // Eyes covered: for each overlay active at its start, check against the face
  // box (eyes ~ top third of the face). This is the expensive failure.
  if (video?.clips?.length && overlay) {
    for (const c of overlay.clips) {
      if (c.kind === 'document' || c.kind === 'hero') continue; // documents are meant to front the speaker; hero can go behind
      const box = boxOf(c);
      if (!box) continue;
      const clip = video.clips.find((v) => c.start >= v.start && c.start < v.start + v.duration) || video.clips[0];
      const face = clip ? faceAt(clip.assetId, (clip.in || 0) + (c.start - clip.start)) : null;
      if (!face) continue;
      // Eyes are a narrow horizontal band in the upper-centre of the detector's
      // face box (which includes hair/forehead margins), not the whole face.
      const eyes = { x: face.cx, y: face.cy - face.h * 0.12, w: face.w * 0.46, h: face.h * 0.2 };
      if (overlaps(box, eyes)) {
        if (autofix && (c.kind === 'card' || c.kind === 'pip')) {
          const placed = solvePlacement({
            w: box.w, h: box.h, candidates, face,
            captionBand: { x: 0.5, y: state.captions?.y ?? 0.62, w: 0.86, h: 0.16 },
            safe,
          });
          // Verify the chosen slot actually clears the eyes; if the face is so
          // large nothing clears it, shrink and corner the card, downgrade to warn.
          const newBox = { x: placed.x, y: placed.y, w: box.w, h: box.h };
          if (!overlaps(newBox, eyes)) {
            const patch = c.kind === 'card'
              ? { x: placed.x, y: placed.y }
              : { pos: placed.x < 0.5 ? (placed.y < 0.5 ? 'TOP_LEFT' : 'BOTTOM_LEFT') : (placed.y < 0.5 ? 'TOP_RIGHT' : 'BOTTOM_RIGHT') };
            fixes.push({ track: overlay.id, clip: c.id, patch });
            warnings.push(`${c.kind}@${c.start.toFixed(1)}s: repositioned off the eyes`);
          } else if (c.kind === 'card') {
            fixes.push({ track: overlay.id, clip: c.id, patch: { x: 0.2, y: 0.24, w: box.w * 0.7, h: box.h * 0.7 } });
            warnings.push(`${c.kind}@${c.start.toFixed(1)}s: face fills frame — shrunk to corner`);
          } else {
            warnings.push(`${c.kind}@${c.start.toFixed(1)}s: face fills frame — PIP kept at corner`);
          }
        } else {
          errors.push(`${c.kind}@${c.start.toFixed(1)}s: covers the eyes (face-unsafe)`);
        }
      }
    }
  }

  return { passed: errors.length === 0, warnings, errors, fixes };
}

/** Apply the auto-fixes QC produced, via the store's commit. */
export function applyQCFixes(store, fixes) {
  if (!fixes.length) return;
  store.commit((s) => ({
    tracks: s.tracks.map((t) => {
      const forT = fixes.filter((f) => f.track === t.id);
      if (!forT.length) return t;
      return { ...t, clips: t.clips.map((c) => {
        const f = forT.find((x) => x.clip === c.id);
        return f ? { ...c, ...f.patch } : c;
      }) };
    }),
  }), 'qc autofix');
}

/* -------------------------------------------------------- coverage detectors */

// Sample a canvas context for near-black pixels. Used to catch the source-
// coverage regression (black frames / black borders during camera movement).
export function analyzeFrame(ctx, W, H, { threshold = 18 } = {}) {
  const isBlack = (d, i) => d[i] <= threshold && d[i + 1] <= threshold && d[i + 2] <= threshold;

  // Whole-frame near-black percentage (coarse grid for speed).
  const step = Math.max(2, Math.floor(Math.min(W, H) / 120));
  let black = 0, total = 0;
  const full = ctx.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      total++;
      if (isBlack(full, i)) black++;
    }
  }
  const blackPct = black / total;

  // Edge strips: a continuous near-black border means the source stopped
  // covering the canvas (SOURCE_COVERAGE_FAILURE).
  const stripFrac = 0.02;
  const sw = Math.max(2, Math.floor(W * stripFrac));
  const sh = Math.max(2, Math.floor(H * stripFrac));
  const stripBlack = (x0, y0, w, h) => {
    const d = ctx.getImageData(x0, y0, w, h).data;
    let b = 0, tot = 0;
    for (let i = 0; i < d.length; i += 16) { tot++; if (d[i] <= threshold && d[i + 1] <= threshold && d[i + 2] <= threshold) b++; }
    return b / Math.max(1, tot);
  };
  const edges = {
    top: stripBlack(0, 0, W, sh),
    bottom: stripBlack(0, H - sh, W, sh),
    left: stripBlack(0, 0, sw, H),
    right: stripBlack(W - sw, 0, sw, H),
  };
  const borderFail = Object.entries(edges).filter(([, v]) => v > 0.9).map(([k]) => k);

  return {
    blackPct: +blackPct.toFixed(3),
    blackFrame: blackPct > 0.92,
    edges: Object.fromEntries(Object.entries(edges).map(([k, v]) => [k, +v.toFixed(2)])),
    borderFailure: borderFail,          // sides with a continuous black strip
    coverageFail: borderFail.length > 0,
  };
}
