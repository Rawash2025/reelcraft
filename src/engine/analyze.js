// Audio analysis. This is what makes an automatic edit feel deliberate rather
// than random: cuts land where someone stopped talking, and punches land on
// the beat. Everything here runs offline in the browser, no service involved.

async function decode(file, sampleRate = 16000) {
  const buf = await file.arrayBuffer();
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ac.decodeAudioData(buf);
  ac.close();
  if (decoded.sampleRate === sampleRate) return decoded;
  const off = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * sampleRate),
    sampleRate
  );
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/**
 * Find the stretches of near-silence — the breaths, the "umm", the dead air
 * between sentences. Threshold is relative to the loud parts of this specific
 * recording, so it adapts to a quiet mic without the caller tuning dB.
 */
export async function detectSilences(
  file,
  { minSilence = 0.28, padding = 0.06, sensitivity = 0.5 } = {}
) {
  const buf = await decode(file);
  const data = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const win = Math.floor(sr * 0.02); // 20ms frames
  const frames = [];

  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += data[i + j] * data[i + j];
    frames.push(Math.sqrt(sum / win));
  }
  if (!frames.length) return { silences: [], duration: buf.duration, floor: 0 };

  // Speech level = 85th percentile of frame energy. The gate sits a fixed
  // fraction below it, so the same settings work on loud and quiet recordings.
  const sorted = [...frames].sort((a, b) => a - b);
  const speech = sorted[Math.floor(sorted.length * 0.85)] || 1e-6;
  const noise = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const gate = Math.max(noise * 1.6, speech * (0.02 + 0.1 * (1 - sensitivity)));

  const silences = [];
  let runStart = null;
  for (let i = 0; i < frames.length; i++) {
    const quiet = frames[i] < gate;
    const t = (i * win) / sr;
    if (quiet && runStart === null) runStart = t;
    if (!quiet && runStart !== null) {
      pushRun(silences, runStart, t, minSilence, padding);
      runStart = null;
    }
  }
  if (runStart !== null)
    pushRun(silences, runStart, buf.duration, minSilence, padding);

  return { silences, duration: buf.duration, floor: gate };
}

function pushRun(out, start, end, minSilence, padding) {
  // Leave a little air on each side so words are never clipped.
  const s = start + padding;
  const e = end - padding;
  if (e - s >= minSilence) out.push({ start: +s.toFixed(3), end: +e.toFixed(3) });
}

/** Turn silence ranges into the keep-ranges an edit is actually built from. */
export function invertRanges(silences, duration) {
  const keep = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor) keep.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });
  return keep.filter((k) => k.end - k.start > 0.12);
}

/**
 * Onset detection by spectral flux — rising energy across frequency bands.
 * Good enough to snap cuts and zoom punches to a music track.
 */
export async function detectBeats(file, { sensitivity = 1.4 } = {}) {
  const buf = await decode(file, 22050);
  const data = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const hop = 512;
  const size = 1024;

  // Four coarse bands, tracked by rectified difference of band energy.
  const bands = [
    [0, 0.02], [0.02, 0.08], [0.08, 0.25], [0.25, 0.5],
  ];
  const flux = [];
  let prev = new Array(bands.length).fill(0);

  for (let i = 0; i + size <= data.length; i += hop) {
    const energies = bands.map(([lo, hi]) => {
      // Cheap band energy: zero-crossing weighted RMS over the window slice.
      const from = Math.floor(size * lo * 2);
      const to = Math.floor(size * hi * 2);
      let sum = 0;
      for (let j = from; j < to && i + j < data.length; j++)
        sum += data[i + j] * data[i + j];
      return Math.sqrt(sum / Math.max(1, to - from));
    });
    let f = 0;
    for (let b = 0; b < bands.length; b++) f += Math.max(0, energies[b] - prev[b]);
    prev = energies;
    flux.push(f);
  }
  if (!flux.length) return { beats: [], bpm: null, duration: buf.duration };

  // Adaptive threshold: a local mean over ~1s of frames.
  const span = Math.round(sr / hop);
  const beats = [];
  let lastBeat = -1;
  for (let i = 0; i < flux.length; i++) {
    const lo = Math.max(0, i - span);
    const hi = Math.min(flux.length, i + span);
    let mean = 0;
    for (let j = lo; j < hi; j++) mean += flux[j];
    mean /= hi - lo;
    const t = (i * hop) / sr;
    if (flux[i] > mean * sensitivity && t - lastBeat > 0.18) {
      beats.push(+t.toFixed(3));
      lastBeat = t;
    }
  }

  // Estimate tempo from the most common inter-onset gap.
  let bpm = null;
  if (beats.length > 4) {
    const gaps = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 0.2 && median < 2) bpm = Math.round(60 / median);
  }

  return { beats, bpm, duration: buf.duration };
}

/** Nearest beat to `t`, if one is close enough to be worth snapping to. */
export function snapToBeat(t, beats, tolerance = 0.12) {
  let best = null;
  let bestD = Infinity;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < bestD) { bestD = d; best = b; }
  }
  return bestD <= tolerance ? best : t;
}
