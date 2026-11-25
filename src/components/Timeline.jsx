import { useRef, useState, useEffect } from 'react';
import { useEditor } from '../store/editorStore.js';
import { IcZoomIn, IcZoomOut, IcSplit, IcTrash, IcCopy, IcRipple, IcVolume, IcMute } from './Icons.jsx';

const LABEL_W = 108;
const MIN_DUR = 0.15;

export default function Timeline({ playback }) {
  const tracks = useEditor((s) => s.tracks);
  const assets = useEditor((s) => s.assets);
  const time = useEditor((s) => s.time);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const {
    setTime, setZoom, select, updateClip, commit, splitAt,
    removeSelected, duplicateSelected, rippleClose, duration,
  } = useEditor.getState();

  const scroll = useRef(null);
  const [drag, setDrag] = useState(null);
  const total = Math.max(duration(), 8);
  const width = total * zoom + 260;

  const xToTime = (clientX) => {
    const box = scroll.current.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + scroll.current.scrollLeft - LABEL_W) / zoom);
  };

  // Pointer-driven move / trim, committed once on release so undo is one step.
  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const t = xToTime(e.clientX);
      const { track, clip, mode, grabOffset } = drag;
      if (mode === 'move') {
        updateClip(track.id, clip.id, { start: Math.max(0, t - grabOffset) });
      } else if (mode === 'left') {
        const right = clip.start + clip.duration;
        const start = Math.min(Math.max(0, t), right - MIN_DUR);
        updateClip(track.id, clip.id, {
          start,
          duration: right - start,
          in: (clip.in || 0) + (start - clip.start) * (clip.speed || 1),
        });
      } else if (mode === 'right') {
        updateClip(track.id, clip.id, {
          duration: Math.max(MIN_DUR, t - clip.start),
        });
      }
    };
    const up = () => {
      const st = useEditor.getState();
      const tr = st.tracks.find((x) => x.id === drag.track.id);
      const c = tr?.clips.find((x) => x.id === drag.clip.id);
      if (c) commit((s) => ({ tracks: s.tracks }), drag.mode);
      setDrag(null);
      playback.seek(useEditor.getState().time);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrub = (e) => {
    if (e.target.closest('.clip')) return;
    const t = xToTime(e.clientX);
    setTime(t);
    playback.seek(t);
    const move = (ev) => {
      const tt = xToTime(ev.clientX);
      setTime(tt);
      playback.seek(tt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), {
      once: true,
    });
  };

  const step = zoom > 160 ? 0.5 : zoom > 70 ? 1 : zoom > 34 ? 2 : 5;
  const ticks = [];
  for (let t = 0; t <= total + step; t += step) ticks.push(t);

  return (
    <div className="timeline">
      <div className="tl-bar">
        <button className="btn sm" onClick={() => splitAt(useEditor.getState().time)}>
          <IcSplit size={13} /> Split
        </button>
        <button className="btn sm" disabled={!selection?.clipId} onClick={duplicateSelected}>
          <IcCopy size={13} /> Duplicate
        </button>
        <button className="btn sm" disabled={!selection?.clipId} onClick={removeSelected}>
          <IcTrash size={13} /> Delete
        </button>
        <button className="btn sm" onClick={rippleClose} title="Close all gaps">
          <IcRipple size={13} /> Close gaps
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn icon sm" onClick={() => setZoom(zoom / 1.35)}><IcZoomOut size={14} /></button>
        <span className="tc" style={{ width: 44, textAlign: 'center' }}>{Math.round(zoom)}px/s</span>
        <button className="btn icon sm" onClick={() => setZoom(zoom * 1.35)}><IcZoomIn size={14} /></button>
      </div>

      <div className="tl-scroll" ref={scroll} onPointerDown={scrub}>
        <div className="tl-inner" style={{ width }}>
          <div className="ruler" style={{ width }}>
            {ticks.map((t) => (
              <div key={t} className="ruler-tick" style={{ left: LABEL_W + t * zoom }}>
                {t % 1 === 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : ''}
              </div>
            ))}
          </div>

          {tracks.map((track) => (
            <div
              key={track.id}
              className={`track-row${track.kind === 'overlay' ? ' overlay' : ''}`}
            >
              <div className="track-label">
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {track.name}
                </span>
                {track.kind !== 'overlay' && (
                  <button
                    className="btn icon sm"
                    style={{ padding: 3 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      commit((s) => ({
                        tracks: s.tracks.map((t) =>
                          t.id === track.id ? { ...t, muted: !t.muted } : t
                        ),
                      }), 'mute');
                    }}
                  >
                    {track.muted ? <IcMute size={12} /> : <IcVolume size={12} />}
                  </button>
                )}
              </div>

              {track.clips.map((clip) => {
                const asset = assets.find((a) => a.id === clip.assetId);
                const sel = selection?.clipId === clip.id;
                return (
                  <div
                    key={clip.id}
                    className={`clip${sel ? ' sel' : ''}${track.kind === 'audio' ? ' audio' : ''}${clip.kind === 'text' ? ' text' : ''}`}
                    style={{
                      left: LABEL_W + clip.start * zoom,
                      width: Math.max(18, clip.duration * zoom),
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      select({ trackId: track.id, clipId: clip.id });
                      if (e.target.classList.contains('clip-handle')) return;
                      setDrag({
                        track, clip, mode: 'move',
                        grabOffset: xToTime(e.clientX) - clip.start,
                      });
                    }}
                  >
                    {asset?.thumb && (
                      <div className="clip-thumbs">
                        {Array.from({ length: Math.ceil((clip.duration * zoom) / 90) }).map((_, i) => (
                          <img key={i} src={asset.thumb} alt="" />
                        ))}
                      </div>
                    )}
                    <div className="clip-name">
                      {clip.kind === 'text' ? clip.text : clip.name}
                      {clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : ''}
                    </div>
                    <div
                      className="clip-handle l"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        select({ trackId: track.id, clipId: clip.id });
                        setDrag({ track, clip, mode: 'left' });
                      }}
                    />
                    <div
                      className="clip-handle r"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        select({ trackId: track.id, clipId: clip.id });
                        setDrag({ track, clip, mode: 'right' });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="playhead" style={{ left: LABEL_W + time * zoom }} />
        </div>
      </div>
    </div>
  );
}
