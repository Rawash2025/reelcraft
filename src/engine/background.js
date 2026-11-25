// Background replacement.
//
// All of these are the same trick: segment the speaker, then paint something
// else where the original background was. "Remove background" is just a solid
// colour or a blur of the shot itself; "change background" is an image, a
// gradient, or a matching designed backdrop. The masked-person composite that
// does the work lives in renderer.js — this module only produces the layer that
// goes *behind* them.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Designed backdrops that read as "shot in a studio" rather than "green
// screened onto clip art". Rendered procedurally so there are no assets to ship.
export const DESIGN_BACKDROPS = {
  studio_olive: { name: 'Studio olive', kind: 'radial', colors: ['#3a4030', '#12140e'] },
  studio_dark: { name: 'Studio dark', kind: 'radial', colors: ['#26262f', '#08080b'] },
  warm_glow: { name: 'Warm glow', kind: 'radial', colors: ['#3a2a1a', '#100a06'] },
  cool_blue: { name: 'Cool blue', kind: 'radial', colors: ['#1a2a3a', '#06080a'] },
  purple_haze: { name: 'Purple haze', kind: 'radial', colors: ['#2a1a3a', '#0a0610'] },
  gradient_sunset: { name: 'Sunset', kind: 'linear', colors: ['#ff8a3d', '#ff3d68', '#7c5cff'] },
  gradient_mint: { name: 'Mint', kind: 'linear', colors: ['#39d98a', '#2bb8ff'] },
  spotlight: { name: 'Spotlight', kind: 'spotlight', colors: ['#2a2a30', '#000000'] },
  bokeh_gold: { name: 'Gold bokeh', kind: 'bokeh', colors: ['#1a140a', '#050403'], accent: '#ffcf6b' },
  bokeh_blue: { name: 'Blue bokeh', kind: 'bokeh', colors: ['#0a1420', '#030507'], accent: '#5bc8ff' },
};

export const BACKDROP_IDS = Object.keys(DESIGN_BACKDROPS);

// Bokeh circles are placed by a fixed pseudo-random pattern so the background is
// identical every render — determinism the export depends on.
function seeded(n) {
  let s = n * 2654435761 % 2 ** 32;
  return () => { s = (s * 1103515245 + 12345) % 2 ** 31; return s / 2 ** 31; };
}

/**
 * Paint the chosen background into ctx, filling the whole frame.
 *
 * @param mode   'color' | 'blur' | 'image' | 'design'
 * @param opts   { color, blur, image (HTMLImageElement/Video), backdrop, sourceEl, sourceRect, time }
 */
export function drawBackground(ctx, W, H, mode, opts = {}) {
  switch (mode) {
    case 'color':
      ctx.fillStyle = opts.color || '#0b0b0f';
      ctx.fillRect(0, 0, W, H);
      return;

    case 'blur': {
      // Blur the shot itself, scaled up so no edges show. Reads as a natural
      // shallow-depth-of-field background behind the cut-out speaker.
      const el = opts.sourceEl;
      if (!el) { ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, W, H); return; }
      const sw = el.videoWidth || el.naturalWidth || W;
      const sh = el.videoHeight || el.naturalHeight || H;
      const scale = Math.max(W / sw, H / sh) * 1.25;
      const dw = sw * scale, dh = sh * scale;
      ctx.save();
      ctx.filter = `blur(${Math.round((opts.blur ?? 0.5) * 34)}px) brightness(0.7)`;
      try { ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch { /* not ready */ }
      ctx.restore();
      // A slight dark wash so the speaker separates from their blurred self.
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    case 'image': {
      const img = opts.image;
      if (!img) { ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, W, H); return; }
      const sw = img.videoWidth || img.naturalWidth || W;
      const sh = img.videoHeight || img.naturalHeight || H;
      const scale = Math.max(W / sw, H / sh);
      const dw = sw * scale, dh = sh * scale;
      try { ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch { /* not ready */ }
      return;
    }

    case 'design':
    default:
      drawDesignBackdrop(ctx, W, H, opts.backdrop || 'studio_dark', opts.time || 0, opts.accent);
      return;
  }
}

function drawDesignBackdrop(ctx, W, H, id, time, accent) {
  const bd = DESIGN_BACKDROPS[id] || DESIGN_BACKDROPS.studio_dark;
  const [c0, c1, c2] = bd.colors;

  if (bd.kind === 'radial' || bd.kind === 'spotlight') {
    const cx = W / 2;
    const cy = bd.kind === 'spotlight' ? H * 0.4 : H * 0.42;
    const r = Math.hypot(W, H) * (bd.kind === 'spotlight' ? 0.42 : 0.7);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (bd.kind === 'linear') {
    const g = ctx.createLinearGradient(0, 0, W, H);
    bd.colors.forEach((c, i) => g.addColorStop(i / (bd.colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }

  if (bd.kind === 'bokeh') {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rand = seeded(42);
    ctx.save();
    for (let i = 0; i < 22; i++) {
      const x = rand() * W;
      // Slow vertical drift so the bokeh feels alive without being distracting.
      const y = (rand() * H + time * (6 + rand() * 14)) % (H + 120) - 60;
      const rr = 12 + rand() * 60;
      ctx.globalAlpha = 0.05 + rand() * 0.14;
      ctx.fillStyle = bd.accent || accent || '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
}
