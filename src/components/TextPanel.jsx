import { useEditor } from '../store/editorStore.js';
import { IcPlus } from './Icons.jsx';

const PRESETS = [
  { name: 'Hero title', y: 0.18, style: { font: 'Archivo Black', size: 0.085, color: '#fff', stroke: '#000', strokeWidth: 0.1, uppercase: true }, anim: 'slide' },
  { name: 'Lower third', y: 0.84, style: { font: 'Inter', weight: 700, size: 0.042, color: '#fff', bg: 'rgba(0,0,0,.6)', uppercase: false }, anim: 'fade' },
  { name: 'Accent badge', y: 0.1, style: { font: 'Montserrat', weight: 800, size: 0.038, color: '#0b0b0f', bg: '#ffe600', uppercase: true }, anim: 'pop' },
  { name: 'Big statement', y: 0.5, style: { font: 'Bebas Neue', size: 0.13, color: '#fff', stroke: '#000', strokeWidth: 0.06, uppercase: true }, anim: 'slide' },
  { name: 'Caption note', y: 0.9, style: { font: 'Inter', weight: 500, size: 0.03, color: '#c9c9d4', uppercase: false }, anim: 'fade' },
  { name: 'Outline pop', y: 0.3, style: { font: 'Anton', size: 0.1, color: 'transparent', stroke: '#fff', strokeWidth: 0.045, uppercase: true }, anim: 'pop' },
];

export default function TextPanel() {
  const time = useEditor((s) => s.time);
  const tracks = useEditor((s) => s.tracks);
  const { addTextClip, commit, select, notify } = useEditor.getState();
  const overlay = tracks.find((t) => t.kind === 'overlay');

  const addPreset = (p) => {
    addTextClip(time);
    const st = useEditor.getState();
    const track = st.tracks.find((t) => t.kind === 'overlay');
    const clip = track.clips[track.clips.length - 1];
    commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.id !== track.id
          ? t
          : {
              ...t,
              clips: t.clips.map((c) =>
                c.id !== clip.id
                  ? c
                  : { ...c, y: p.y, anim: p.anim, name: p.name, style: { ...c.style, ...p.style } }
              ),
            }
      ),
    }), 'text preset');
    select({ trackId: track.id, clipId: clip.id });
    notify(`${p.name} added — edit it on the right`);
  };

  return (
    <div className="stack">
      <div className="hint">
        Text sits on its own overlay track, so it survives trims to the footage below.
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {PRESETS.map((p) => (
          <button key={p.name} className="asset" style={{ cursor: 'pointer' }} onClick={() => addPreset(p)}>
            <div
              className="thumb"
              style={{
                fontFamily: p.style.font,
                fontWeight: p.style.weight ?? 900,
                fontSize: 12,
                color: p.style.color === 'transparent' ? '#fff' : p.style.color,
                background: p.style.bg || '#000',
                WebkitTextStroke: p.style.strokeWidth ? '0.6px #000' : 'none',
              }}
            >
              Aa
            </div>
            <div className="meta" style={{ textAlign: 'left' }}>
              <div>{p.name}</div>
              <div>{p.anim} in · {Math.round(p.y * 100)}% down</div>
            </div>
            <IcPlus size={14} />
          </button>
        ))}
      </div>

      {!!overlay?.clips.length && (
        <div>
          <span className="label">On the timeline</span>
          <div style={{ display: 'grid', gap: 5 }}>
            {overlay.clips.map((c) => (
              <button
                key={c.id}
                className="asset"
                style={{ cursor: 'pointer' }}
                onClick={() => select({ trackId: overlay.id, clipId: c.id })}
              >
                <div className="meta" style={{ textAlign: 'left' }}>
                  <div>{c.text}</div>
                  <div>{c.start.toFixed(1)}s → {(c.start + c.duration).toFixed(1)}s</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
