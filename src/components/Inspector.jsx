import { useShallow } from 'zustand/react/shallow';
import { useEditor, selectedClip } from '../store/editorStore.js';
import { FILTERS } from '../engine/filters.js';
import { Slider } from './CaptionPanel.jsx';
import { BROLL_PLACEMENTS, BROLL_ANIMS, FRAME_STYLES } from '../engine/layers.js';
import { initSegmenter } from '../engine/segment.js';
import { getPremiumScene } from '../engine/premiumScenes.js';

const FONTS = ['Inter', 'Archivo Black', 'Anton', 'Bebas Neue', 'Montserrat', 'Poppins'];

export default function Inspector() {
  // useShallow keeps the derived {track, clip} snapshot stable across renders.
  // Without it, returning a fresh object each render makes React 19's
  // useSyncExternalStore re-render forever and the whole app unmounts to black.
  const sel = useEditor(useShallow(selectedClip));
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const { updateClip, commitClip, setProject, commit } = useEditor.getState();

  if (!sel) {
    return (
      <div className="inspector">
        <div className="insp-head">Project</div>
        <div className="panel-body stack">
          <div>
            <span className="label">Background</span>
            <div className="row">
              <input
                type="color"
                value={project.background}
                onChange={(e) => setProject({ background: e.target.value })}
              />
              <span className="hint">Shows through letterboxed footage.</span>
            </div>
          </div>
          <div>
            <span className="label">Frame rate</span>
            <select
              className="field"
              value={project.fps}
              onChange={(e) => setProject({ fps: +e.target.value })}
            >
              {[24, 25, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </div>
          <div className="empty" style={{ paddingTop: 20 }}>
            Select a clip on the timeline to edit it.
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Shortcuts</span>
            {[['Space', 'Play / pause'], ['S', 'Split at playhead'], ['⌫', 'Delete clip'],
              ['⌘Z / ⇧⌘Z', 'Undo / redo'], ['← →', 'Nudge one frame'], ['⌘D', 'Duplicate']].map(
              ([k, v]) => (
                <div className="spread" key={k}>
                  <kbd>{k}</kbd>
                  <span className="hint">{v}</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  const { track, clip } = sel;
  const set = (patch) => updateClip(track.id, clip.id, patch);
  const done = (patch, label) => commitClip(track.id, clip.id, patch, label);

  if (clip.kind === 'premium-scene') {
    const def = getPremiumScene(clip.sceneType);
    const props = clip.props || {};
    const prop = (key, value) => set({ props: { ...props, [key]: value } });
    const finishProp = (key, value) => done({ props: { ...props, [key]: value } }, `scene ${key}`);
    const mediaAssets = assets.filter((a) => a.type === 'image' || a.type === 'video');
    const mediaSlots = clip.sceneType === 'floating-cards' ? 4 : def?.media ? 1 : 0;
    const listKey = clip.sceneType === 'process-steps' ? 'steps' : 'labels';
    const supportsList = ['floating-cards', 'logo-orbit', 'process-steps'].includes(clip.sceneType);

    return (
      <div className="inspector">
        <div className="insp-head">
          Premium Scene
          <span className="pill accent">{def?.name || clip.sceneType}</span>
        </div>
        <div className="panel-body stack">
          <div className="hint">{def?.blurb}</div>

          {Object.prototype.hasOwnProperty.call(props, 'eyebrow') && (
            <div>
              <span className="label">Eyebrow</span>
              <input className="field" value={props.eyebrow || ''}
                onChange={(e) => prop('eyebrow', e.target.value)}
                onBlur={(e) => finishProp('eyebrow', e.target.value)} />
            </div>
          )}
          {Object.prototype.hasOwnProperty.call(props, 'text') && (
            <div>
              <span className="label">Main copy</span>
              <textarea className="field" rows={3} value={props.text || ''}
                onChange={(e) => prop('text', e.target.value)}
                onBlur={(e) => finishProp('text', e.target.value)} />
            </div>
          )}
          {Object.prototype.hasOwnProperty.call(props, 'emphasis') && (
            <div>
              <span className="label">Emphasised words</span>
              <input className="field" value={props.emphasis || ''}
                onChange={(e) => prop('emphasis', e.target.value)}
                onBlur={(e) => finishProp('emphasis', e.target.value)} />
            </div>
          )}
          {Object.prototype.hasOwnProperty.call(props, 'value') && (
            <div>
              <span className="label">Number / value</span>
              <input className="field" value={props.value || ''}
                onChange={(e) => prop('value', e.target.value)}
                onBlur={(e) => finishProp('value', e.target.value)} />
            </div>
          )}

          {clip.sceneType === 'bank-comparison' && (
            <>
              <div className="row">
                <div style={{ flex: 1 }}><span className="label">Left label</span><input className="field" value={props.leftLabel || ''} onChange={(e) => prop('leftLabel', e.target.value)} /></div>
                <div style={{ flex: 1 }}><span className="label">Left value</span><input className="field" value={props.leftValue || ''} onChange={(e) => prop('leftValue', e.target.value)} /></div>
              </div>
              <div className="row">
                <div style={{ flex: 1 }}><span className="label">Right label</span><input className="field" value={props.rightLabel || ''} onChange={(e) => prop('rightLabel', e.target.value)} /></div>
                <div style={{ flex: 1 }}><span className="label">Right value</span><input className="field" value={props.rightValue || ''} onChange={(e) => prop('rightValue', e.target.value)} /></div>
              </div>
              <div><span className="label">Compliance footnote</span><input className="field" value={props.footnote || ''} onChange={(e) => prop('footnote', e.target.value)} /></div>
            </>
          )}

          {supportsList && (
            <div>
              <span className="label">{listKey === 'steps' ? 'Steps' : 'Labels'} — comma separated</span>
              <input className="field" value={(props[listKey] || []).join(', ')}
                onChange={(e) => prop(listKey, e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
                onBlur={(e) => finishProp(listKey, e.target.value.split(',').map((v) => v.trim()).filter(Boolean))} />
            </div>
          )}

          {clip.sceneType === 'testimonial' && (
            <>
              <div><span className="label">Client quote</span><textarea className="field" rows={4} value={props.quote || ''} onChange={(e) => prop('quote', e.target.value)} /></div>
              <div><span className="label">Client name</span><input className="field" value={props.author || ''} onChange={(e) => prop('author', e.target.value)} /></div>
            </>
          )}

          {clip.sceneType === 'premium-cta' && (
            <>
              <div><span className="label">Button</span><input className="field" value={props.cta || ''} onChange={(e) => prop('cta', e.target.value)} /></div>
              <div><span className="label">Website</span><input className="field" value={props.url || ''} onChange={(e) => prop('url', e.target.value)} /></div>
            </>
          )}

          {Array.from({ length: mediaSlots }).map((_, i) => (
            <div key={i}>
              <span className="label">Media {mediaSlots > 1 ? i + 1 : ''}</span>
              <select className="field" value={props.assetIds?.[i] || ''} onChange={(e) => {
                const ids = [...(props.assetIds || [])]; ids[i] = e.target.value || null; prop('assetIds', ids);
              }}>
                <option value="">Designed placeholder</option>
                {mediaAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          ))}

          <label className="row" style={{ fontSize: 12, color: 'var(--dim)' }}>
            <input type="checkbox" checked={clip.hideCaptions !== false}
              onChange={(e) => done({ hideCaptions: e.target.checked }, 'scene captions')} />
            Hide running captions during this scene
          </label>
          <div className="row">
            <div style={{ flex: 1 }}><span className="label">Start</span><input className="field" type="number" step={0.05} value={+clip.start.toFixed(2)} onChange={(e) => done({ start: Math.max(0, +e.target.value) }, 'scene start')} /></div>
            <div style={{ flex: 1 }}><span className="label">Length</span><input className="field" type="number" min={0.6} step={0.05} value={+clip.duration.toFixed(2)} onChange={(e) => done({ duration: Math.max(.6, +e.target.value) }, 'scene length')} /></div>
          </div>
        </div>
      </div>
    );
  }

  // B-roll gets its own panel: placement, framing, entrance, and whether it
  // sits behind the speaker.
  if (track.kind === 'broll') {
    const applyPlacement = async (key) => {
      const pl = BROLL_PLACEMENTS[key];
      if (pl.behind) {
        try { await initSegmenter(); } catch { /* falls back on draw */ }
      }
      done({
        placement: key, x: pl.x, y: pl.y, w: pl.w, h: pl.h,
        frame: pl.frame, behind: pl.behind, anim: pl.anim,
      }, 'placement');
    };

    return (
      <div className="inspector">
        <div className="insp-head">
          B-roll
          <span className="pill">{clip.duration.toFixed(2)}s</span>
        </div>
        <div className="panel-body stack">
          <div>
            <span className="label">Placement</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {Object.entries(BROLL_PLACEMENTS).map(([k, pl]) => (
                <button
                  key={k}
                  className={`btn sm${clip.placement === k ? ' primary' : ''}`}
                  style={{ justifyContent: 'center', padding: '6px 4px', fontSize: 11 }}
                  onClick={() => applyPlacement(k)}
                >
                  {pl.name}
                </button>
              ))}
            </div>
          </div>

          <label className="row" style={{ fontSize: 12, color: 'var(--dim)' }}>
            <input
              type="checkbox"
              checked={!!clip.behind}
              onChange={async (e) => {
                if (e.target.checked) {
                  try { await initSegmenter(); } catch { /* falls back on draw */ }
                }
                done({ behind: e.target.checked }, 'behind');
              }}
            />
            Behind the speaker
          </label>
          {clip.behind && (
            <div className="hint" style={{ marginTop: -8 }}>
              The first preview may take a moment while the subject mask loads.
              The original room remains underneath, so a missing mask never
              produces a black frame.
            </div>
          )}

          <Slider label={`X — ${Math.round((clip.x ?? 0.5) * 100)}%`}
            min={0} max={1} step={0.005} value={clip.x ?? 0.5}
            onChange={(v) => set({ x: v })} />
          <Slider label={`Y — ${Math.round((clip.y ?? 0.28) * 100)}%`}
            min={0} max={1} step={0.005} value={clip.y ?? 0.28}
            onChange={(v) => set({ y: v })} />
          <Slider label={`Width — ${Math.round((clip.w ?? 0.78) * 100)}%`}
            min={0.15} max={1} step={0.005} value={clip.w ?? 0.78}
            onChange={(v) => set({ w: v })} />
          <Slider label={`Height — ${Math.round((clip.h ?? 0.4) * 100)}%`}
            min={0.1} max={1} step={0.005} value={clip.h ?? 0.4}
            onChange={(v) => set({ h: v })} />
          <Slider label={`Zoom — ${Math.round((clip.zoom ?? 1.04) * 100)}%`}
            min={1} max={2.5} step={0.01} value={clip.zoom ?? 1.04}
            onChange={(v) => set({ zoom: v })} />

          <div>
            <span className="label">Frame</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {FRAME_STYLES.map((f) => (
                <button key={f} className={`btn sm${clip.frame === f ? ' primary' : ''}`}
                  onClick={() => done({ frame: f }, 'frame')}>{f}</button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Entrance</span>
            <select className="field" value={clip.anim || 'fade'}
              onChange={(e) => done({ anim: e.target.value }, 'anim')}>
              {BROLL_ANIMS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div>
            <span className="label">Label chip</span>
            <input className="field" placeholder="none"
              value={clip.label || ''}
              onChange={(e) => set({ label: e.target.value || null })}
              onBlur={(e) => done({ label: e.target.value || null }, 'label')} />
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <span className="label">Start</span>
              <input className="field" type="number" step={0.05} value={+clip.start.toFixed(2)}
                onChange={(e) => done({ start: Math.max(0, +e.target.value) }, 'start')} />
            </div>
            <div style={{ flex: 1 }}>
              <span className="label">Length</span>
              <input className="field" type="number" step={0.05} min={0.15}
                value={+clip.duration.toFixed(2)}
                onChange={(e) => done({ duration: Math.max(0.15, +e.target.value) }, 'length')} />
            </div>
        </div>
      </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="insp-head">
        {clip.kind === 'text' ? 'Text' : track.kind === 'audio' ? 'Audio clip' : 'Video clip'}
        <span className="pill">{clip.duration.toFixed(2)}s</span>
      </div>
      <div className="panel-body stack">
        {clip.kind === 'text' ? (
          <>
            <div>
              <span className="label">Content</span>
              <textarea
                className="field"
                rows={3}
                value={clip.text}
                onChange={(e) => set({ text: e.target.value })}
                onBlur={(e) => done({ text: e.target.value }, 'text')}
              />
            </div>
            <div>
              <span className="label">Font</span>
              <select
                className="field"
                value={clip.style.font}
                onChange={(e) => done({ style: { ...clip.style, font: e.target.value } }, 'font')}
              >
                {FONTS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <span className="label">Fill</span>
                <input
                  type="color"
                  value={clip.style.color === 'transparent' ? '#ffffff' : clip.style.color}
                  onChange={(e) => set({ style: { ...clip.style, color: e.target.value } })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <span className="label">Outline</span>
                <input
                  type="color"
                  value={clip.style.stroke || '#000000'}
                  onChange={(e) => set({ style: { ...clip.style, stroke: e.target.value } })}
                />
              </div>
            </div>
            <Slider
              label={`Size — ${Math.round(clip.style.size * 1000) / 10}%`}
              min={0.02} max={0.2} step={0.005} value={clip.style.size}
              onChange={(v) => set({ style: { ...clip.style, size: v } })}
            />
            <Slider
              label={`Outline weight — ${Math.round((clip.style.strokeWidth || 0) * 100)}`}
              min={0} max={0.2} step={0.005} value={clip.style.strokeWidth || 0}
              onChange={(v) => set({ style: { ...clip.style, strokeWidth: v } })}
            />
            <Slider label={`X — ${Math.round(clip.x * 100)}%`} min={0} max={1} step={0.01}
              value={clip.x} onChange={(v) => set({ x: v })} />
            <Slider label={`Y — ${Math.round(clip.y * 100)}%`} min={0} max={1} step={0.01}
              value={clip.y} onChange={(v) => set({ y: v })} />
            <div>
              <span className="label">Entrance</span>
              <select className="field" value={clip.anim} onChange={(e) => done({ anim: e.target.value }, 'anim')}>
                <option value="fade">Fade</option>
                <option value="slide">Slide up</option>
                <option value="pop">Pop</option>
                <option value="none">None</option>
              </select>
            </div>
            <label className="row" style={{ fontSize: 12, color: 'var(--dim)' }}>
              <input
                type="checkbox"
                checked={!!clip.style.uppercase}
                onChange={(e) => done({ style: { ...clip.style, uppercase: e.target.checked } }, 'case')}
              />
              Uppercase
            </label>
          </>
        ) : (
          <>
            {track.kind !== 'audio' && (
              <div>
                <span className="label">Look</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      className={`btn sm${clip.filter === f.id ? ' primary' : ''}`}
                      style={{ justifyContent: 'center', padding: '6px 4px', fontSize: 11 }}
                      onClick={() => done({ filter: f.id }, 'filter')}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Slider label={`Volume — ${Math.round((clip.volume ?? 1) * 100)}%`}
              min={0} max={1.5} step={0.01} value={clip.volume ?? 1}
              onChange={(v) => set({ volume: v })} />

            <div>
              <span className="label">Speed</span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    className={`btn sm${(clip.speed ?? 1) === s ? ' primary' : ''}`}
                    onClick={() =>
                      done(
                        { speed: s, duration: (clip.duration * (clip.speed ?? 1)) / s },
                        'speed'
                      )
                    }
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

            {track.kind !== 'audio' && (
              <>
                <div>
                  <span className="label">Framing</span>
                  <div className="row">
                    {['cover', 'contain'].map((f) => (
                      <button key={f} className={`btn sm${clip.fit === f ? ' primary' : ''}`}
                        onClick={() => done({ fit: f }, 'fit')}>
                        {f === 'cover' ? 'Fill frame' : 'Fit inside'}
                      </button>
                    ))}
                  </div>
                </div>
                <Slider label={`Zoom — ${Math.round((clip.transform?.scale ?? 1) * 100)}%`}
                  min={1} max={3} step={0.01} value={clip.transform?.scale ?? 1}
                  onChange={(v) => set({ transform: { ...clip.transform, scale: v } })} />
                <Slider label={`Pan X — ${Math.round((clip.transform?.x ?? 0) * 100)}`}
                  min={-0.5} max={0.5} step={0.005} value={clip.transform?.x ?? 0}
                  onChange={(v) => set({ transform: { ...clip.transform, x: v } })} />
                <Slider label={`Pan Y — ${Math.round((clip.transform?.y ?? 0) * 100)}`}
                  min={-0.5} max={0.5} step={0.005} value={clip.transform?.y ?? 0}
                  onChange={(v) => set({ transform: { ...clip.transform, y: v } })} />
                <Slider label={`Opacity — ${Math.round((clip.opacity ?? 1) * 100)}%`}
                  min={0} max={1} step={0.01} value={clip.opacity ?? 1}
                  onChange={(v) => set({ opacity: v })} />
              </>
            )}

            <div className="row">
              <div style={{ flex: 1 }}>
                <span className="label">Fade in</span>
                <input className="field" type="number" min={0} max={5} step={0.1}
                  value={clip.fadeIn ?? 0}
                  onChange={(e) => done({ fadeIn: +e.target.value }, 'fade')} />
              </div>
              <div style={{ flex: 1 }}>
                <span className="label">Fade out</span>
                <input className="field" type="number" min={0} max={5} step={0.1}
                  value={clip.fadeOut ?? 0}
                  onChange={(e) => done({ fadeOut: +e.target.value }, 'fade')} />
              </div>
            </div>
          </>
        )}

        <div className="row">
          <div style={{ flex: 1 }}>
            <span className="label">Start</span>
            <input className="field" type="number" step={0.05} value={+clip.start.toFixed(2)}
              onChange={(e) => done({ start: Math.max(0, +e.target.value) }, 'start')} />
          </div>
          <div style={{ flex: 1 }}>
            <span className="label">Length</span>
            <input className="field" type="number" step={0.05} min={0.15}
              value={+clip.duration.toFixed(2)}
              onChange={(e) => done({ duration: Math.max(0.15, +e.target.value) }, 'length')} />
          </div>
        </div>
      </div>
    </div>
  );
}
