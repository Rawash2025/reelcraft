import { clipAt, drawFrame } from './renderer.js';

// Keeps the source <video>/<audio> elements aligned with a single timeline
// clock, then paints each frame through the shared renderer.
export class Playback {
  constructor(pool) {
    this.pool = pool;
    this.raf = 0;
    this.playing = false;
    this.time = 0;
    this.clock = 0;
    this.getState = () => null;
    this.onTime = () => {};
    this.mixer = null;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
  }

  setMixer(mixer) {
    this.mixer = mixer;
  }

  seek(t) {
    this.time = Math.max(0, t);
    this.syncSources(true);
    this.paint();
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.clock = performance.now() / 1000 - this.time;
    this.mixer?.resume();
    this.loop();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pool.pauseAll();
  }

  loop = () => {
    if (!this.playing) return;
    this.time = performance.now() / 1000 - this.clock;
    const state = this.getState();
    if (state && this.time >= state.duration) {
      this.time = state.duration;
      this.pause();
      this.paint();
      this.onTime(this.time);
      return;
    }
    this.syncSources(false);
    this.paint();
    this.onTime(this.time);
    this.raf = requestAnimationFrame(this.loop);
  };

  // Every source that should be audible/visible at `time` gets its playhead
  // nudged onto the right frame; drift over ~0.25s triggers a hard seek.
  syncSources(hard) {
    const state = this.getState();
    if (!state) return;
    const active = new Set();

    for (const track of state.tracks) {
      if (track.kind === 'overlay') continue;

      // Play EVERY clip active at this time, not just the first. Dialogue, an
      // SFX bed and a music bed can overlap on the timeline; using clipAt (first
      // match) silently dropped all but one, which is why Auto Pilot SFX/music
      // never played. Video is the exception: only the topmost clip is visible,
      // so for the video track we keep a single active clip.
      const clips = track.kind === 'video'
        ? [clipAt(track, this.time)].filter(Boolean)
        : track.clips.filter((c) => this.time >= c.start && this.time < c.start + c.duration);

      for (const clip of clips) {
        const asset = state.assets.find((a) => a.id === clip.assetId);
        if (!asset || asset.type === 'image') continue;
        const el = this.pool.get(clip.assetId);
        if (!el) continue;
        active.add(clip.assetId);

        const speed = clip.speed || 1;
        const target = (clip.in || 0) + (this.time - clip.start) * speed;
        if (hard || Math.abs(el.currentTime - target) > 0.25) {
          try { el.currentTime = target; } catch { /* not seekable yet */ }
        }
        el.playbackRate = speed;
        // Live music ducking: a clip tagged bed:'music' drops under dialogue.
        let vol = (clip.volume ?? 1) * (track.volume ?? 1);
        if (clip.bed === 'music' && state._ducking != null) vol *= state._ducking;
        el.volume = track.muted ? 0 : Math.max(0, Math.min(1, vol));
        el.muted = !!track.muted || !!state.project.previewMuted;

        if (this.playing && el.paused) el.play().catch(() => {});
        if (!this.playing && !el.paused) el.pause();
      }
    }

    for (const [id, el] of Object.entries(this.pool.map)) {
      if (!active.has(id) && el.pause && !el.paused) el.pause();
    }
  }

  paint() {
    const state = this.getState();
    if (!state || !this.ctx) return;
    drawFrame(this.ctx, this.time, state, this.pool.map);
  }

  destroy() {
    this.pause();
  }
}
