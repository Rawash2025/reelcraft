import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editorStore.js';
import { IcPlay, IcPause, IcSplit, IcVolume } from './Icons.jsx';
import { setMaskListener } from '../engine/segment.js';

export const tc = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
};

export default function Preview({ playback }) {
  const shell = useRef(null);
  const canvas = useRef(null);
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const tracks = useEditor((s) => s.tracks);
  const captions = useEditor((s) => s.captions);
  const { setTime, setPlaying, splitAt, duration } = useEditor.getState();
  const total = Math.max(duration(), 0.1);

  useEffect(() => {
    if (canvas.current) playback.attach(canvas.current);
    // Repaint once the first person mask lands, so a parked frame corrects
    // itself instead of keeping the un-masked fallback.
    setMaskListener(() => {
      if (!useEditor.getState().playing) playback.paint();
    });
    return () => setMaskListener(null);
  }, [playback]);

  // Parked: any time change must re-seek the sources, not just repaint, or the
  // canvas keeps showing the frame the video element happens to be sitting on.
  useEffect(() => {
    if (!playing) playback.seek(time);
  }, [time, playing, playback]);

  // Style-only changes just need a repaint.
  useEffect(() => {
    if (!playing) playback.paint();
  }, [project, tracks, captions, playing, playback]);

  // Fit the canvas into the stage without overflowing.
  useEffect(() => {
    const fit = () => {
      const el = shell.current;
      if (!el || !el.parentElement) return;
      const box = el.parentElement.getBoundingClientRect();
      const pad = 44;
      const scale = Math.min(
        (box.width - pad) / project.width,
        (box.height - pad) / project.height
      );
      el.style.width = `${Math.max(120, project.width * scale)}px`;
      el.style.height = `${Math.max(120, project.height * scale)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (shell.current?.parentElement) ro.observe(shell.current.parentElement);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const toggle = () => {
    if (playing) {
      playback.pause();
      setPlaying(false);
    } else {
      if (time >= total - 0.05) {
        playback.seek(0);
        setTime(0);
      }
      playback.play();
      setPlaying(true);
    }
  };

  return (
    <div className="stage">
      <div className="canvas-wrap">
        <div className="canvas-shell" ref={shell}>
          <canvas
            ref={canvas}
            className="preview"
            width={project.width}
            height={project.height}
            style={{ width: '100%', height: '100%' }}
            onClick={toggle}
          />
        </div>
      </div>

      <div className="transport">
        <button className="play-btn" onClick={toggle} title="Space">
          {playing ? <IcPause size={15} /> : <IcPlay size={15} />}
        </button>
        <span className="tc">
          <b>{tc(time)}</b> / {tc(total)}
        </span>
        <input
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={Math.min(time, total)}
          style={{ flex: 1 }}
          onChange={(e) => {
            const t = +e.target.value;
            setTime(t);
            playback.seek(t);
          }}
        />
        <button className="btn sm" onClick={() => splitAt(useEditor.getState().time)} title="S">
          <IcSplit size={14} /> Split
        </button>
        <span className="pill accent">
          {project.aspect} · {project.width}×{project.height}
        </span>
      </div>
    </div>
  );
}
