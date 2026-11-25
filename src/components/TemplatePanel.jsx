import { useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { TEMPLATES, ASPECTS } from '../engine/templates.js';
import { FILTERS } from '../engine/filters.js';
import { PREMIUM_SCENES } from '../engine/premiumScenes.js';
import { brandIds, getBrand } from '../brand/brands.js';
import { initSegmenter } from '../engine/segment.js';

const CATS = ['All', ...new Set(TEMPLATES.map((t) => t.category))];

export default function TemplatePanel() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const { applyTemplate, setAspect, setBrand, addPremiumScene, notify } = useEditor.getState();
  const [cat, setCat] = useState('All');
  const [sceneCat, setSceneCat] = useState('All');
  const list = cat === 'All' ? TEMPLATES : TEMPLATES.filter((t) => t.category === cat);
  const sceneCats = ['All', ...new Set(PREMIUM_SCENES.map((s) => s.category))];
  const scenes = sceneCat === 'All' ? PREMIUM_SCENES : PREMIUM_SCENES.filter((s) => s.category === sceneCat);

  return (
    <div className="stack">
      <div>
        <span className="label">Brand system</span>
        <select className="field" value={project.brand || 'none'} onChange={(e) => setBrand(e.target.value)}>
          {brandIds().map((id) => <option key={id} value={id}>{getBrand(id).name}</option>)}
        </select>
        <div className="hint" style={{ marginTop: 6 }}>
          Brand colours, type and CTA flow through every premium scene.
        </div>
      </div>

      <div>
        <span className="label">Canvas size</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {Object.entries(ASPECTS).map(([k, v]) => (
            <button
              key={k}
              className={`btn sm${project.aspect === k ? ' primary' : ''}`}
              style={{ justifyContent: 'center' }}
              onClick={() => setAspect(k)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 5 }}>
          {CATS.map((c) => (
            <button
              key={c}
              className={`btn sm${cat === c ? ' primary' : ' ghost'}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="tpl-grid">
          {list.map((t) => (
            <button
              key={t.id}
              className={`tpl${project.templateId === t.id ? ' on' : ''}`}
              onClick={() => applyTemplate(t.id)}
              title={t.blurb}
            >
              <div
                className="tpl-art"
                style={{
                  background: `linear-gradient(150deg, ${t.swatch[2]}, ${t.swatch[2]} 55%, ${t.accent}33)`,
                }}
              >
                <span
                  style={{
                    color: t.swatch[1],
                    background: t.captionStyle === 'boxed' ? t.accent : 'transparent',
                    WebkitTextStroke:
                      t.captionStyle === 'impact' || t.captionStyle === 'bold-pop'
                        ? '0.8px #000'
                        : 'none',
                    fontFamily: t.titleFont,
                    textShadow: t.captionStyle === 'neon' ? `0 0 10px ${t.accent}` : 'none',
                  }}
                >
                  {t.aspect === '16:9' ? 'SUBTITLES' : 'CAPTION'}
                </span>
                <i
                  style={{
                    position: 'absolute', inset: 'auto 8px 6px 8px', height: 3,
                    borderRadius: 3, background: t.accent, opacity: .8,
                  }}
                />
              </div>
              <div className="tpl-meta">
                <b>{t.name}</b>
                <small>{t.aspect} · {FILTERS.find((f) => f.id === t.filter)?.name}</small>
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="label" style={{ margin: 0 }}>Premium scene library</span>
          <span className="pill accent">15 scenes</span>
        </div>
        <div className="hint" style={{ marginBottom: 9 }}>
          Adds a complete, editable composition at {time.toFixed(1)}s.
        </div>
        <div className="row" style={{ marginBottom: 9, flexWrap: 'wrap', gap: 4 }}>
          {sceneCats.map((c) => (
            <button key={c} className={`btn sm${sceneCat === c ? ' primary' : ' ghost'}`}
              onClick={() => setSceneCat(c)}>{c}</button>
          ))}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {scenes.map((scene) => (
            <button key={scene.id} className="style-chip"
              style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 8, alignItems: 'center', textAlign: 'left', padding: '9px' }}
              title={scene.blurb}
              onClick={async () => {
                if ((project.brand || 'none') === 'none') setBrand('olive');
                if (scene.depth) {
                  try { await initSegmenter(); } catch { /* scene gracefully flattens */ }
                }
                addPremiumScene(scene.id, { start: time });
                notify(`${scene.name} added at ${time.toFixed(1)}s`, 'good');
              }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${project.accent}22`, color: project.accent, fontWeight: 900 }}>{scene.icon}</span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block', fontSize: 12 }}>{scene.name}</b>
                <span className="hint" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scene.blurb}</span>
              </span>
              <span className="pill">+ Add</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
