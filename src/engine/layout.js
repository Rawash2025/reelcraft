// Layout solver — keeps overlays off the face and inside safe zones.
//
// Given a face box (from faceTrack, or a default) it scores candidate positions
// for an overlay and returns the best. Hard constraints reject a candidate
// outright (covers the face, outside frame); soft constraints rank the rest
// (balance, using empty space, avoiding the caption band).

// Social safe zones as inset fractions (avoid platform UI regions).
export const SAFE_ZONES = {
  reels:   { top: 0.06, bottom: 0.18, right: 0.14, left: 0.03 },
  tiktok:  { top: 0.08, bottom: 0.2, right: 0.16, left: 0.03 },
  shorts:  { top: 0.06, bottom: 0.16, right: 0.12, left: 0.03 },
  clean:   { top: 0.03, bottom: 0.06, right: 0.03, left: 0.03 },
};

function overlaps(a, b, pad = 0) {
  return !(a.x + a.w / 2 + pad < b.x - b.w / 2 ||
           a.x - a.w / 2 - pad > b.x + b.w / 2 ||
           a.y + a.h / 2 + pad < b.y - b.h / 2 ||
           a.y - a.h / 2 - pad > b.y + b.h / 2);
}

/**
 * Choose a position for an overlay of size {w,h} (frame fractions) among
 * candidate centres, avoiding the face box and the caption band.
 * Returns { x, y, score } — the highest-scoring valid candidate, or the least
 * bad if none is fully valid (never returns nothing, so an overlay always
 * lands somewhere sane).
 */
export function solvePlacement({ w, h, candidates, face, captionBand, safe = 'reels', allowBehind = false }) {
  const zone = SAFE_ZONES[safe] || SAFE_ZONES.reels;
  const faceBox = face
    ? { x: face.cx, y: face.cy, w: (face.w || 0.36) * 1.25, h: (face.h || 0.28) * 1.35 }
    : { x: 0.5, y: 0.36, w: 0.4, h: 0.34 };

  let best = null;
  for (const cand of candidates) {
    const box = { x: cand.x, y: cand.y, w, h };
    let score = 1;
    let valid = true;

    // Hard: inside frame + safe zone.
    if (box.x - w / 2 < zone.left || box.x + w / 2 > 1 - zone.right) { score -= 0.5; valid = false; }
    if (box.y - h / 2 < zone.top || box.y + h / 2 > 1 - zone.bottom) { score -= 0.5; valid = false; }

    // Hard (unless behind allowed): don't cover the face.
    const faceHit = overlaps(box, faceBox, 0.0);
    if (faceHit && !allowBehind) { score -= 0.6; valid = false; }
    else if (faceHit && allowBehind) score -= 0.15;

    // Soft: avoid the caption band.
    if (captionBand && overlaps(box, captionBand, 0.0)) score -= 0.25;

    // Soft: prefer the side with more empty space (away from face centre x).
    score += Math.min(0.2, Math.abs(box.x - faceBox.x) * 0.3);
    // Soft: prefer not dead-centre vertically over the face.
    score += Math.min(0.15, Math.abs(box.y - faceBox.y) * 0.3);
    // Candidate's own preference weight.
    score += (cand.weight || 0) * 0.1;

    const entry = { x: box.x, y: box.y, score: +score.toFixed(3), valid };
    if (!best || (entry.valid && !best.valid) ||
        (entry.valid === best.valid && entry.score > best.score)) best = entry;
  }
  return best;
}

/** Caption band box for the collision checks (captions sit upper-centre). */
export function captionBandBox(captions, frameH = 1) {
  const y = captions?.y ?? 0.72;
  return { x: 0.5, y, w: 0.86, h: 0.16 };
}

/**
 * Face-aware crop offset for reframing. When an overlay is on one side, nudge
 * the subject crop the other way (editorial composition, not mechanical
 * centering). Returns { x, y } offset in frame fractions to add to the source.
 */
export function reframeOffset({ face, overlaySide = null, strength = 0.06 }) {
  let x = 0;
  // Keep the eyes near the upper third: if the face centre drifts, pull toward
  // a target composition rather than snapping.
  const targetCy = 0.4;
  const y = face ? (targetCy - face.cy) * 0.4 : 0;
  if (overlaySide === 'left') x = strength;
  else if (overlaySide === 'right') x = -strength;
  return { x, y: clamp(y, -0.08, 0.08) };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
