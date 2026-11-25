import { drawFrame, clipAt } from './renderer.js';

const pickMime = () => {
  const want = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return want.find((m) => MediaRecorder.isTypeSupported(m)) || '';
};

// Routes every source element's audio into one stream we can record, while
// still letting the user hear the preview.
export class AudioMixer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.dest = this.ctx.createMediaStreamDestination();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.master.connect(this.dest);
    this.nodes = new Map();
  }
  register(el) {
    if (this.nodes.has(el) || !el.play) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.master);
      this.nodes.set(el, src);
    } catch { /* already wired */ }
  }
  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  get stream() {
    return this.dest.stream;
  }
}

/**
 * Real-time capture export: plays the timeline through once while a
 * MediaRecorder captures the same canvas the preview draws to, so the file
 * matches what you saw. Returns a Blob.
 */
export async function exportVideo({
  state,
  pool,
  mixer,
  fps = 30,
  scale = 1,
  onProgress,
  signal,
}) {
  const W = Math.round(state.project.width * scale);
  const H = Math.round(state.project.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  const renderState = {
    ...state,
    project: { ...state.project, width: W, height: H },
  };

  const stream = canvas.captureStream(fps);
  if (mixer) mixer.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const mime = pickMime();
  const rec = new MediaRecorder(stream, {
    mimeType: mime || undefined,
    videoBitsPerSecond: Math.round(W * H * fps * 0.12),
    audioBitsPerSecond: 192000,
  });

  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => (rec.onstop = res));

  const duration = state.duration;
  const started = performance.now();
  let raf = 0;
  let cancelled = false;
  signal?.addEventListener('abort', () => {
    cancelled = true;
  });

  // Prime every source onto its first frame before recording starts.
  seekAll(renderState, pool, 0);
  await waitFrames(3);

  rec.start(250);
  mixer?.resume();

  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      if (cancelled || t >= duration) return resolve();
      seekAll(renderState, pool, t, true);
      drawFrame(ctx, t, renderState, pool.map);
      onProgress?.(Math.min(1, t / duration));
      raf = requestAnimationFrame(tick);
    };
    tick();
  });

  cancelAnimationFrame(raf);
  pool.pauseAll();
  rec.stop();
  await done;
  onProgress?.(1);

  if (cancelled) return null;
  return new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
}

function seekAll(state, pool, time, playing) {
  for (const track of state.tracks) {
    if (track.kind === 'overlay') continue;
    // Mix every audio clip active now (dialogue + SFX bed + music bed), not
    // just the first — matching the preview mixer.
    const clips = track.kind === 'video'
      ? [clipAt(track, time)].filter(Boolean)
      : track.clips.filter((c) => time >= c.start && time < c.start + c.duration);
    for (const clip of clips) {
      const asset = state.assets.find((a) => a.id === clip.assetId);
      if (!asset || asset.type === 'image') continue;
      const el = pool.get(clip.assetId);
      if (!el) continue;
      const target = (clip.in || 0) + (time - clip.start) * (clip.speed || 1);
      if (!playing || Math.abs(el.currentTime - target) > 0.3) {
        try { el.currentTime = target; } catch { /* noop */ }
      }
      el.playbackRate = clip.speed || 1;
      el.muted = false;
      let vol = (clip.volume ?? 1) * (track.volume ?? 1);
      if (clip.bed === 'music' && state._ducking != null) vol *= state._ducking;
      el.volume = track.muted ? 0 : Math.max(0, Math.min(1, vol));
      if (playing && el.paused) el.play().catch(() => {});
    }
  }
}

const waitFrames = (n) =>
  new Promise((res) => {
    let i = 0;
    const step = () => (++i >= n ? res() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
