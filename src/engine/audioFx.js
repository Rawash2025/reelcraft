// Voice cleanup. A real chain, rendered offline: rumble filter, noise gate,
// de-esser, presence lift, compression, then normalise. This is the difference
// between phone audio and something that sounds produced.

export const VOICE_PRESETS = {
  podcast: {
    name: 'Podcast voice',
    highPass: 85, deEss: -4, presence: 3.5, air: 2,
    gate: 0.55, compress: { threshold: -22, ratio: 4, knee: 6, attack: 0.004, release: 0.16 },
    target: 0.89,
  },
  bright: {
    name: 'Bright & forward',
    highPass: 100, deEss: -3, presence: 5, air: 3.5,
    gate: 0.6, compress: { threshold: -20, ratio: 5, knee: 4, attack: 0.003, release: 0.12 },
    target: 0.92,
  },
  warm: {
    name: 'Warm',
    highPass: 70, deEss: -5, presence: 1.5, air: 0.5,
    gate: 0.45, compress: { threshold: -24, ratio: 3, knee: 8, attack: 0.006, release: 0.2 },
    target: 0.87,
  },
  clean: {
    name: 'Clean up only',
    highPass: 80, deEss: -2, presence: 0, air: 0,
    gate: 0.7, compress: { threshold: -26, ratio: 2.5, knee: 8, attack: 0.008, release: 0.25 },
    target: 0.85,
  },
};

/**
 * Run the chain over a media file and hand back a WAV blob plus what it did.
 * `strength` (0..1) scales the whole treatment so it can be dialled back.
 */
export async function enhanceVoice(file, { preset = 'podcast', strength = 1 } = {}) {
  const p = VOICE_PRESETS[preset] || VOICE_PRESETS.podcast;
  const k = Math.max(0, Math.min(1, strength));

  const raw = await file.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ac.decodeAudioData(raw);
  ac.close();

  const before = measure(decoded);

  const off = new OfflineAudioContext(
    Math.min(2, decoded.numberOfChannels),
    decoded.length,
    decoded.sampleRate
  );
  const src = off.createBufferSource();
  src.buffer = decoded;

  // Rumble / handling noise.
  const hp = off.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.highPass;
  hp.Q.value = 0.7;

  // Tame sibilance before the compressor gets hold of it.
  const deEss = off.createBiquadFilter();
  deEss.type = 'peaking';
  deEss.frequency.value = 7200;
  deEss.Q.value = 2.2;
  deEss.gain.value = p.deEss * k;

  // Intelligibility.
  const presence = off.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = p.presence * k;

  const air = off.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9500;
  air.gain.value = p.air * k;

  const comp = off.createDynamicsCompressor();
  comp.threshold.value = p.compress.threshold;
  comp.ratio.value = 1 + (p.compress.ratio - 1) * k;
  comp.knee.value = p.compress.knee;
  comp.attack.value = p.compress.attack;
  comp.release.value = p.compress.release;

  const makeup = off.createGain();
  makeup.gain.value = 1 + 0.35 * k;

  src.connect(hp);
  hp.connect(deEss);
  deEss.connect(presence);
  presence.connect(air);
  air.connect(comp);
  comp.connect(makeup);
  makeup.connect(off.destination);
  src.start();

  const rendered = await off.startRendering();

  // The gate and the normaliser work on samples — neither has a node.
  const gated = applyGate(rendered, p.gate * k);
  const peak = normalize(gated, p.target);
  const after = measure(gated);

  // Report signal-to-noise, not the absolute noise floor. Normalising adds
  // makeup gain to everything, so a raw floor reading goes *up* after a
  // successful clean-up and reads as though the tool made things worse.
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-6));
  const snrBefore = db(before.rms) - db(before.floor);
  const snrAfter = db(after.rms) - db(after.floor);

  return {
    blob: new Blob([encodeWav(gated)], { type: 'audio/wav' }),
    duration: gated.duration,
    report: {
      preset: p.name,
      signal_to_noise_before: +snrBefore.toFixed(1),
      signal_to_noise_after: +snrAfter.toFixed(1),
      snr_gain_db: +(snrAfter - snrBefore).toFixed(1),
      loudness_before: +db(before.rms).toFixed(1),
      loudness_after: +db(after.rms).toFixed(1),
      peak_after: +peak.toFixed(3),
      note: 'A gate can only clean the gaps between words; noise underneath speech is unchanged.',
    },
  };
}

// Downward expansion below the measured noise floor: quiet frames get pulled
// down, speech is untouched, and the transition is smoothed so it never chatters.
function applyGate(buffer, amount) {
  if (amount <= 0) return buffer;
  const sr = buffer.sampleRate;
  const win = Math.floor(sr * 0.01);
  const ch0 = buffer.getChannelData(0);

  const frames = [];
  for (let i = 0; i + win <= ch0.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += ch0[i + j] * ch0[i + j];
    frames.push(Math.sqrt(s / win));
  }
  if (!frames.length) return buffer;

  const sorted = [...frames].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.12)] || 0;
  const speech = sorted[Math.floor(sorted.length * 0.9)] || 1;
  const thresh = floor + (speech - floor) * 0.06;
  const depth = 1 - 0.85 * amount; // never fully silent — that sounds broken

  // Per-frame target gain, then a one-pole smoother so it opens fast, closes slow.
  const gains = frames.map((f) => (f < thresh ? depth : 1));
  let g = 1;
  const smoothed = gains.map((target) => {
    const coeff = target > g ? 0.45 : 0.06;
    g += (target - g) * coeff;
    return g;
  });

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let f = 0; f < smoothed.length; f++) {
      const from = f * win;
      const to = Math.min(from + win, d.length);
      const g0 = f ? smoothed[f - 1] : smoothed[0];
      const g1 = smoothed[f];
      for (let i = from; i < to; i++) {
        const t = (i - from) / win;
        d[i] *= g0 + (g1 - g0) * t;
      }
    }
  }
  return buffer;
}

function normalize(buffer, target) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak < 1e-5) return peak;
  const gain = target / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * gain));
  }
  return target;
}

function measure(buffer) {
  const d = buffer.getChannelData(0);
  const win = Math.floor(buffer.sampleRate * 0.02);
  const frames = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let s = 0;
    for (let j = 0; j < win; j++) s += d[i + j] * d[i + j];
    frames.push(Math.sqrt(s / win));
  }
  if (!frames.length) return { rms: 0, floor: 0 };
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    rms: sorted[Math.floor(sorted.length * 0.75)] || 0,
    floor: sorted[Math.floor(sorted.length * 0.1)] || 0,
  };
}

function encodeWav(buffer) {
  const chans = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new ArrayBuffer(44 + len * chans * 2);
  const view = new DataView(out);
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  const bytes = len * chans * 2;

  str(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, chans, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * chans * 2, true);
  view.setUint16(32, chans * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, bytes, true);

  const data = [];
  for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chans; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return out;
}
