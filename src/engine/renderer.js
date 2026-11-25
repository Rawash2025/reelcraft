import { styleById } from './captionStyles.js';
import { filterById } from './filters.js';
import { drawCards, drawBroll, whipAt } from './layers.js';
import { drawFinish } from './finish.js';
import { personMask } from './segment.js';
import { drawBackground } from './background.js';
import { drawHero, heroHasBehind } from './heroText.js';
import { drawCard, drawCollage, drawDocument, drawPIP } from './overlays.js';
import { faceAt } from './faceCache.js';
import { log } from './log.js';
import { drawPremiumScene, sceneHasDepth } from './premiumScenes.js';
import { getBrand } from '../brand/brands.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export function clipAt(track, time) {
  if (!track) return null;
  return (
    track.clips.find((c) => time >= c.start && time < c.start + c.duration) || null
  );
}

export function projectDuration(tracks) {
  let end = 0;
  for (const t of tracks)
    for (const c of t.clips) {
      const e = c.start + c.duration;
      // Ignore non-finite clips so one bad clip cannot poison the whole
      // duration (which used to NaN-out the audio renderers).
      if (Number.isFinite(e)) end = Math.max(end, e);
    }
  return end;
}

/* ---------------------------------------------------------------- captions */

// Words are grouped into on-screen chunks. A chunk is shown while the playhead
// sits inside it; the word under the playhead is the "active" one.
export function buildChunks(words, groupSize) {
  const chunks = [];
  for (let i = 0; i < words.length; i += groupSize) {
    const group = words.slice(i, i + groupSize);
    if (!group.length) continue;
    chunks.push({
      words: group,
      start: group[0].start,
      end: group[group.length - 1].end,
    });
  }
  return chunks;
}

export function chunkAt(chunks, time) {
  // Strict containment wins. Only fall back to the trailing grace window when
  // no chunk actually contains the playhead — otherwise adjacent chunks overlap
  // inside the grace period and the stale one is found first.
  return (
    chunks.find((c) => time >= c.start && time <= c.end) ||
    chunks.find((c) => time >= c.start && time <= c.end + 0.08) ||
    null
  );
}

function applyTextPaint(ctx, style, S, x, y, w) {
  if (style.gradient) {
    const g = ctx.createLinearGradient(x - w / 2, y - S * 0.06, x + w / 2, y + S * 0.06);
    style.gradient.forEach((c, i) =>
      g.addColorStop(i / (style.gradient.length - 1), c)
    );
    ctx.fillStyle = g;
  }
}

