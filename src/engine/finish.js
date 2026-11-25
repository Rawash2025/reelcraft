// The finishing pass — vignette, film grain, bloom and letterbox.
//
// These are the cheapest possible upgrades to perceived production value: a
// frame with a slight vignette and a whisper of grain reads as "shot and
// graded" rather than "screen recording", and both cost almost nothing.

let grainTiles = null;
const TILE = 256;

// A handful of pre-rendered noise tiles, cycled per frame. Generating noise on
// every frame would be far too slow at 1080x1920.
function tiles() {
  if (grainTiles) return grainTiles;
  grainTiles = [];
  for (let n = 0; n < 4; n++) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(TILE, TILE);
    for (let i = 0; i < img.data.length; i += 4) {
      // Centred on mid-grey so `overlay` compositing adds texture without
      // shifting exposure.
      const v = 128 + (Math.random() - 0.5) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    grainTiles.push(c);
  }
  return grainTiles;
}

export const FINISH_PRESETS = {
  none: { name: 'None', vignette: 0, grain: 0, bloom: 0, letterbox: 0 },
  subtle: { name: 'Subtle', vignette: 0.28, grain: 0.045, bloom: 0.06, letterbox: 0 },
  cinematic: { name: 'Cinematic', vignette: 0.45, grain: 0.075, bloom: 0.1, letterbox: 0 },
  film: { name: 'Film', vignette: 0.38, grain: 0.13, bloom: 0.05, letterbox: 0 },
  scope: { name: 'Widescreen', vignette: 0.4, grain: 0.06, bloom: 0.08, letterbox: 0.12 },
};

/**
 * Draw the finishing pass over a completed frame.
 * `frame` is the frame index, used only to cycle the grain tile.
 */
export function drawFinish(ctx, W, H, finish, frame, accent) {
  if (!finish) return;
  const f = typeof finish === 'string' ? FINISH_PRESETS[finish] : finish;
  if (!f || (!f.vignette && !f.grain && !f.letterbox && !f.bloom)) return;

  // Bloom: a soft accent-tinted lift in the centre, very low opacity.
  if (f.bloom > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = f.bloom;
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, W * 0.75);
    g.addColorStop(0, accent || '#ffffff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (f.grain > 0) {
    const list = tiles();
    const tile = list[frame % list.length];
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = f.grain;
    // Offset each frame so the grain does not visibly repeat in place.
    const ox = (frame * 37) % TILE;
    const oy = (frame * 61) % TILE;
    for (let y = -oy; y < H; y += TILE)
      for (let x = -ox; x < W; x += TILE) ctx.drawImage(tile, x, y);
    ctx.restore();
  }

  if (f.vignette > 0) {
    ctx.save();
    const r = Math.hypot(W, H) * 0.62;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${f.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (f.letterbox > 0) {
    const bar = H * f.letterbox;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    ctx.restore();
  }
}
