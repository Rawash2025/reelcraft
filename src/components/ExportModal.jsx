import { useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { exportVideo, downloadBlob } from '../engine/exporter.js';
import { IcDownload, IcX, IcKey, IcSpark } from './Icons.jsx';
import { renderMovie, j2vKey, setJ2vKey } from '../engine/json2video.js';

const QUALITY = [
  { id: 'full', name: 'Full', scale: 1 },
  { id: 'half', name: 'Fast (720-ish)', scale: 0.667 },
  { id: 'draft', name: 'Draft', scale: 0.5 },
];

export default function ExportModal({ onClose, pool, mixer, playback }) {
  const state = useEditor();
  const [quality, setQuality] = useState('full');
  const [fps, setFps] = useState(state.project.fps);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('local');
  const [key, setKey] = useState(j2vKey());
  const [showKey, setShowKey] = useState(false);
  const [cloud, setCloud] = useState(null);
  const [status, setStatus] = useState('');

  const duration = state.duration();
  const scale = QUALITY.find((q) => q.id === quality).scale;
  const W = Math.round(state.project.width * scale);
  const H = Math.round(state.project.height * scale);

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    playback.pause();
    useEditor.getState().setPlaying(false);
    try {
      const blob = await exportVideo({
        state: { ...state, duration },
        pool,
        mixer,
        fps,
        scale,
        onProgress: setProgress,
      });
      if (blob) setResult(blob);
    } catch (e) {
      setError(e.message);
    } finally {
      setProgress(null);
      playback.seek(useEditor.getState().time);
    }
  };

  const runCloud = async () => {
    setError(null);
    setCloud(null);
    setProgress(0);
    setStatus('Preparing…');
    playback.pause();
    useEditor.getState().setPlaying(false);
    try {
      const out = await renderMovie({
        state: { ...state, duration },
        apiKey: key,
        onProgress: ({ label, value }) => {
          setStatus(label);
          setProgress(value == null ? null : value);
        },
      });
      setCloud(out);
      setStatus('');
    } catch (e) {
      setError(e.message);
      setStatus('');
    } finally {
      setProgress(null);
    }
  };

  const ext = result?.type.includes('mp4') ? 'mp4' : 'webm';

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal">
        <header className="spread">
          <span>Export video</span>
          <button className="btn ghost icon" onClick={onClose} disabled={progress !== null}>
            <IcX size={15} />
          </button>
        </header>

        <div className="content stack">
          <div>
            <span className="label">Render with</span>
            <div className="row">
              <button
                className={`btn sm${mode === 'local' ? ' primary' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setMode('local')}
              >
                This browser
              </button>
              <button
                className={`btn sm${mode === 'cloud' ? ' primary' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setMode('cloud')}
              >
                Cloud — JSON2Video
              </button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {mode === 'local'
                ? 'Captures the canvas in real time. Exact, free, but a 60s video takes 60s and the tab must stay in front.'
                : 'Uploads your media and renders server-side, faster than real time, and the tab can be closed. Costs render credits. Cuts, trims, b-roll, text and word-highlight captions all translate; camera moves (punch, parallax) and whip transitions do NOT — they are canvas effects with no equivalent. The card row is re-drawn as HTML, so close but not pixel-identical.'}
            </div>
          </div>

          {mode === 'cloud' && (
            <div>
              <div className="spread" style={{ marginBottom: 7 }}>
                <span className="label" style={{ margin: 0 }}>JSON2Video key</span>
                <button className="btn icon sm" onClick={() => setShowKey((v) => !v)}>
                  <IcKey size={13} />
                </button>
              </div>
              {showKey && (
                <input
                  className="field"
                  type="password"
                  placeholder="x-api-key from your JSON2Video dashboard"
                  value={key}
                  onChange={(e) => { setKey(e.target.value); setJ2vKey(e.target.value); }}
                />
              )}
              {status && <div className="hint" style={{ marginTop: 7 }}>{status}</div>}
              {cloud && (
                <div
                  className="spread"
                  style={{ marginTop: 9, background: 'var(--panel-2)', padding: 12, borderRadius: 10 }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--good)' }}>Rendered</div>
                    <div className="hint">
                      {cloud.duration ? `${Math.round(cloud.duration)}s · ` : ''}
                      {cloud.size ? `${(cloud.size / 1e6).toFixed(1)} MB` : ''}
                    </div>
                  </div>
                  <a className="btn primary" href={cloud.url} target="_blank" rel="noreferrer">
                    <IcDownload size={14} /> Open MP4
                  </a>
                </div>
              )}
            </div>
          )}

          <div>
            <span className="label">Quality</span>
            <div className="row">
              {QUALITY.map((q) => (
                <button
                  key={q.id}
                  className={`btn sm${quality === q.id ? ' primary' : ''}`}
                  onClick={() => setQuality(q.id)}
                >
                  {q.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Frame rate</span>
            <div className="row">
              {[24, 30, 60].map((f) => (
                <button key={f} className={`btn sm${fps === f ? ' primary' : ''}`} onClick={() => setFps(f)}>
                  {f} fps
                </button>
              ))}
            </div>
          </div>

          <div className="spread" style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{W} × {H}</div>
              <div className="hint">{duration.toFixed(1)}s · {fps} fps</div>
            </div>
            <span className="pill accent">{state.project.aspect}</span>
          </div>

          {progress !== null && (
            <div>
              <div className="bar"><i style={{ width: `${progress * 100}%` }} /></div>
              <div className="hint" style={{ marginTop: 7 }}>
                {mode === 'local'
                  ? `Rendering in real time — ${Math.round(progress * 100)}%. Keep this tab in front.`
                  : `${status} ${Math.round(progress * 100)}%`}
              </div>
            </div>
          )}
          {progress === null && status && mode === 'cloud' && (
            <div className="bar"><i style={{ width: '100%', opacity: .4 }} /></div>
          )}

          {error && <div className="hint" style={{ color: 'var(--bad)' }}>{error}</div>}

          {result && (
            <div className="spread" style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 10 }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--good)' }}>Render complete</div>
                <div className="hint">{(result.size / 1e6).toFixed(1)} MB · .{ext}</div>
              </div>
              <button
                className="btn primary"
                onClick={() => downloadBlob(result, `${state.project.name.replace(/\s+/g, '-')}.${ext}`)}
              >
                <IcDownload size={14} /> Save
              </button>
            </div>
          )}

          <div className="hint">
            The canvas is captured live with audio mixed in, so the file matches the preview
            exactly. Browsers that support MP4 recording get MP4; the rest get WebM, which
            every editor and most platforms accept.
          </div>
        </div>

        <footer>
          <button className="btn ghost" onClick={onClose} disabled={progress !== null}>Close</button>
          <button
            className="btn primary"
            onClick={mode === 'local' ? run : runCloud}
            disabled={progress !== null || !!status || !duration}
          >
            {mode === 'cloud' ? <IcSpark size={14} /> : null}
            {progress !== null || status
              ? 'Rendering…'
              : (mode === 'local' ? result : cloud) ? 'Render again' : 'Start render'}
          </button>
        </footer>
      </div>
    </div>
  );
}