function drawCaptions(ctx, W, H, time, captions, accent) {
  const { words, styleId, groupSize, y: posY, scale = 1, enabled } = captions;
  if (!enabled || !words.length) return;
  const style = styleById(styleId);
  const chunks = captions._chunks || buildChunks(words, groupSize);
  const chunk = chunkAt(chunks, time);
  if (!chunk) return;

  const S = H * style.size * scale;
  const strokeW = (style.strokeWidth || 0) * S;
  const maxW = W * 0.86;

  // Arabic/Hebrew chunks read right-to-left and need a font with the glyphs.
  const rtl = chunk.words.some((w) => RTL_RE.test(w.text));
  const fontOf = (size) => {
    const f = style.font.replace('{size}', String(size));
    return rtl ? f.replace(/px .*$/, 'px Cairo, "Noto Sans Arabic", "Geeza Pro", sans-serif') : f;
  };

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = fontOf(Math.round(S));

  // Typewriter reveals words progressively; every other style shows the chunk.
  let visible = chunk.words;
  if (style.anim === 'type')
    visible = chunk.words.filter((w) => time >= w.start - 0.02);
  if (!visible.length) {
    ctx.restore();
    return;
  }

  // Wrap the chunk into lines that fit the safe width.
  const space = ctx.measureText(' ').width;
  const EMPH = 1.14; // emphasised words render a touch larger
  const lines = [[]];
  let lineW = 0;
  const baseFont = ctx.font;
  const emphFont = fontOf(Math.round(S * EMPH));
  for (const w of visible) {
    const text = style.uppercase ? w.text.toUpperCase() : w.text;
    ctx.font = w.emph ? emphFont : baseFont;
    const tw = ctx.measureText(text).width;
    if (lineW + tw > maxW && lines[lines.length - 1].length) {
      lines.push([]);
      lineW = 0;
    }
    lines[lines.length - 1].push({ ...w, text, w: tw });
    lineW += tw + space;
  }
  ctx.font = baseFont;

  const lineH = S * style.lineGap;
  const blockH = lines.length * lineH;
  const baseY = H * posY - blockH / 2 + lineH / 2;

  // Chunk-level entrance so text never just snaps in.
  const inT = easeOut((time - chunk.start) / 0.18);

  lines.forEach((line, li) => {
    const totalW = line.reduce((a, w) => a + w.w, 0) + space * (line.length - 1);
    // RTL lines start at the right edge and advance leftwards.
    const dir = rtl ? -1 : 1;
    let x = rtl ? (W + totalW) / 2 : (W - totalW) / 2;
    const y = baseY + li * lineH;

    for (const w of line) {
      const active = time >= w.start && time <= w.end;
      const since = clamp((time - w.start) / 0.14, 0, 1);
      let sc = 1;
      let dy = 0;
      let alpha = 1;

      switch (style.anim) {
        case 'pop':
          sc = active ? 1 + 0.16 * (1 - easeOut(since)) : 1;
          break;
        case 'punch':
          sc = active ? 1 + 0.22 * (1 - easeOut(since)) : 1;
          dy = active ? -S * 0.06 * (1 - easeOut(since)) : 0;
          break;
        case 'rise':
          dy = (1 - inT) * S * 0.5;
          alpha = inT;
          break;
        case 'fade':
        case 'glow':
          alpha = inT;
          break;
        case 'type':
          alpha = clamp((time - w.start) / 0.08, 0, 1);
          break;
        default:
          break;
      }

      const cx = x + (dir * w.w) / 2;
      const cy = y + dy;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(sc, sc);

      // Word background chip (boxed / karaoke styles).
      const box = active ? style.activeBox : style.wordBox;
      if (box) {
        const padX = S * 0.16;
        const padY = S * 0.2;
        const r = S * 0.16;
        ctx.fillStyle = box;
        roundRect(ctx, -w.w / 2 - padX, -S / 2 - padY + S * 0.06, w.w + padX * 2, S + padY * 2 - S * 0.06, r);
        ctx.fill();
      }

      if (style.shadow) {
        ctx.shadowColor = style.shadow.color;
        ctx.shadowBlur = style.shadow.blur * S;
        ctx.shadowOffsetY = (style.shadow.y || 0) * S;
      }
      if (style.glow && active) {
        ctx.shadowColor = style.glow;
        ctx.shadowBlur = S * 0.55;
      }

      ctx.textAlign = 'center';
      if (w.emph) {
        ctx.font = emphFont;
        if (accent && !style.activeGradient && !style.crisp) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = Math.max(ctx.shadowBlur, S * 0.3);
        }
      }
      if (strokeW) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = style.stroke;
        ctx.strokeText(w.text, 0, 0);
      }
      ctx.fillStyle = w.emph && accent
        ? accent
        : active ? style.activeFill : style.fill;
      if (style.activeGradient) {
        if (active && !w.emph) applyTextPaint(ctx, { gradient: style.activeGradient }, S, 0, 0, w.w);
      } else if (!w.emph) applyTextPaint(ctx, style, S, 0, 0, w.w);
      ctx.shadowBlur = style.glow && active ? S * 0.35 : ctx.shadowBlur;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
      ctx.font = baseFont;

      // Keyword icon: pops in above the word as it becomes active, settling
      // into place. Sized relative to the caption so it scales with everything.
      if (w.icon) {
        const iconT = active ? easeOut((time - w.start) / 0.2) : 1;
        const isz = S * 1.15;
        const iy = cy - S * 0.75 - isz * 0.55 * iconT;
        ctx.save();
        ctx.globalAlpha = alpha * clamp(iconT, 0, 1);
        ctx.font = `${Math.round(isz)}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const bounce = active ? (1 - iconT) * S * 0.25 : 0;
        ctx.fillText(w.icon, cx, iy + bounce);
        ctx.restore();
      }

      x += dir * (w.w + space);
    }
  });
  ctx.restore();
}

const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ layers */

// Animated framing. `punch` snaps in on the cut and settles — the move that
// makes a jump cut read as intentional. `push`/`pull` drift across the clip.
export function motionScale(clip, local) {
  const m = clip.motion;
  if (!m || m.type === 'none') return { scale: 1, x: 0, y: 0 };
  const dur = Math.max(0.05, m.duration ?? clip.duration);
  const p = clamp(local / dur, 0, 1);
  const from = m.from ?? 1;
  const to = m.to ?? 1;
  switch (m.type) {
    case 'punch':
      // Fast ease-out over ~0.35s, then hold.
      return { scale: from + (to - from) * easeOut(local / (m.duration ?? 0.35)), x: 0, y: 0 };
    case 'push':
    case 'pull':
      return { scale: from + (to - from) * p, x: 0, y: 0 };
    case 'kenburns':
      return {
        scale: from + (to - from) * p,
        x: (m.dx ?? 0) * p,
        y: (m.dy ?? 0) * p,
      };
    case 'parallax': {
      // 2.5D approximation: a slow dolly with a drifting centre. It reads as
      // depth on most footage, but it is not depth-map parallax — there is no
      // per-pixel displacement here.
      const cycles = m.cycles ?? 1;
      const ph = (local / Math.max(0.1, dur)) * Math.PI * 2 * cycles;
      const amp = m.amp ?? 0.06;
      return {
        scale: 1 + amp * 0.6 + Math.sin(ph) * amp * 0.4,
        x: Math.sin(ph * 0.75) * amp * 0.28,
        y: Math.cos(ph * 0.5) * amp * 0.16,
      };
    }
    default:
      return { scale: 1, x: 0, y: 0 };
  }
}

// Where the source lands on the canvas. Shared with the person mask so the
// cutout registers exactly with the footage it was computed from.
function sourceRect(W, H, el, clip, asset, local) {
  const sw = asset.width || el.videoWidth || el.naturalWidth || W;
  const sh = asset.height || el.videoHeight || el.naturalHeight || H;
  if (!sw || !sh) return null;
  const t = clip.transform || {};
  const mo = motionScale(clip, local);
  const zoom = (t.scale ?? 1) * mo.scale;
  const fit = clip.fit === 'contain'
    ? Math.min(W / sw, H / sh)
    : Math.max(W / sw, H / sh);
  const scale = fit * zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  return {
    dx: (W - dw) / 2 + ((t.x ?? 0) + mo.x) * W,
    dy: (H - dh) / 2 + ((t.y ?? 0) + mo.y) * H,
    dw, dh, t,
  };
}


/**
 * Authoritative camera-crop helper. Guarantees the source fully covers the
 * canvas at every camera position (object-fit: cover), so face reframe, zoom,
 * motion pan and whip can never expose black canvas.
 *
 * Returns { dx, dy, dw, dh } — the destination rect for drawImage. The final
 * dx/dy are ALWAYS clamped to the coverage range [W-dw, 0] x [H-dh, 0], after
 * every offset has been applied (per the "clamp last" rule). When a requested
 * pan needs more room than the current zoom provides, a minimal overscan zoom
 * is added rather than exposing an edge.
 */
export function safeCoverRect(W, H, sw, sh, {
  zoom = 1, panX = 0, panY = 0, faceTarget = null, contain = false,
} = {}) {
  if (contain) {
    // Contain letterboxes by design; centre it, no pan into the letterbox.
    const fit = Math.min(W / sw, H / sh) * zoom;
    const dw = sw * fit, dh = sh * fit;
    return { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, contain: true };
  }

  const coverFit = Math.max(W / sw, H / sh);

  // How much horizontal/vertical travel the requested pan + face target wants,
  // as a fraction of the canvas. Used to decide the minimum overscan.
  let wantX = Math.abs(panX);
  let wantY = Math.abs(panY);
  if (faceTarget) {
    // face should land at faceTarget.tx/ty; centred it lands at 0.5/0.5-ish,
    // so the extra travel needed is roughly |target - faceCentre|.
    wantX = Math.max(wantX, Math.abs((faceTarget.tx ?? 0.5) - (faceTarget.cx ?? 0.5)) * 0.5);
    wantY = Math.max(wantY, Math.abs((faceTarget.ty ?? 0.5) - (faceTarget.cy ?? 0.5)) * 0.5);
  }

  // Overscan so the requested travel has room. slackFraction each side = (dw-W)/2/W.
  // Need slackFraction >= want  =>  dw >= W(1 + 2*want)  =>  extra zoom factor.
  let scale = coverFit * zoom;
  const needExtra = Math.max(1 + 2 * wantX, (1 + 2 * wantY) * (coverFit * H) / (sh * scale) * (sh * scale) / (coverFit * H));
  // Simpler, robust: bump zoom to whichever axis needs the most overscan, capped.
  const dwAt = (z) => sw * coverFit * z;
  const dhAt = (z) => sh * coverFit * z;
  let z = zoom;
  // horizontal room needed
  if (wantX > 0) {
    const needDw = W * (1 + 2 * wantX);
    if (dwAt(z) < needDw) z = Math.max(z, needDw / (sw * coverFit));
  }
  if (wantY > 0) {
    const needDh = H * (1 + 2 * wantY);
    if (dhAt(z) < needDh) z = Math.max(z, needDh / (sh * coverFit));
  }
  z = Math.min(z, Math.max(zoom, 1.15)); // cap overscan — never zoom in excessively
  scale = coverFit * z;

  const dw = sw * scale;
  const dh = sh * scale;

  // Desired centre + pan, then face target, then the mandatory coverage clamp.
  let dx = (W - dw) / 2 + panX * W;
  let dy = (H - dh) / 2 + panY * H;
  if (faceTarget) {
    // Put the face centre at the target canvas position.
    if (faceTarget.tx != null) dx = (faceTarget.tx * W) - faceTarget.cx * dw;
    if (faceTarget.ty != null) dy = (faceTarget.ty * H) - faceTarget.cy * dh;
    // Re-apply overlay/motion pan on top of the face placement.
    dx += panX * W;
    dy += panY * H;
  }

  // THE GUARANTEE: clamp so the image always covers the canvas.
  dx = clamp(dx, W - dw, 0);
  dy = clamp(dy, H - dh, 0);
  return { dx, dy, dw, dh, contain: false, scale, zoomUsed: z };
}

function drawSource(ctx, W, H, el, clip, asset, local, whip, face, reframe) {
  const sw = asset.width || el.videoWidth || el.naturalWidth || 0;
  const sh = asset.height || el.videoHeight || el.naturalHeight || 0;
  if (!sw || !sh) return false;
  const t = clip.transform || {};
  const mo = motionScale(clip, local);

  // Assemble the requested camera: zoom + motion pan (+ overlay nudge via
  // reframe.x) + a face target. Everything is handed to safeCoverRect, which
  // applies the mandatory coverage clamp LAST so nothing can expose black.
  const zoom = (t.scale ?? 1) * mo.scale;
  let panX = (t.x ?? 0) + mo.x + (reframe?.x || 0);
  let panY = (t.y ?? 0) + mo.y;
  // Whip pan folded into panX so it is clamped too (blur stays as a filter).
  if (whip) panX += whip.direction * whip.amount * 0.16;

  const faceTarget = face && clip.fit !== 'contain'
    ? { cx: face.cx, cy: face.cy, tx: 0.5 + (reframe?.x || 0), ty: 0.42 + (reframe?.y || 0) }
    : null;

  const rect = safeCoverRect(W, H, sw, sh, {
    zoom, panX: faceTarget ? (reframe?.x || 0) : panX, panY: faceTarget ? 0 : panY,
    faceTarget, contain: clip.fit === 'contain',
  });
  const { dx, dy, dw, dh } = rect;

  ctx.save();
  ctx.globalAlpha = clip.opacity ?? 1;
  const grade = filterById(clip.filter).css;
  if (whip) {
    const blur = whip.amount * W * 0.012;
    ctx.filter = `${grade === 'none' ? '' : grade + ' '}blur(${blur.toFixed(1)}px)`.trim();
  } else {
    ctx.filter = grade;
  }
  if (t.rotate) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate((t.rotate * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
  }

  // Dev-mode invariant: the destination rect must cover the canvas.
  if (import.meta.env.DEV) {
    const tol = 0.5;
    if (dx > tol || dy > tol || dx + dw < W - tol || dy + dh < H - tol) {
      log.throttle('cover-fail', 1500, 'error', 'render',
        'source does not cover canvas', { dx: +dx.toFixed(1), dy: +dy.toFixed(1), dw: +dw.toFixed(1), dh: +dh.toFixed(1), W, H });
    }
  }

  let drew = false;
  try {
    ctx.drawImage(el, dx, dy, dw, dh);
    drew = true;
  } catch {
    /* frame not decodable yet — caller handles the fallback */
  }
  ctx.restore();
  return drew;
}

function drawTextClip(ctx, W, H, clip, time) {
  const s = clip.style || {};
  let size = H * (s.size ?? 0.06);
  const local = time - clip.start;
  let alpha = 1;
  let dy = 0;
  const inD = 0.3;
  if (clip.anim === 'fade') alpha = clamp(local / inD, 0, 1);
  if (clip.anim === 'slide') {
    const p = easeOut(local / inD);
    dy = (1 - p) * size;
    alpha = p;
  }
  if (clip.anim === 'pop') {
    alpha = clamp(local / 0.15, 0, 1);
  }
  const out = clip.start + clip.duration - time;
  if (out < 0.3) alpha *= clamp(out / 0.3, 0, 1);

  ctx.save();
  ctx.globalAlpha = alpha;
  const fontOf = (px) =>
    `${s.weight ?? 800} ${Math.round(px)}px ${s.font ?? 'Inter'}, sans-serif`;
  ctx.font = fontOf(size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = W * (clip.x ?? 0.5);
  const y = H * (clip.y ?? 0.2) + dy;
  const text = (s.uppercase ? clip.text.toUpperCase() : clip.text).split('\n');

  // Shrink until the widest line fits the safe area — a hook line written by
  // the director has no reason to know how wide the frame is.
  const safe = W * 0.88;
  const widest = Math.max(...text.map((l) => ctx.measureText(l).width), 1);
  if (widest > safe) {
    size *= safe / widest;
    ctx.font = fontOf(size);
  }
  const lh = size * (s.lineHeight ?? 1.2);
  if (s.tracking && 'letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * s.tracking)}px`;
  const padX = size * (s.padX ?? 0.3);
  text.forEach((line, i) => {
    const ly = y + (i - (text.length - 1) / 2) * lh;
    if (s.bg || s.border) {
      const w = ctx.measureText(line).width;
      const bx = x - w / 2 - padX, by = ly - lh / 2, bw = w + padX * 2;
      const br = s.radius != null ? lh * s.radius : size * 0.2;
      if (s.bg) {
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = size * 0.4;
        ctx.fillStyle = s.bg;
        roundRect(ctx, bx, by, bw, lh, br);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (s.border) {
        ctx.lineWidth = Math.max(1.5, size * 0.05);
        ctx.strokeStyle = s.border === 'gold' ? goldFill(ctx, bx, by, bx + bw, by + lh) : s.border;
        roundRect(ctx, bx, by, bw, lh, br);
        ctx.stroke();
      }
    }
    if (s.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.strokeWidth * size;
      ctx.strokeStyle = s.stroke ?? '#000';
      ctx.strokeText(line, x, ly);
    }
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = size * 0.15;
    if (s.color === 'gold') {
      const w = ctx.measureText(line).width;
      ctx.fillStyle = goldFill(ctx, x - w / 2, ly - size / 2, x + w / 2, ly + size / 2);
    } else ctx.fillStyle = s.color ?? '#fff';
    ctx.fillText(line, x, ly);
    ctx.shadowBlur = 0;
  });
  ctx.restore();
}

// A brand logo: a corner watermark, or a centred end card when `backdrop` dims
// the frame and `panel` puts a rounded plate behind the mark.
function drawLogo(ctx, W, H, clip, el, time) {
  if (!el || !(el.naturalWidth || el.videoWidth || el.width)) return;
  const local = time - clip.start;
  const out = clip.start + clip.duration - time;
  const alpha = clamp(local / 0.25, 0, 1) * clamp(out / 0.25, 0, 1) * (clip.opacity ?? 1);
  if (alpha <= 0.002) return;
  const iw = el.naturalWidth || el.width;
  const ih = el.naturalHeight || el.height;
  const w = W * (clip.w ?? 0.2);
  const h = (w * ih) / iw;
  const sc = clip.pop ? 0.7 + 0.3 * clamp(easeOut(local / 0.45), 0, 1) : 1;
  const cx = W * (clip.x ?? 0.5);
  const cy = H * (clip.y ?? 0.5);

  ctx.save();
  if (clip.backdrop) {
    ctx.globalAlpha = alpha * clip.backdrop;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  if (clip.panel) {
    const pad = w * 0.14;
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = w * 0.08;
    ctx.fillStyle = clip.panel;
    roundRect(ctx, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, pad * 0.9);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (clip.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = w * 0.05;
  }
  ctx.drawImage(el, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function goldFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#f7e7b4');
  g.addColorStop(0.5, '#d4af37');
  g.addColorStop(1, '#9c7a2b');
  return g;
}

// A statistic moment: the frame dims, a ring gauge fills to the value while
// the number counts up, with an eyebrow above and a label below.
function drawStat(ctx, W, H, clip, time) {
  const local = time - clip.start;
  const out = clip.start + clip.duration - time;
  const a = clamp(local / 0.3, 0, 1) * clamp(out / 0.3, 0, 1);
  if (a <= 0.002) return;
  const pal = { ring: '#9aad00', track: 'rgba(245,241,232,.18)', text: '#f5f1e8', sub: 'rgba(245,241,232,.78)', ...(clip.palette || {}) };
  const value = clip.value ?? 50;
  const fill = easeOut((local - 0.15) / 1.1);
  const cx = W / 2, cy = H * (clip.y ?? 0.34), R = W * 0.25;
  ctx.save();
  ctx.globalAlpha = a * (clip.backdrop ?? 0.62);
  ctx.fillStyle = clip.backdropColor || '#0b0d0a';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = a;
  const sc = 0.9 + 0.1 * easeOut(local / 0.45);
  ctx.translate(cx, cy); ctx.scale(sc, sc);
  ctx.lineCap = 'round';
  ctx.lineWidth = R * 0.12;
  ctx.strokeStyle = pal.track;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = pal.ring;
  ctx.shadowColor = pal.ring; ctx.shadowBlur = R * 0.15;
  ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (value / 100) * fill); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.text;
  ctx.font = `800 ${Math.round(R * 0.62)}px Montserrat, Inter, sans-serif`;
  ctx.fillText(`${Math.round(value * fill)}${clip.suffix ?? '%'}`, 0, R * 0.04);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const up = (1 - easeOut((local - 0.3) / 0.4)) * H * 0.02;
  if (clip.eyebrow) {
    const es = W * 0.032;
    ctx.font = `700 ${Math.round(es)}px Montserrat, Inter, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(es * 0.22)}px`;
    ctx.fillStyle = pal.ring;
    ctx.fillText(clip.eyebrow.toUpperCase(), cx, cy - R - W * 0.09);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  let ls = W * 0.058;
  ctx.font = `800 ${Math.round(ls)}px Montserrat, Inter, sans-serif`;
  (clip.label || '').split('\n').forEach((line, i) => {
    ctx.fillStyle = i ? pal.sub : pal.text;
    ctx.font = `${i ? 600 : 800} ${Math.round(i ? ls * 0.62 : ls)}px Montserrat, Inter, sans-serif`;
    ctx.fillText(line, cx, cy + R + W * 0.1 + i * ls * 1.05 + up);
  });
  ctx.restore();
}

// Scratch layer for the masked person pass.
let scratch = null;
let sctx = null;

/**
 * Draw only the person from `el`, using the segmentation mask, so whatever was
 * painted underneath shows through around them.
 * Returns false when no usable mask exists, so the caller can fall back.
 */
function drawPersonMasked(ctx, W, H, el, clip, asset, local, whip, mask, face, reframe) {
  const r = sourceRect(W, H, el, clip, asset, local);
  if (!r || !mask) {
    log.throttle('mask-miss', 2000, 'warn', 'render',
      'behind-subject fell back to un-masked frame', { hasRect: !!r, hasMask: !!mask });
    return false;
  }

  if (!scratch || scratch.width !== W || scratch.height !== H) {
    scratch = document.createElement('canvas');
    scratch.width = W;
    scratch.height = H;
    sctx = scratch.getContext('2d');
  }
  sctx.clearRect(0, 0, W, H);
  drawSource(sctx, W, H, el, clip, asset, local, whip, face, reframe);

  // Keep only the pixels the mask marks as person. The mask is drawn into the
  // same rect as the footage, so it lines up under any zoom or pan.
  sctx.save();
  sctx.globalCompositeOperation = 'destination-in';
  try {
    sctx.drawImage(mask, r.dx, r.dy, r.dw, r.dh);
  } catch (e) {
    sctx.restore();
    log.throttle('mask-draw', 2000, 'error', 'render', 'mask draw failed', e.message);
    return false;
  }
  sctx.restore();

  ctx.drawImage(scratch, 0, 0);
  return true;
}

/* --------------------------------------------------------------- main draw */

/**
 * Draw one composited frame. `media` maps assetId -> HTMLVideoElement/Image.
 * Deterministic: the same (time, state) always produces the same pixels.
 */
// Last fully-composited frame, kept so a momentary decode stall reuses the
// previous good frame instead of flashing black. Sized to the current canvas.
let lastComposite = null;
let lastCtx = null;

export function drawFrame(ctx, time, state, media) {
  const { width: W, height: H } = state.project;

  // Readiness guard: if the main video clip's element has no current frame yet
  // (mid-seek), reuse the last good composite rather than painting black.
  const _vt = state.tracks.find((t) => t.kind === 'video');
  const _clip = clipAt(_vt, time);
  const _el = _clip && media[_clip.assetId];
  const _asset = _clip && state.assets.find((a) => a.id === _clip.assetId);
  if (_el && _asset && _asset.type === 'video' && _el.readyState < 2 &&
      lastComposite && lastComposite.width === W && lastComposite.height === H) {
    ctx.drawImage(lastComposite, 0, 0);
    return;
  }

  ctx.save();
  ctx.fillStyle = state.project.background || '#000000';
  ctx.fillRect(0, 0, W, H);

  const videoTrack = state.tracks.find((t) => t.kind === 'video');
  const clip = clipAt(videoTrack, time);
  // Declared once, early: both the face-reframe (which reads overlay sides) and
  // the hero pass below use it. Declaring it after the reframe block put it in
  // the temporal dead zone and threw at render time.
  const overlayTrack = state.tracks.find((t) => t.kind === 'overlay');

  // Cut points drive the whip transition, when the project asks for one.
  let whip = null;
  // 'whip' hits every cut; otherwise only clips tagged transitionIn: 'whip'.
  if (videoTrack) {
    const all = state.project.transition === 'whip';
    const cuts = videoTrack.clips
      .filter((c) => all || c.transitionIn === 'whip')
      .map((c) => c.start)
      .filter((t0) => t0 > 0.01)
      .sort((a, b) => a - b);
    whip = whipAt(time, cuts);
  }

  const brollTrack = state.tracks.find((t) => t.kind === 'broll');
  const activeBroll = (brollTrack?.clips || []).filter(
    (b) => time >= b.start && time <= b.start + b.duration && media[b.assetId]
  );
  const behind = activeBroll.filter((b) => b.behind);
  const front = activeBroll.filter((b) => !b.behind);

  const asset = clip && state.assets.find((a) => a.id === clip.assetId);
  const el = clip && media[clip.assetId];
  const local = clip ? time - clip.start : 0;

  // Face-aware reframe inputs: interpolate the cached face box (source-relative)
  // and work out which side overlays occupy so the crop can lean the other way.
  const faceEnabled = state.project.face_reframe !== false;
  const face = faceEnabled && clip ? faceAt(clip.assetId, (clip.in || 0) + local * (clip.speed || 1)) : null;
  let reframe = null;
  if (face) {
    let sideBias = 0;
    for (const c of (overlayTrack?.clips || [])) {
      if (time < c.start || time > c.start + c.duration) continue;
      if (c.kind === 'card' && typeof c.x === 'number') sideBias += c.x < 0.5 ? 1 : -1;
      else if (c.kind === 'pip') { const isLeft = /LEFT/.test(c.pos || ''); sideBias += isLeft ? 1 : -1; }
    }
    const nudge = clamp(sideBias, -1, 1) * 0.05;
    reframe = { x: nudge, y: 0 };
  }

  // Behind-the-speaker: the plate goes down first, then the speaker cut out of
  // the main shot on top of it.
  //
  // The mask is resolved BEFORE anything is painted. An earlier version painted
  // the plate, tried to mask, and on failure filled the frame black and redrew
  // the shot — which wiped the plate it had just drawn. Deciding up front means
  // the fallback is simply "no plate", never a half-composited frame.
  // Masked-person compositing serves two features at once: a background-replace
  // mode on the project, and any "behind the speaker" b-roll. Both need the
  // subject cut out of the main shot, so they share one mask and one path.
  const bg = state.project.background_mode && state.project.background_mode !== 'none'
    ? state.project.background_mode : null;
  const wantMask = (bg || behind.length > 0) && clip && asset && el;
  const mask = wantMask ? personMask(el, time * 1000) : null;

  // Hero typography can have lines that sit behind the speaker. Collect the
  // active hero clips up front so both the masked and non-masked paths can slot
  // the behind-pass correctly.
  const activeHeroes = (overlayTrack?.clips || []).filter(
    (c) => c.kind === 'hero' && time >= c.start && time <= c.start + c.duration
  );
  const behindHeroes = activeHeroes.filter(heroHasBehind);
  const activePremium = (overlayTrack?.clips || []).filter(
    (c) => c.kind === 'premium-scene' && time >= c.start && time <= c.start + c.duration
  );
  const depthPremium = activePremium.filter(sceneHasDepth);
  const brandTheme = getBrand(state.project.brand || 'none');

  // Depth scenes use the same subject mask as behind-person B-roll. This is
  // what lets a word or card genuinely pass behind the speaker instead of
  // merely shrinking beside them.
  const sceneNeedsMask = depthPremium.length > 0;
  const originalWantMask = wantMask;
  const resolvedWantMask = originalWantMask || (sceneNeedsMask && clip && asset && el);
  const resolvedMask = resolvedWantMask ? (mask || personMask(el, time * 1000)) : null;
  const resolvedCanMask = resolvedWantMask && !!resolvedMask;

  if (resolvedCanMask) {
    // LAYER 0 — base frame.
    if (bg) {
      // REPLACE_BACKGROUND mode (explicit): the original background is removed
      // and a replacement is drawn behind the isolated person.
      drawBackground(ctx, W, H, bg, {
        color: state.project.background_color,
        blur: state.project.background_blur,
        backdrop: state.project.background_backdrop,
        accent: state.project.accent,
        time,
        sourceEl: el,
        image: state.project.background_asset
          ? media[state.project.background_asset]
          : null,
      });
    } else {
      // BROLL_BEHIND_PERSON (and hero-behind): keep the ORIGINAL full frame —
      // background included — as the base, so the speaker's real room stays
      // visible everywhere the b-roll card and the person do not cover it.
      drawSource(ctx, W, H, el, clip, asset, local, whip, face, reframe);
    }
    // LAYER 1 — behind-the-person b-roll cards (NOT full-screen by default).
    for (const b of behind) {
      drawBroll(ctx, W, H, media[b.assetId], b, time, state.project.accent);
    }
    // LAYER 1b — hero text flagged 'behind'.
    for (const hc of behindHeroes) {
      drawHero(ctx, W, H, hc, time, state.project.accent, brandTheme, 'behind');
    }
    for (const sc of depthPremium) {
      drawPremiumScene(ctx, W, H, sc, time, brandTheme, media, 'behind');
    }
    // LAYER 2 — the segmented person on top (same crop/transform as LAYER 0, so
    // the cut-out aligns exactly with the base and there is no ghosting).
    if (!drawPersonMasked(ctx, W, H, el, clip, asset, local, whip, resolvedMask, face, reframe)) {
      // Mask unavailable this frame: never leave a blank/replaced background.
      // Redraw the original full frame (covers the behind card, keeps the room).
      if (bg) { ctx.fillStyle = state.project.background || '#000000'; ctx.fillRect(0, 0, W, H); }
      drawSource(ctx, W, H, el, clip, asset, local, whip, face, reframe);
    }
    state._sourceDrew = true;
  } else if (clip && asset && el) {
    if (resolvedWantMask) {
      log.throttle('mask-warmup', 3000, 'info', 'render',
        'subject mask warming up — drawing the plain shot for now');
    }
    state._sourceDrew = drawSource(ctx, W, H, el, clip, asset, local, whip, face, reframe);
  } else {
    state._sourceDrew = !clip; // no clip at this time is a legitimately empty frame
  }

  for (const b of front) {
    drawBroll(ctx, W, H, media[b.assetId], b, time, state.project.accent);
  }

  // Overlay track: text cards and shapes above the footage.
  const overlay = state.tracks.find((t) => t.kind === 'overlay');
  if (overlay) {
    for (const c of overlay.clips) {
      if (time < c.start || time > c.start + c.duration) continue;
      if (c.kind === 'text') drawTextClip(ctx, W, H, c, time);
      else if (c.kind === 'cards') drawCards(ctx, W, H, c, time, state.project.accent);
      else if (c.kind === 'hero') {
        // Behind-lines were already drawn (when masking was active); draw the
        // rest in front. If masking was NOT active this frame, draw all lines
        // here so the hero still appears (just without the depth split).
        drawHero(ctx, W, H, c, time, state.project.accent, brandTheme,
          resolvedCanMask ? 'front' : 'all');
      }
      else if (c.kind === 'premium-scene') {
        drawPremiumScene(ctx, W, H, c, time, brandTheme, media,
          resolvedCanMask ? 'front' : 'all');
      }
      else if (c.kind === 'logo') drawLogo(ctx, W, H, c, media[c.assetId], time);
      else if (c.kind === 'stat') drawStat(ctx, W, H, c, time);
      else if (c.kind === 'card') drawCard(ctx, W, H, c, media[c.assetId], time, state.project.accent);
      else if (c.kind === 'collage') drawCollage(ctx, W, H, c, media, time, state.project.accent);
      else if (c.kind === 'document') drawDocument(ctx, W, H, c, media[c.assetId], time, state.project.accent);
      else if (c.kind === 'pip') drawPIP(ctx, W, H, c, media[c.assetId], time, state.project.accent);
    }
  }

  const sceneSuppressesCaptions = activePremium.some((c) => c.hideCaptions !== false);
  if (!sceneSuppressesCaptions) {
    drawCaptions(ctx, W, H, time, state.captions, state.project.accent);
  }

  // Finishing pass sits above everything except the boundary fades.
  if (state.project.finish && state.project.finish !== 'none') {
    drawFinish(
      ctx, W, H, state.project.finish,
      Math.round(time * (state.project.fps || 30)),
      state.project.accent
    );
  }

  // Light flash into clips tagged transitionIn: 'flash'.
  if (clip && clip.transitionIn === 'flash') {
    const fl = 1 - clamp((time - clip.start) / 0.2, 0, 1);
    if (fl > 0) {
      ctx.fillStyle = `rgba(255,250,240,${(fl * fl * 0.6).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Fade to black at clip boundaries.
  if (clip) {
    const inA = clip.fadeIn ? clamp((time - clip.start) / clip.fadeIn, 0, 1) : 1;
    const outA = clip.fadeOut
      ? clamp((clip.start + clip.duration - time) / clip.fadeOut, 0, 1)
      : 1;
    const a = 1 - Math.min(inA, outA);
    if (a > 0) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();

  // Cache this good frame for the readiness fallback (only when the main source
  // actually drew — tracked via _sourceDrew set in the composite section).
  // Transition frames (whip blur, flash) are skipped so a seek stall never
  // freezes on a smeared or washed-out frame.
  const inFlash = clip && clip.transitionIn === 'flash' && time - clip.start < 0.2;
  if (state._sourceDrew !== false && !whip && !inFlash) {
    if (!lastComposite || lastComposite.width !== W || lastComposite.height !== H) {
      lastComposite = document.createElement('canvas');
      lastComposite.width = W; lastComposite.height = H;
      lastCtx = lastComposite.getContext('2d');
    }
    try { lastCtx.drawImage(ctx.canvas, 0, 0); } catch { /* export canvas ok */ }
  }
}
