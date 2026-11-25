// The graphic layers that sit above the footage: icon cards, framed b-roll,
// and the whip-pan streak between cuts. Drawn by renderer.js, so preview and
// export stay identical.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeBack = (t) => {
  const c = 1.70158;
  const p = clamp(t, 0, 1) - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};

export function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* ------------------------------------------------------------ icon cards */

/**
 * A row of glass cards with an icon and a label — the "PLAN / SHOOT / SCRIPT"
 * treatment. One card can be highlighted, and the highlight can move over time
 * so the row walks through its steps.
 */
export function drawCards(ctx, W, H, clip, time, accent) {
  if (clip.style === 'luxe') return drawLuxeCards(ctx, W, H, clip, time);
  const local = time - clip.start;
  const items = clip.items || [];
  if (!items.length) return;

  const n = items.length;
  const gap = W * 0.022;
  const cardW = (W * (clip.width ?? 0.86) - gap * (n - 1)) / n;
  const cardH = cardW * (clip.ratio ?? 1.12);
  const totalW = cardW * n + gap * (n - 1);
  const x0 = (W - totalW) / 2;
  const y0 = H * (clip.y ?? 0.62) - cardH / 2;

  // Which card is lit right now.
  let activeIdx = clip.active ?? -1;
  if (clip.walk) {
    const per = clip.duration / n;
    activeIdx = clamp(Math.floor(local / per), 0, n - 1);
  }

  items.forEach((item, i) => {
    // Staggered entrance so the row assembles rather than popping.
    const delay = i * 0.09;
    const p = easeBack((local - delay) / 0.42);
    if (p <= 0) return;
    const outT = clip.start + clip.duration - time;
    const alpha = clamp(p, 0, 1) * (outT < 0.3 ? clamp(outT / 0.3, 0, 1) : 1);

    const active = i === activeIdx;
    const lift = active ? cardH * 0.035 : 0;
    const x = x0 + i * (cardW + gap);
    const y = y0 + (1 - clamp(p, 0, 1)) * cardH * 0.28 - lift;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Glass panel.
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = cardW * 0.18;
    ctx.shadowOffsetY = cardH * 0.05;
    const g = ctx.createLinearGradient(x, y, x, y + cardH);
    g.addColorStop(0, active ? 'rgba(38,30,26,.92)' : 'rgba(22,22,26,.72)');
    g.addColorStop(1, active ? 'rgba(20,14,12,.92)' : 'rgba(12,12,15,.72)');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, cardW, cardH, cardW * 0.16);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Border — the lit card gets the accent and a glow.
    ctx.lineWidth = Math.max(1.5, cardW * (active ? 0.014 : 0.008));
    if (active) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = cardW * 0.3;
      ctx.strokeStyle = accent;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
    }
    roundRect(ctx, x, y, cardW, cardH, cardW * 0.16);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Icon.
    const iconSize = cardW * 0.42;
    ctx.font = `${Math.round(iconSize)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(item.icon || '✦', x + cardW / 2, y + cardH * 0.40);

    // Label.
    const labelSize = cardW * 0.135;
    ctx.font = `800 ${Math.round(labelSize)}px Archivo Black, Inter, sans-serif`;
    ctx.fillStyle = active ? accent : 'rgba(255,255,255,.82)';
    if (active) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = labelSize * 0.9;
    }
    const text = String(item.label || '').toUpperCase();
    const maxW = cardW * 0.84;
    let ls = labelSize;
    while (ctx.measureText(text).width > maxW && ls > 6) {
      ls *= 0.92;
      ctx.font = `800 ${Math.round(ls)}px Archivo Black, Inter, sans-serif`;
    }
    ctx.fillText(text, x + cardW / 2, y + cardH * 0.78);
    ctx.restore();
  });
}

/* ------------------------------------------------------- luxe icon cards */

const GOLD = ['#f7e7b4', '#d4af37', '#9c7a2b'];
const CREAM = '#f5f1e8';

// Line icons drawn in a unit box centred on the origin (-1..1), so they stay
// crisp at any size — emoji look cheap next to a gold frame.
const GLYPHS = {
  cash(ctx) {
    roundRect(ctx, -0.95, -0.55, 1.9, 1.1, 0.14);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.66, -0.26); ctx.lineTo(-0.66, 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.66, -0.26); ctx.lineTo(0.66, 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.8, 0.78); ctx.lineTo(0.8, 0.78); ctx.stroke();
  },
  chart(ctx) {
    ctx.beginPath(); ctx.moveTo(-0.9, -0.9); ctx.lineTo(-0.9, 0.85); ctx.lineTo(0.95, 0.85); ctx.stroke();
    [[-0.55, 0.3], [-0.1, -0.1], [0.35, 0.15], [0.8, -0.55]].forEach(([x, top], i, a) => {
      ctx.beginPath(); ctx.moveTo(x, 0.62); ctx.lineTo(x, top + 0.2); ctx.stroke();
      if (i) { ctx.beginPath(); ctx.moveTo(a[i - 1][0], a[i - 1][1] - 0.25); ctx.lineTo(x, top - 0.25); ctx.stroke(); }
    });
  },
  home(ctx) {
    ctx.beginPath();
    ctx.moveTo(-0.95, -0.05); ctx.lineTo(0, -0.9); ctx.lineTo(0.95, -0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.7, -0.25); ctx.lineTo(-0.7, 0.85); ctx.lineTo(0.7, 0.85); ctx.lineTo(0.7, -0.25);
    ctx.stroke();
    roundRect(ctx, -0.2, 0.3, 0.4, 0.55, 0.06); ctx.stroke();
  },
  shield(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -0.95); ctx.lineTo(0.8, -0.6); ctx.lineTo(0.7, 0.2);
    ctx.quadraticCurveTo(0.5, 0.75, 0, 0.95); ctx.quadraticCurveTo(-0.5, 0.75, -0.7, 0.2);
    ctx.lineTo(-0.8, -0.6); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.32, 0); ctx.lineTo(-0.06, 0.28); ctx.lineTo(0.38, -0.24); ctx.stroke();
  },
};

function drawLuxeCards(ctx, W, H, clip, time) {
  const pal = { metal: GOLD, cream: CREAM, line: 'rgba(212,175,55,.45)', glow: 'rgba(212,175,55,.75)', body: ['rgba(26,23,18,.93)', 'rgba(8,8,8,.93)'], ...(clip.palette || {}) };
  const metal = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    pal.metal.forEach((c, i) => g.addColorStop(i / (pal.metal.length - 1), c));
    return g;
  };
  const local = time - clip.start;
  const items = clip.items || [];
  const n = items.length;
  if (!n) return;
  const gap = W * 0.028;
  const cardW = (W * (clip.width ?? 0.86) - gap * (n - 1)) / n;
  const cardH = cardW * (clip.ratio ?? 1.18);
  const x0 = (W - (cardW * n + gap * (n - 1))) / 2;
  const y0 = H * (clip.y ?? 0.5) - cardH / 2;
  const per = clip.duration / n;
  const activeIdx = clip.walk ? clamp(Math.floor(local / per), 0, n - 1) : clip.active ?? -1;
  const outT = clip.start + clip.duration - time;

  items.forEach((item, i) => {
    const p = easeOut((local - i * 0.12) / 0.5);
    if (p <= 0) return;
    const alpha = p * (outT < 0.35 ? clamp(outT / 0.35, 0, 1) : 1);
    const active = i === activeIdx;
    // The lit card grows in smoothly rather than snapping.
    const litT = active ? easeOut((local - i * per) / 0.3) : 0;
    const sc = 1 + 0.06 * litT;
    const cx = x0 + i * (cardW + gap) + cardW / 2;
    const cy = y0 + cardH / 2 + (1 - p) * cardH * 0.22;
    const r = cardW * 0.12;

    ctx.save();
    ctx.globalAlpha = alpha * (active || activeIdx < 0 ? 1 : 0.78);
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    const x = -cardW / 2, y = -cardH / 2;

    // Deep glass body.
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = cardW * 0.22;
    ctx.shadowOffsetY = cardH * 0.05;
    const body = ctx.createLinearGradient(0, y, 0, y + cardH);
    body.addColorStop(0, pal.body[0]);
    body.addColorStop(1, pal.body[1]);
    ctx.fillStyle = body;
    roundRect(ctx, x, y, cardW, cardH, r);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Gold hairline; the lit card gets a heavier rim and a warm glow.
    ctx.lineWidth = cardW * (active ? 0.022 : 0.009);
    ctx.strokeStyle = active ? metal(x, y, x + cardW, y + cardH) : pal.line;
    if (active) { ctx.shadowColor = pal.glow; ctx.shadowBlur = cardW * 0.28 * litT; }
    roundRect(ctx, x, y, cardW, cardH, r);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Step number.
    ctx.fillStyle = pal.metal[1];
    ctx.font = `700 ${Math.round(cardW * 0.1)}px Montserrat, Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(i + 1).padStart(2, '0'), x + cardW * 0.1, y + cardW * 0.09);

    // Icon: a gold ring with a line glyph inside.
    const iy = y + cardH * 0.4;
    const ir = cardW * 0.23;
    ctx.lineWidth = cardW * 0.012;
    ctx.strokeStyle = active ? metal(-ir, iy - ir, ir, iy + ir) : pal.line;
    ctx.beginPath(); ctx.arc(0, iy, ir, 0, Math.PI * 2); ctx.stroke();
    const glyph = GLYPHS[item.glyph];
    if (glyph) {
      ctx.save();
      ctx.translate(0, iy);
      const gs = ir * 0.52;
      ctx.scale(gs, gs);
      ctx.lineWidth = (cardW * 0.016) / gs;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = active ? metal(-1, -1, 1, 1) : pal.cream;
      glyph(ctx);
      ctx.restore();
    }

    // Label: cream, tracked out; gold when lit.
    const label = String(item.label || '').toUpperCase();
    let ls = cardW * 0.12;
    const font = (s) => `700 ${Math.round(s)}px Montserrat, Inter, sans-serif`;
    ctx.font = font(ls);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(ls * 0.12)}px`;
    while (ctx.measureText(label).width > cardW * 0.84 && ls > 6) {
      ls *= 0.92;
      ctx.font = font(ls);
    }
    ctx.fillStyle = active ? metal(-cardW / 2, 0, cardW / 2, 0) : pal.cream;
    ctx.fillText(label, 0, y + cardH * 0.8);
    ctx.restore();
  });
}

/* --------------------------------------------------------- framed b-roll */

// Frames now describe *styling only*. Size and position come from the clip, so
// a panel can be dragged and resized without changing its look.
const FRAMES = {
  luxury: { radius: 0.05, border: 0.004, glow: 0.28, corners: true },
  soft: { radius: 0.09, border: 0, glow: 0.18, corners: false },
  hard: { radius: 0.012, border: 0.006, glow: 0, corners: false },
  none: { radius: 0, border: 0, glow: 0, corners: false },
  full: { radius: 0, border: 0, glow: 0, corners: false },
};

export const FRAME_STYLES = Object.keys(FRAMES);

export const BROLL_ANIMS = [
  'fade', 'scale', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'wipe',
];

// Quick placements. `behind` pairs with segmentation to put the clip behind
// the speaker; the rest float it over the shot.
export const BROLL_PLACEMENTS = {
  behind: { name: 'Behind person', x: 0.66, y: 0.52, w: 0.52, h: 0.44, frame: 'luxury', behind: true, anim: 'scale' },
  full: { name: 'Full frame', x: 0.5, y: 0.5, w: 1, h: 1, frame: 'full', behind: false, anim: 'fade' },
  top: { name: 'Top panel', x: 0.5, y: 0.28, w: 0.78, h: 0.4, frame: 'luxury', behind: false, anim: 'slide-down' },
  bottom: { name: 'Bottom panel', x: 0.5, y: 0.74, w: 0.78, h: 0.36, frame: 'luxury', behind: false, anim: 'slide-up' },
  left: { name: 'Left side', x: 0.27, y: 0.5, w: 0.46, h: 0.34, frame: 'soft', behind: false, anim: 'slide-left' },
  right: { name: 'Right side', x: 0.73, y: 0.5, w: 0.46, h: 0.34, frame: 'soft', behind: false, anim: 'slide-right' },
  corner: { name: 'Corner inset', x: 0.74, y: 0.22, w: 0.4, h: 0.26, frame: 'luxury', behind: false, anim: 'scale' },
};

/** Pixel box for a b-roll clip. Falls back to the older inset fields. */
export function brollBox(clip, W, H) {
  const w = clip.w ?? 0.78;
  const h = clip.h ?? clip.height ?? 0.4;
  const cx = clip.x ?? 0.5 + (clip.offsetX ?? 0);
  const cy = clip.y ?? 0.28;
  const boxW = Math.round(W * w);
  const boxH = Math.round(H * h);
  return { bx: Math.round(W * cx - boxW / 2), by: Math.round(H * cy - boxH / 2), boxW, boxH };
}

/**
 * Draw a b-roll clip. `behind` clips are drawn as plain background layers —
 * the renderer paints the masked person over them afterwards.
 */
export function drawBroll(ctx, W, H, el, clip, time, accent) {
  const f = FRAMES[clip.frame] || FRAMES.luxury;
  const local = time - clip.start;
  const remaining = clip.start + clip.duration - time;

  const inT = easeOut(local / 0.34);
  const outT = clamp(remaining / 0.28, 0, 1);
  let alpha = clamp(inT, 0, 1) * outT;
  if (alpha <= 0.002) return;

  const sw = el.videoWidth || el.naturalWidth || W;
  const sh = el.videoHeight || el.naturalHeight || H;
  if (!sw || !sh) return;

  let { bx, by, boxW, boxH } = brollBox(clip, W, H);
  const radius = Math.min(boxW, boxH) * f.radius;

  // Entrance. Offsets are applied to the whole panel, wipe clips it instead.
  let dx = 0;
  let dy = 0;
  let scale = 1;
  let wipe = 1;
  const p = clamp(inT, 0, 1);
  switch (clip.anim || 'fade') {
    case 'scale': scale = 0.9 + 0.1 * p; break;
    case 'slide-left': dx = -(1 - p) * (boxW * 0.5 + bx + boxW); break;
    case 'slide-right': dx = (1 - p) * (W - bx + boxW * 0.5); break;
    case 'slide-up': dy = (1 - p) * (H - by + boxH * 0.5); break;
    case 'slide-down': dy = -(1 - p) * (by + boxH * 1.5); break;
    case 'wipe': wipe = p; alpha = outT; break;
    default: scale = 0.965 + 0.035 * p; break;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(dx, dy);
  if (scale !== 1) {
    const cx = bx + boxW / 2;
    const cy = by + boxH / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  if (f.glow > 0) {
    ctx.shadowColor = accent || 'rgba(255,255,255,.5)';
    ctx.shadowBlur = Math.min(boxW, boxH) * f.glow;
    ctx.fillStyle = 'rgba(0,0,0,.9)';
    roundRect(ctx, bx, by, boxW, boxH, radius);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.save();
  roundRect(ctx, bx, by, boxW * wipe, boxH, radius);
  ctx.clip();

  // Optional slow move for stills: zoom -> zoomTo and a drift of panX/panY
  // (fractions of the box) across the clip.
  const prog = clamp(local / Math.max(0.1, clip.duration), 0, 1);
  const z0 = clip.zoom ?? 1.04;
  const z = clip.zoomTo != null ? z0 + (clip.zoomTo - z0) * prog : z0;
  const fit = Math.max(boxW / sw, boxH / sh) * z;
  const dw = sw * fit;
  const dh = sh * fit;
  const px = (clip.panX || 0) * (prog - 0.5) * boxW;
  const py = (clip.panY || 0) * (prog - 0.5) * boxH;
  ctx.filter = clip.filter || 'none';
  try {
    ctx.drawImage(el, bx + (boxW - dw) / 2 + px, by + (boxH - dh) / 2 + py, dw, dh);
  } catch { /* frame not ready */ }
  ctx.filter = 'none';

  // Skip the depth gradient on a full background — it would just dim the shot.
  if (!clip.behind) {
    const vg = ctx.createLinearGradient(bx, by, bx, by + boxH);
    vg.addColorStop(0, 'rgba(0,0,0,.18)');
    vg.addColorStop(0.5, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.26)');
    ctx.fillStyle = vg;
    ctx.fillRect(bx, by, boxW, boxH);
  }
  ctx.restore();

  if (f.border > 0) {
    ctx.lineWidth = Math.max(1, Math.min(boxW, boxH) * f.border);
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    roundRect(ctx, bx, by, boxW, boxH, radius);
    ctx.stroke();
  }

  if (f.corners) {
    const L = Math.min(boxW, boxH) * 0.07;
    ctx.strokeStyle = accent || '#fff';
    ctx.lineWidth = Math.max(1.5, Math.min(boxW, boxH) * 0.0055);
    ctx.lineCap = 'round';
    const pad = radius * 0.5;
    for (const [x, y, sx, sy] of [
      [bx + pad, by + pad, 1, 1], [bx + boxW - pad, by + pad, -1, 1],
      [bx + pad, by + boxH - pad, 1, -1], [bx + boxW - pad, by + boxH - pad, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * L, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * L);
      ctx.stroke();
    }
  }

  if (clip.label) {
    const ls = Math.min(boxW, boxH) * 0.055;
    ctx.font = `800 ${Math.round(ls)}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(clip.label).width;
    ctx.fillStyle = accent || '#fff';
    roundRect(ctx, bx + ls * 0.6, by + ls * 0.6, tw + ls * 1.1, ls * 1.7, ls * 0.45);
    ctx.fill();
    ctx.fillStyle = '#0b0b0f';
    ctx.fillText(clip.label, bx + ls * 1.15, by + ls * 1.47);
  }

  ctx.restore();
}

/* --------------------------------------------------------- whip transition */

/**
 * How far to smear the frame at `time`, given the cut points. Returns null when
 * the playhead is not near a cut. The renderer turns this into a blur + slide.
 */
export function whipAt(time, cuts, dur = 0.16) {
  for (const c of cuts) {
    const d = time - c;
    if (Math.abs(d) > dur / 2) continue;
    // -1 .. 1 across the cut, strongest at the cut itself.
    const t = d / (dur / 2);
    return { amount: 1 - Math.abs(t), direction: t < 0 ? -1 : 1 };
  }
  return null;
}
