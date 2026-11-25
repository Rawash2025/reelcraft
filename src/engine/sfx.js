// Sound design, synthesised from scratch.
//
// Every sound here is generated from noise and oscillators at render time —
// nothing is sampled, so there is no library to license and no attribution to
// carry. The whole bed is rendered to one WAV and dropped on the music track,
// which means playback and export both pick it up with no special handling.

const SR = 44100;

function noiseBuffer(ctx, seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(SR * seconds), SR);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Air moving past the camera: band-passed noise swept across the cut. */
function whoosh(ctx, at, { duration = 0.42, peak = 0.22, up = true } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  const f0 = up ? 380 : 3200;
  const f1 = up ? 3200 : 380;
  band.frequency.setValueAtTime(f0, at);
  band.frequency.exponentialRampToValueAtTime(f1, at + duration);

  // Roll the top off so it reads as air rather than hiss.
  const tame = ctx.createBiquadFilter();
  tame.type = 'lowpass';
  tame.frequency.value = 5200;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + duration * 0.42);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  src.connect(band); band.connect(tame); tame.connect(g); g.connect(ctx.destination);
  src.start(at); src.stop(at + duration);
}

/** Weight under a hard beat: a pitch-dropping sine with a click on the front. */
function impact(ctx, at, { peak = 0.5 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(38, at + 0.28);

  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);

  osc.connect(g); g.connect(ctx.destination);
  osc.start(at); osc.stop(at + 0.5);

  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx, 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(peak * 0.4, at);
  cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  click.connect(hp); hp.connect(cg); cg.connect(ctx.destination);
  click.start(at); click.stop(at + 0.05);
}

/** Tension into the hook: noise climbing under a rising tone. */
function riser(ctx, at, duration = 1.1, peak = 0.16) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, duration);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(300, at);
  hp.frequency.exponentialRampToValueAtTime(4200, at + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + duration * 0.92);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(hp); hp.connect(g); g.connect(ctx.destination);
  src.start(at); src.stop(at + duration);
}

/**
 * Render the sound-design bed for a timeline.
 * `cuts` are timeline seconds where the picture changes.
 */
export async function renderSfxBed({
  duration, cuts = [], hookAt = null, intensity = 1,
}) {
  const len = Math.max(1, Math.ceil(Number.isFinite(duration) && duration > 0 ? duration : 1));
  const ctx = new OfflineAudioContext(1, SR * len, SR);
  const k = Math.max(0, Math.min(1.5, intensity));

  cuts.forEach((t, i) => {
    if (t < 0.05 || t > duration - 0.05) return;
    // Alternate the sweep direction so a run of cuts does not feel mechanical.
    whoosh(ctx, Math.max(0, t - 0.14), {
      duration: 0.4,
      peak: 0.2 * k,
      up: i % 2 === 0,
    });
  });

  if (hookAt != null && hookAt >= 0) {
    if (hookAt > 1.2) riser(ctx, hookAt - 1.1, 1.1, 0.15 * k);
    impact(ctx, hookAt, { peak: 0.45 * k });
  }

  const rendered = await ctx.startRendering();
  return { blob: new Blob([encodeWav(rendered)], { type: 'audio/wav' }), duration: len };
}

/**
 * A quiet original music bed — sub pulse, soft pad, light ticks. Deliberately
 * plain and low in the mix: it is there to remove silence, not to be noticed.
 * Swap in a real track on the Music track whenever you have one.
 */
export async function renderMusicBed({ duration, bpm = 90, key = 55, level = 0.16 }) {
  const len = Math.max(1, Math.ceil(Number.isFinite(duration) && duration > 0 ? duration : 1));
  const ctx = new OfflineAudioContext(1, SR * len, SR);
  const beat = 60 / bpm;

  const master = ctx.createGain();
  master.gain.value = level;
  master.connect(ctx.destination);

  // Sub pulse on the beat.
  for (let t = 0; t < duration; t += beat) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = key;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.7);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + beat);
  }

  // Two held tones a fifth apart, drifting in and out.
  for (const mult of [2, 3]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = key * mult;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    // Slow swell so the pad breathes instead of sitting flat.
    for (let t = 0; t < duration; t += 4) {
      g.gain.setValueAtTime(0.04, t);
      g.gain.linearRampToValueAtTime(0.1, t + 2);
      g.gain.linearRampToValueAtTime(0.04, t + 4);
    }
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(0); o.stop(duration);
  }

  // Off-beat ticks for movement.
  for (let t = beat / 2; t < duration; t += beat) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(hp); hp.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.03);
  }

  const rendered = await ctx.startRendering();
  return { blob: new Blob([encodeWav(rendered)], { type: 'audio/wav' }), duration: len };
}

function encodeWav(buffer) {
  const d = buffer.getChannelData(0);
  const out = new ArrayBuffer(44 + d.length * 2);
  const v = new DataView(out);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, d.length * 2, true);
  let o = 44;
  for (let i = 0; i < d.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}
