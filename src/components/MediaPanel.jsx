import { useRef, useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { ingestFiles } from '../engine/ingest.js';
import { IcPlus, IcAudio, IcMedia } from './Icons.jsx';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function MediaPanel() {
  const assets = useEditor((s) => s.assets);
  const { addToTimeline } = useEditor.getState();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const ingest = async (files) => {
    setBusy(true);
    try {
      await ingestFiles(files);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div
        className={`drop${over ? ' over' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); ingest(e.dataTransfer.files); }}
      >
        <IcMedia size={22} />
        <div style={{ fontWeight: 600, marginTop: 8, color: 'var(--text)' }}>
          {busy ? 'Reading files…' : 'Drop media here'}
        </div>
        <div className="hint" style={{ marginTop: 4 }}>MP4, MOV, WebM · MP3, WAV · PNG, JPG</div>
        <input
          ref={input}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          hidden
          onChange={(e) => { ingest(e.target.files); e.target.value = ''; }}
        />
      </div>

      <div>
        <div className="spread" style={{ marginBottom: 9 }}>
          <span className="label" style={{ margin: 0 }}>Media bin</span>
          <span className="pill">{assets.length}</span>
        </div>
        {!assets.length && <div className="empty">Nothing imported yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {assets.map((a) => (
            <div className="asset" key={a.id}>
              {a.thumb ? (
                <img className="thumb" src={a.thumb} alt="" />
              ) : (
                <div className="thumb"><IcAudio size={16} /></div>
              )}
              <div className="meta">
                <div>{a.name}</div>
                <div>
                  {a.type} · {fmt(a.duration || 0)}
                  {a.width ? ` · ${a.width}×${a.height}` : ''}
                </div>
              </div>
              <button
                className="btn icon sm"
                title="Add to timeline"
                onClick={() => addToTimeline(a.id)}
              >
                <IcPlus size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
