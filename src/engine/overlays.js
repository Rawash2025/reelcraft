// Real image overlays — the shared renderer behind proof cards, screenshots,
// collages, documents and picture-in-picture.
//
// They are all the same operation: draw a user-supplied image (or video frame)
// into a rounded, shadowed, optionally-rotated frame with an entrance and exit.
// The compositions differ only in position, size, rotation and stagger, so one
// renderer covers Priorities 2-5 and the proof engine feeds them.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutBack = (t) => {
  const c = 1.70158;
  const p = clamp(t, 0, 1) - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Card positions as centre-point + size fractions of the frame.
export const CARD_POS = {
  // Positions chosen to sit beside/around a centred talking head, not over the
  // face. The face zone for a seated subject is roughly x[0.32,0.68] y[0.15,0.5].
  SINGLE_LEFT:      { x: 0.23, y: 0.5,  w: 0.36, h: 0.3,  rot: -3 },
  SINGLE_RIGHT:     { x: 0.77, y: 0.5,  w: 0.36, h: 0.3,  rot: 3 },
  SINGLE_TOP_LEFT:  { x: 0.24, y: 0.26, w: 0.34, h: 0.26, rot: -4 },
  SINGLE_TOP_RIGHT: { x: 0.76, y: 0.26, w: 0.34, h: 0.26, rot: 4 },
  BOTTOM_CARD:      { x: 0.5,  y: 0.78, w: 0.56, h: 0.26, rot: 0 },
  CENTER_FLOATING:  { x: 0.5,  y: 0.66, w: 0.5,  h: 0.34, rot: 0 },
};

/**
 * Draw one media card. `clip` fields:
 *  { assetId, x,y,w,h (centre + size fractions), rot (deg), radius, shadow,
 *    border, anim ('scale'|'slide-left'|'slide-right'|'slide-up'|'rise'),
 *    start, duration, delay (stagger), shape ('rect'|'circle'), label }
 * `el` is the resolved HTMLImage/Video for assetId.
 */
