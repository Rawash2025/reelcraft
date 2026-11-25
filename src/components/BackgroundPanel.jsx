import { useState, useRef } from 'react';
import { useEditor } from '../store/editorStore.js';
import { DESIGN_BACKDROPS, BACKDROP_IDS } from '../engine/background.js';
import { initSegmenter, segmentationFailed } from '../engine/segment.js';
import { probeFile } from '../engine/media.js';
import { Slider } from './CaptionPanel.jsx';
import { IcSpark } from './Icons.jsx';

const MODES = [
  { id: 'none', name: 'Off', hint: 'Original background' },
  { id: 'blur', name: 'Blur', hint: 'Blur the real background' },
  { id: 'color', name: 'Colour', hint: 'Solid colour' },
  { id: 'design', name: 'Backdrop', hint: 'Designed studio backdrop' },
  { id: 'image', name: 'Image', hint: 'Your own photo/video' },
];

export default function BackgroundPanel() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const { setBackgroundMode, setBackground, notify } = useEditor.getState();
  const [busy, setBusy] = useState(false);
  const [warned, setWarned] = useState(false);
  const fileRef = useRef(null);

  const mode = project.background_mode || 'none';

  const choose = async (m) => {
    if (m !== 'none' && !segmentationFailed()) {
      // Warm the segmenter so the first frame after switching is already cut.
      setBusy(true);
      try { await initSegmenter(); } catch { setWarned(true); }
      setBusy(false);
    }
    setBackgroundMode(m);
    // Nudge a repaint by re-seeking, so the effect shows immediately.
    const st = useEditor.getState();
    st.setTime(st.time);
  };

  const importBg = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const asset = await probeFile(file);
      useEditor.getState().addAssets([asset]);
      setBackground({ background_asset: asset.id, background_mode: 'image' });
      const st = useEditor.getState();
      if (!segmentationFailed()) await initSegmenter();
      st.setTime(st.time);
    } catch (e) { notify(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const bgImages = assets.filter((a) => a.type === 'image' || a.type === 'video');

  return (
    <div className="stack">
      <div className="hint">
        Cuts the speaker out of the shot and replaces what's behind them. Uses
        on-device segmentation — no upload, no key. Works best with one clear
        person facing the camera.
      </div>

      <div>
        <span className="label">Background</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`btn sm${mode === m.id ? ' primary' : ''}`}
              style={{ flexDirection: 'column', gap: 2, padding: '8px 4px', height: 'auto' }}
              disabled={busy}
              onClick={() => m.id === 'image' ? fileRef.current.click() : choose(m.id)}
              title={m.hint}
            >
              {m.name}
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden
          onChange={(e) => { importBg(e.target.files[0]); e.target.value = ''; }} />
        {busy && <div className="bar" style={{ marginTop: 8 }}><i style={{ width: '100%', opacity: .5 }} /></div>}
        {warned && (
          <div className="hint" style={{ marginTop: 6, color: 'var(--warn)' }}>
            Segmentation model could not load — background replacement is
            unavailable on this device/browser.
          </div>
        )}
      </div>

      {mode === 'blur' && (
        <Slider label={`Blur amount — ${Math.round((project.background_blur ?? 0.5) * 100)}%`}
          min={0.1} max={1} step={0.05} value={project.background_blur ?? 0.5}
          onChange={(v) => { setBackground({ background_blur: v }); poke(); }} />
      )}

      {mode === 'color' && (
        <div>
          <span className="label">Colour</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input type="color" value={project.background_color || '#12140e'}
              onChange={(e) => { setBackground({ background_color: e.target.value }); poke(); }} />
            {['#12140e', '#0b0b0f', '#5c6454', '#1a2a3a', '#2a1a3a', '#ffffff'].map((c) => (
              <button key={c} onClick={() => { setBackground({ background_color: c }); poke(); }}
                style={{ width: 26, height: 26, borderRadius: 6, background: c, border: '1px solid var(--line)' }} />
            ))}
          </div>
        </div>
      )}

      {mode === 'design' && (
        <div>
          <span className="label">Studio backdrop</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {BACKDROP_IDS.map((id) => {
              const bd = DESIGN_BACKDROPS[id];
              const preview = bd.kind === 'linear'
                ? `linear-gradient(135deg, ${bd.colors.join(',')})`
                : `radial-gradient(circle at 50% 40%, ${bd.colors[0]}, ${bd.colors[bd.colors.length - 1]})`;
              return (
                <button key={id}
                  className={`tpl${project.background_backdrop === id ? ' on' : ''}`}
                  onClick={() => { setBackground({ background_backdrop: id }); poke(); }}>
                  <div style={{ height: 48, background: preview }} />
                  <div className="tpl-meta"><b style={{ fontSize: 10.5 }}>{bd.name}</b></div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'image' && (
        <div>
          <span className="label">Background media</span>
          {!bgImages.length && <div className="empty">Import an image or video above.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
            {bgImages.map((a) => (
              <button key={a.id}
                onClick={() => { setBackground({ background_asset: a.id }); poke(); }}
                style={{
                  aspectRatio: '9/14', borderRadius: 8, overflow: 'hidden', padding: 0,
                  border: project.background_asset === a.id ? '2px solid var(--accent)' : '1px solid var(--line)',
                  background: a.thumb ? `center/cover url(${a.thumb})` : 'var(--panel-2)',
                }} />
            ))}
          </div>
        </div>
      )}

      {mode !== 'none' && (
        <div style={{ background: 'var(--panel-2)', padding: 11, borderRadius: 10 }}>
          <div className="hint">
            <b>Layering:</b> the background sits behind the speaker. To place a
            b-roll clip <i>behind</i> them too, select it on the B-roll track and
            pick "Behind speaker" — it renders between this background and the
            person. Everything else (captions, cards, icons) stays in front.
          </div>
        </div>
      )}
    </div>
  );
}

// Re-seek to force an immediate repaint after a live tweak.
function poke() {
  const st = useEditor.getState();
  st.setTime(st.time);
}
