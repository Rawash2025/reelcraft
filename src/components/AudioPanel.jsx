import { useEditor } from '../store/editorStore.js';
import { Slider } from './CaptionPanel.jsx';
import { IcVolume, IcMute, IcPlus } from './Icons.jsx';

export default function AudioPanel() {
  const tracks = useEditor((s) => s.tracks);
  const assets = useEditor((s) => s.assets);
  const project = useEditor((s) => s.project);
  const { commit, addToTimeline, setProject, notify } = useEditor.getState();

  const setTrack = (id, patch) =>
    commit((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), 'audio');

  const music = assets.filter((a) => a.type === 'audio');

  return (
    <div className="stack">
      <div>
        <span className="label">Track mixer</span>
        <div className="stack" style={{ gap: 12 }}>
          {tracks
            .filter((t) => t.kind !== 'overlay')
            .map((t) => (
              <div key={t.id} style={{ background: 'var(--panel-2)', padding: 11, borderRadius: 10, border: '1px solid var(--line-soft)' }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <b style={{ fontSize: 12 }}>{t.name}</b>
                  <button
                    className="btn icon sm"
                    onClick={() => setTrack(t.id, { muted: !t.muted })}
                    title={t.muted ? 'Unmute' : 'Mute'}
                  >
                    {t.muted ? <IcMute size={14} /> : <IcVolume size={14} />}
                  </button>
                </div>
                <input
                  type="range" min={0} max={1.5} step={0.01}
                  value={t.volume}
                  onChange={(e) => setTrack(t.id, { volume: +e.target.value })}
                />
                <div className="hint" style={{ marginTop: 5 }}>
                  {Math.round(t.volume * 100)}% · {t.clips.length} clip{t.clips.length === 1 ? '' : 's'}
                </div>
              </div>
            ))}
        </div>
      </div>

      <div>
        <span className="label">Music in the bin</span>
        {!music.length && <div className="empty">Import an MP3 or WAV from the Media tab.</div>}
        <div style={{ display: 'grid', gap: 5 }}>
          {music.map((a) => (
            <div className="asset" key={a.id}>
              <div className="meta">
                <div>{a.name}</div>
                <div>{a.duration.toFixed(1)}s</div>
              </div>
              <button className="btn icon sm" onClick={() => { addToTimeline(a.id); notify('Added to music track'); }}>
                <IcPlus size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <label className="row" style={{ fontSize: 12, color: 'var(--dim)' }}>
        <input
          type="checkbox"
          checked={!!project.previewMuted}
          onChange={(e) => setProject({ previewMuted: e.target.checked })}
        />
        Mute preview monitoring (export is unaffected)
      </label>
    </div>
  );
}