export function drawCard(ctx, W, H, clip, el, time, accent) {
  const local = time - clip.start - (clip.delay || 0);
  const remaining = clip.start + clip.duration - time;
  if (local < -0.001 || remaining < 0) return;

  const inP = easeOutBack(local / 0.34);
  const inA = clamp(local / 0.2, 0, 1);
  const outA = clamp(remaining / 0.24, 0, 1);
  const alpha = clamp(inA, 0, 1) * outA;
  if (alpha <= 0.002) return;

  const boxW = W * clip.w;
  const boxH = H * clip.h;
  let cx = W * clip.x;
  let cy = H * clip.y;

  // Entrance offset.
  let ox = 0, oy = 0, sc = 1;
  switch (clip.anim || 'scale') {
    case 'slide-left':  ox = -(1 - easeOut(inA)) * W * 0.4; break;
    case 'slide-right': ox = (1 - easeOut(inA)) * W * 0.4; break;
    case 'slide-up':    oy = (1 - easeOut(inA)) * H * 0.3; break;
    case 'rise':        oy = (1 - easeOut(inA)) * H * 0.2; sc = 0.86 + 0.14 * clamp(inP, 0, 1.1); break;
    default:            sc = 0.8 + 0.2 * clamp(inP, 0, 1.05); break;
  }

  // Gentle idle float so a held card is not dead-still.
  const floatY = Math.sin((time - clip.start) * 1.6 + (clip.delay || 0) * 9) * boxH * 0.012;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx + ox, cy + oy + floatY);
  ctx.rotate(((clip.rot || 0) * Math.PI) / 180);
  ctx.scale(sc, sc);

  const x = -boxW / 2, y = -boxH / 2;
  const circle = clip.shape === 'circle';
  const radius = circle ? Math.min(boxW, boxH) / 2 : Math.min(boxW, boxH) * (clip.radius ?? 0.09);

  // Drop shadow.
  if (clip.shadow !== false) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = boxW * 0.12;
    ctx.shadowOffsetY = boxH * 0.05;
    ctx.fillStyle = '#000';
    roundRectPath(ctx, x, y, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  // Clip + draw the image cover-fit.
  ctx.save();
  roundRectPath(ctx, x, y, boxW, boxH, radius);
  ctx.clip();
  if (el) {
    const sw = el.videoWidth || el.naturalWidth || boxW;
    const sh = el.videoHeight || el.naturalHeight || boxH;
    const scale = Math.max(boxW / sw, boxH / sh);
    const dw = sw * scale, dh = sh * scale;
    try { ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh); } catch { /* not ready */ }
  } else {
    ctx.fillStyle = '#1a1a20';
    ctx.fillRect(x, y, boxW, boxH);
  }
  ctx.restore();

  // Border.
  const bw = clip.border ?? (boxW * 0.006);
  if (bw > 0) {
    ctx.lineWidth = bw;
    ctx.strokeStyle = clip.borderColor || 'rgba(255,255,255,.85)';
    roundRectPath(ctx, x, y, boxW, boxH, radius);
    ctx.stroke();
  }

  // Optional label chip.
  if (clip.label) {
    const ls = boxH * 0.09;
    ctx.font = `800 ${Math.round(ls)}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(clip.label).width;
    ctx.fillStyle = accent || '#ffe600';
    roundRectPath(ctx, x + ls * 0.5, y + boxH - ls * 2.2, tw + ls, ls * 1.6, ls * 0.4);
    ctx.fill();
    ctx.fillStyle = '#0b0b0f';
    ctx.fillText(clip.label, x + ls, y + boxH - ls * 1.4);
  }

  ctx.restore();
}

// Collage layouts: return an array of card placement fragments (centre + size
// + rotation + stagger). Editorial hierarchy — one primary, supporting smaller.
export const COLLAGE_LAYOUTS = {
  COLLAGE_2_DIAGONAL: [
    { x: 0.24, y: 0.4,  w: 0.32, h: 0.26, rot: -4, delay: 0 },
    { x: 0.74, y: 0.66, w: 0.34, h: 0.28, rot: 4, delay: 0.1 },
  ],
  COLLAGE_2_SPLIT: [
    { x: 0.28, y: 0.5, w: 0.42, h: 0.36, rot: -2, delay: 0 },
    { x: 0.73, y: 0.5, w: 0.42, h: 0.36, rot: 2, delay: 0.1 },
  ],
  COLLAGE_3_AROUND_SUBJECT: [
    { x: 0.5, y: 0.66, w: 0.4, h: 0.3, rot: 0, delay: 0 },         // primary, chest level
    { x: 0.19, y: 0.44, w: 0.28, h: 0.22, rot: -5, delay: 0.1 },   // beside head (left)
    { x: 0.81, y: 0.44, w: 0.28, h: 0.22, rot: 5, delay: 0.18 },   // beside head (right)
  ],
  COLLAGE_3_STACKED: [
    { x: 0.5, y: 0.28, w: 0.5, h: 0.24, rot: -1.5, delay: 0 },
    { x: 0.42, y: 0.52, w: 0.44, h: 0.22, rot: 2, delay: 0.1 },
    { x: 0.6, y: 0.74, w: 0.4, h: 0.2, rot: -2, delay: 0.18 },
  ],
  COLLAGE_4_CORNERS: [
    { x: 0.22, y: 0.3,  w: 0.3, h: 0.22, rot: -4, delay: 0 },
    { x: 0.78, y: 0.3,  w: 0.3, h: 0.22, rot: 4, delay: 0.08 },
    { x: 0.24, y: 0.72, w: 0.32, h: 0.24, rot: 4, delay: 0.16 },
    { x: 0.76, y: 0.72, w: 0.32, h: 0.24, rot: -4, delay: 0.24 },
  ],
  COLLAGE_4_SCATTERED: [
    { x: 0.5, y: 0.4, w: 0.4, h: 0.32, rot: 0, delay: 0 },         // primary
    { x: 0.2, y: 0.28, w: 0.26, h: 0.2, rot: -5, delay: 0.1 },
    { x: 0.82, y: 0.5, w: 0.26, h: 0.2, rot: 4, delay: 0.18 },
    { x: 0.34, y: 0.72, w: 0.28, h: 0.22, rot: -3, delay: 0.26 },
  ],
};

export const collageLayoutFor = (count) => {
  if (count <= 2) return 'COLLAGE_2_DIAGONAL';
  if (count === 3) return 'COLLAGE_3_AROUND_SUBJECT';
  return 'COLLAGE_4_CORNERS';
};

/** Draw a collage clip: { assetIds[], layout, start, duration }. */
export function drawCollage(ctx, W, H, clip, media, time, accent) {
  const frags = COLLAGE_LAYOUTS[clip.layout] || COLLAGE_LAYOUTS.COLLAGE_3_AROUND_SUBJECT;
  clip.assetIds.slice(0, frags.length).forEach((assetId, i) => {
    const f = frags[i];
    drawCard(ctx, W, H, {
      ...f, assetId, start: clip.start, duration: clip.duration,
      anim: 'scale', radius: 0.08, border: W * 0.004,
    }, media[assetId], time, accent);
  });
}

/** Draw a document overlay: rises up, holds, floats, exits down. */
export function drawDocument(ctx, W, H, clip, el, time, accent) {
  const local = time - clip.start;
  const remaining = clip.start + clip.duration - time;
  if (local < 0 || remaining < 0) return;

  const boxW = W * (clip.w ?? 0.56);
  const boxH = H * (clip.h ?? 0.6);
  const cx = W * 0.5;
  const cy = H * (clip.y ?? 0.46);

  // rise (0.32s) -> overshoot -> settle; exit down in last 0.3s
  const rise = easeOutBack(local / 0.36);
  const enterY = (1 - clamp(rise, 0, 1.05)) * H * 0.18;
  const enterS = 0.86 + 0.17 * clamp(rise, 0, 1.05);
  const settleS = clamp(rise, 0, 1) >= 1 ? 1 : enterS;
  const floatY = Math.sin(local * 1.4) * boxH * 0.01;
  const exitY = remaining < 0.3 ? (1 - remaining / 0.3) * H * 0.08 : 0;
  const alpha = clamp(local / 0.2, 0, 1) * clamp(remaining / 0.3, 0, 1);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + enterY + floatY + exitY);
  ctx.scale(Math.min(settleS, 1.03), Math.min(settleS, 1.03));
  const x = -boxW / 2, y = -boxH / 2, r = boxW * 0.03;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = boxW * 0.14;
  ctx.shadowOffsetY = boxH * 0.04;
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, x, y, boxW, boxH, r);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, x, y, boxW, boxH, r);
  ctx.clip();
  if (el) {
    const sw = el.videoWidth || el.naturalWidth || boxW;
    const sh = el.videoHeight || el.naturalHeight || boxH;
    const scale = Math.max(boxW / sw, boxH / sh);
    try { ctx.drawImage(el, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale); } catch { /* noop */ }
  }
  ctx.restore();
  ctx.restore();
}

// PIP positions (centre fractions).
export const PIP_POS = {
  TOP_LEFT: { x: 0.2, y: 0.16 }, TOP_RIGHT: { x: 0.8, y: 0.16 },
  MID_LEFT: { x: 0.18, y: 0.5 }, MID_RIGHT: { x: 0.82, y: 0.5 },
  BOTTOM_LEFT: { x: 0.2, y: 0.84 }, BOTTOM_RIGHT: { x: 0.8, y: 0.84 },
};

/** Draw a PIP clip: { assetId, pos, shape ('rect'|'circle'), size, start, duration }. */
export function drawPIP(ctx, W, H, clip, el, time, accent) {
  const pos = PIP_POS[clip.pos] || PIP_POS.TOP_RIGHT;
  const size = clip.size ?? 0.24;
  drawCard(ctx, W, H, {
    x: pos.x, y: pos.y, w: size, h: clip.shape === 'circle' ? size * (W / H) : size * 1.4,
    rot: 0, radius: 0.14, shape: clip.shape || 'rect',
    border: W * 0.005, borderColor: accent || '#fff',
    anim: 'scale', start: clip.start, duration: clip.duration,
  }, el, time, accent);
}
