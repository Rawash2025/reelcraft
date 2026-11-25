// Hero typography — the reference reel's signature.
//
// A hero block is a small supporting line plus ONE huge keyword (e.g. "that
// most" / "AGENTS"), or a big number with a small label. It is NOT the running
// caption; it is a deliberate composition placed on important beats. It can be
// drawn in front of the speaker, or split so one line sits BEHIND them using
// the subject mask — the layered depth look.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (t) => {
  const c = 1.70158;
  const p = clamp(t, 0, 1) - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/**
 * A hero clip:
 * { kind:'hero', lines:[{text, scale, weight, behind, color}], start, duration,
 *   y, anim, accentWord }
 * `scale` is a multiple of the base hero size; `behind:true` draws that line
 * behind the subject (needs the caller to have a mask).
 *
 * Drawing is split into two passes so the compositor can slot the subject
 * between them: drawHeroBehind (lines flagged behind) then drawHeroFront.
 */

function heroLayout(clip, W, H) {
  const base = H * 0.052 * (clip.size ?? 1);
  const lines = clip.lines.map((ln) => ({
    ...ln,
    px: Math.round(base * (ln.scale ?? 1)),
  }));
  const gap = base * 0.12;
  const totalH = lines.reduce((h, ln) => h + ln.px, 0) + gap * (lines.length - 1);
  const top = H * (clip.y ?? 0.32) - totalH / 2;
  let y = top;
  for (const ln of lines) {
    ln.cy = y + ln.px / 2;
    y += ln.px + gap;
  }
  return { lines, base };
}

function drawLine(ctx, ln, W, local, anim, accent, brand) {
  // Per-line entrance, staggered by vertical order via ln.delay.
  const p = easeOutBack((local - (ln.delay || 0)) / 0.34);
  if (p <= 0) return;
  const inA = clamp((local - (ln.delay || 0)) / 0.22, 0, 1);
  let scale = 1;
  let dy = 0;
  let blur = 0;
  switch (anim) {
    case 'pop': scale = 0.9 + 0.1 * clamp(p, 0, 1.05); break;
    case 'slide-up': dy = (1 - easeOut(inA)) * ln.px * 0.6; break;
    case 'blur': blur = (1 - inA) * 14; break;
    default: scale = 0.92 + 0.08 * clamp(p, 0, 1); break;
  }

  const upper = ln.upper ?? (ln.scale ?? 1) >= 1.5;
  const text = upper ? String(ln.text).toUpperCase() : ln.text;
  const font = `${ln.weight ?? 900} ${ln.px}px ${brand?.heading || 'Archivo Black'}, Impact, sans-serif`;

  ctx.save();
  ctx.globalAlpha = inA;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (blur) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  const cx = W / 2;
  const cy = ln.cy + dy;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Fit to the safe width.
  const safe = W * 0.9;
  let w = ctx.measureText(text).width;
  if (w > safe) {
    const f = safe / w;
    ctx.font = `${ln.weight ?? 900} ${Math.round(ln.px * f)}px ${brand?.heading || 'Archivo Black'}, Impact, sans-serif`;
  }

  // Big words carry a heavy shadow for separation from the shot.
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = ln.px * 0.14;
  ctx.shadowOffsetY = ln.px * 0.05;
  ctx.lineJoin = 'round';
  ctx.lineWidth = ln.px * 0.055;
  ctx.strokeStyle = 'rgba(0,0,0,.5)';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = ln.accent ? (accent || '#ffe600') : (ln.color || '#ffffff');
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function drawHero(ctx, W, H, clip, time, accent, brand, pass = 'all') {
  const local = time - clip.start;
  const remaining = clip.start + clip.duration - time;
  if (local < 0 || remaining < 0) return;

  const { lines } = heroLayout(clip, W, H);
  // Stagger: top line first.
  lines.forEach((ln, i) => { ln.delay = i * 0.08; });

  const outA = clamp(remaining / 0.25, 0, 1);
  ctx.save();
  ctx.globalAlpha = outA;
  for (const ln of lines) {
    const behind = !!ln.behind;
    if (pass === 'behind' && !behind) continue;
    if (pass === 'front' && behind) continue;
    drawLine(ctx, ln, W, local, clip.anim || 'pop', accent, brand);
  }
  ctx.restore();
}

export const heroHasBehind = (clip) => (clip.lines || []).some((l) => l.behind);

/**
 * Compose a hero block from a phrase and its key word. Pure — used by the
 * planner so hero text is deterministic.
 */
export function makeHero({
  phrase, keyword, start, duration = 1.6, y = 0.3,
  behindWord = null, anim = 'pop', accentKeyword = false, size = 1,
}) {
  const lines = [];
  const kw = (keyword || '').trim();
  const before = phrase && kw ? phrase.slice(0, phrase.toLowerCase().indexOf(kw.toLowerCase())).trim() : '';
  const after = phrase && kw ? phrase.slice((before + ' ' + kw).length).trim() : '';

  if (before) lines.push({ text: before, scale: 0.62, weight: 800, color: '#ffffff' });
  if (behindWord) lines.push({ text: behindWord, scale: 0.9, weight: 800, behind: true, color: '#ffffff' });
  lines.push({ text: kw || phrase, scale: 1.9, weight: 900, upper: true, accent: accentKeyword });
  if (after && !behindWord) lines.push({ text: after, scale: 0.62, weight: 800, color: '#ffffff' });

  return { kind: 'hero', lines, start, duration, y, anim, size };
}

/** A big-number hero: huge figure + small label. */
export function makeNumberHero({ value, label = '', start, duration = 1.8, y = 0.3, accent = true }) {
  const lines = [{ text: String(value), scale: 2.1, weight: 900, accent }];
  if (label) lines.push({ text: label, scale: 0.55, weight: 800, color: '#ffffff' });
  return { kind: 'hero', lines, start, duration, y, anim: 'pop', size: 1 };
}
