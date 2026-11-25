import { useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { planEDL } from '../director/plan.js';
import { critique } from '../director/critic.js';
import { compileEDL } from '../director/compile.js';
import { resolveIntensity, PRESETS, KNOBS, presetIds } from '../director/intensity.js';
import { brandIds, getBrand } from '../brand/brands.js';
import { pacing, CAMERA_KINDS, CAPTION_ANIMS } from '../director/edl.js';
import { transcribeLocal } from '../engine/transcribe.js';
import { decodeForASR } from '../engine/transcribe.js';
import { Slider } from './CaptionPanel.jsx';
import { IcSpark, IcUndo } from './Icons.jsx';

const KIND_ICON = {
  HOOK: '🎣', WARNING: '⚠️', PROBLEM: '❗', QUESTION: '❓', BENEFIT: '✨',
  NUMBER: '#️⃣', STATISTIC: '📊', COMPARISON: '⚖️', LIST: '📋', STEPS: '🪜',
  CTA: '👉', BRAND: '®️', EXPLANATION: '💬', EDUCATION: '🎓', PROOF: '🏆',
  OBJECTION: '🤔',
};

export default function DirectorPanel() {
  const assets = useEditor((s) => s.assets);
  const captions = useEditor((s) => s.captions);
  const edl = useEditor((s) => s.edl);
  const { notify, setEDL, updateSegment, undo } = useEditor.getState();

  const [preset, setPreset] = useState('BALANCED');
  const [brandId, setBrandId] = useState('none');
  const [knobs, setKnobs] = useState({});
  const [showKnobs, setShowKnobs] = useState(false);
  const [fetchBroll, setFetchBroll] = useState(false);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);

  const video = assets.filter((a) => a.type === 'video');
  const cfg = resolveIntensity(preset, knobs);

  const setKnob = (id, v) => setKnobs((k) => ({ ...k, [id]: v }));

  const generate = async () => {
    const main = video[0];
    if (!main) return notify('Import a video first', 'bad');
    setBusy('plan');
    setStatus('');
    try {
      // Get words: reuse existing captions if present, else transcribe locally.
      let words = captions.words;
      if (!words.length) {
        setStatus('Transcribing (local Whisper)…');
        words = await transcribeLocal(main.file, {
          model: 'Xenova/whisper-small',
          onProgress: (p) => {
            if (p.phase === 'download' && p.total) setStatus(`Model ${Math.round((p.loaded / p.total) * 100)}%`);
            else if (p.phase === 'transcribing') setStatus('Listening…');
          },
        });
        if (!words.length) throw new Error('No speech detected.');
      }

      setStatus('Planning the edit…');
      let audioChannel = null; let sampleRate = 0;
      try {
        audioChannel = await decodeForASR(main.file);
        sampleRate = 16000;
      } catch { /* energy falls back to neutral */ }

      let planned = planEDL({
        words,
        duration: main.duration || words[words.length - 1].end,
        intensity: preset,
        knobs,
        brandId,
        audioChannel,
        sampleRate,
      });

      setStatus('Critic pass…');
      const { edl: revised } = critique(planned, cfg);
      setEDL(revised);
      const p = pacing(revised);
      notify(`Plan ready — ${revised.segments.length} segments, ${p.events} events`, 'good');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
      setStatus('');
    }
  };

  const apply = async () => {
    if (!edl) return;
    setBusy('apply');
    try {
      const report = await compileEDL(edl, {
        assetId: video[0]?.id,
        fetchBroll,
        onStep: ({ label }) => setStatus(label),
      });
      notify(`Applied: ${report.motions} moves, ${report.captions} words, ${report.scenes || 0} premium scenes`, 'good');
      if (report.errors.length) console.warn('[director] compile notes', report.errors);
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
      setStatus('');
    }
  };

  const findings = edl?.meta?.critic?.findings || [];
  const pc = edl ? pacing(edl) : null;

  return (
    <div className="stack">
      <div>
        <span className="label">Editing intensity</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {presetIds().map((id) => (
            <button
              key={id}
              className={`style-chip${preset === id ? ' on' : ''}`}
              style={{ textAlign: 'left', padding: '9px 11px' }}
              onClick={() => setPreset(id)}
            >
              <b style={{ fontSize: 12 }}>{PRESETS[id].name}</b>
              <div className="hint" style={{ marginTop: 3, fontSize: 10.5 }}>{PRESETS[id].blurb}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Brand</span>
        <select className="field" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
          {brandIds().map((id) => <option key={id} value={id}>{getBrand(id).name}</option>)}
        </select>
      </div>

      <div>
        <button className="btn sm ghost" onClick={() => setShowKnobs((v) => !v)}>
          {showKnobs ? 'Hide' : 'Fine-tune'} the {KNOBS.length} controls
        </button>
        {showKnobs && (
          <div className="stack" style={{ gap: 9, marginTop: 8 }}>
            {KNOBS.map((k) => (
              <Slider
                key={k.id}
                label={`${k.name} — ${cfg.knobs[k.id]}`}
                min={0} max={100} step={1}
                value={cfg.knobs[k.id]}
                onChange={(v) => setKnob(k.id, v)}
              />
            ))}
          </div>
        )}
      </div>

      <button className="btn primary" style={{ justifyContent: 'center' }} disabled={!!busy} onClick={generate}>
        <IcSpark size={15} />
        {busy === 'plan' ? (status || 'Planning…') : edl ? 'Re-plan' : 'Analyze & plan the edit'}
      </button>
      {busy && status && <div className="bar"><i style={{ width: '100%', opacity: .5 }} /></div>}
      <div className="hint" style={{ marginTop: -6 }}>
        Classifies every sentence, scores where attention is needed, plans the
        cameras / captions / graphics / sound, then a critic pass fixes weak
        spots. Nothing touches the timeline until you press Apply.
      </div>

      {edl && (
        <>
          <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

          <div className="spread">
            <span className="label" style={{ margin: 0 }}>Edit Decision List</span>
            <span className="pill accent">{edl.segments.length} segments · {pc.events} events · {pc.perMinute}/min</span>
          </div>

          {!!findings.length && (
            <div className="stack" style={{ gap: 4 }}>
              {findings.map((f, i) => (
                <div key={i} className="hint" style={{
                  padding: '6px 9px', borderRadius: 8, background: 'var(--panel-2)',
                  borderLeft: `2px solid ${f.severity === 'high' ? 'var(--bad)' : f.severity === 'medium' ? 'var(--warn)' : 'var(--dimmer)'}`,
                }}>
                  {f.msg}
                </div>
              ))}
            </div>
          )}

          <div className="stack" style={{ gap: 5 }}>
            {edl.segments.map((seg) => (
              <div key={seg.id} style={{ borderRadius: 9, background: 'var(--panel-2)', border: '1px solid var(--line-soft)', overflow: 'hidden' }}>
                <button
                  className="spread"
                  style={{ width: '100%', padding: '8px 10px', background: 'transparent', textAlign: 'left' }}
                  onClick={() => setOpen(open === seg.id ? null : seg.id)}
                >
                  <span style={{ display: 'flex', gap: 7, alignItems: 'center', minWidth: 0 }}>
                    <span>{KIND_ICON[seg.kind] || '💬'}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {seg.text.slice(0, 34)}
                    </span>
                  </span>
                  <span className="pill" style={{ flexShrink: 0 }}>{seg.start.toFixed(1)}s</span>
                </button>

                {open === seg.id && (
                  <div className="stack" style={{ gap: 8, padding: '4px 10px 11px' }}>
                    <div className="hint" style={{ fontStyle: 'italic' }}>{seg.reason}</div>

                    <div>
                      <span className="label">Camera</span>
                      <select className="field" value={seg.camera?.type || 'STATIC_MEDIUM'}
                        onChange={(e) => updateSegment(seg.id, { camera: { ...seg.camera, type: e.target.value } })}>
                        {CAMERA_KINDS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <span className="label">Caption animation</span>
                      <select className="field" value={seg.caption?.animation || 'WORD_POP'}
                        onChange={(e) => updateSegment(seg.id, { caption: { ...seg.caption, animation: e.target.value } })}>
                        {CAPTION_ANIMS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div className="hint">
                      Importance {(seg.importance * 100).toFixed(0)}% · {seg.pace}
                      {seg.caption?.highlight_words?.length ? ` · emphasise: ${seg.caption.highlight_words.join(', ')}` : ''}
                      {seg.broll ? ` · b-roll: "${seg.broll.query}"` : ''}
                      {seg.graphics.length ? ` · graphic: ${seg.graphics.map((g) => g.type).join(', ')}` : ''}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <label className="row" style={{ fontSize: 12, color: 'var(--dim)' }}>
            <input type="checkbox" checked={fetchBroll} onChange={(e) => setFetchBroll(e.target.checked)} />
            Also fetch B-roll from Pexels (needs a key, slower)
          </label>

          <div className="row">
            <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!!busy} onClick={apply}>
              {busy === 'apply' ? (status || 'Applying…') : 'Apply to timeline'}
            </button>
            <button className="btn icon" title="Undo last apply" onClick={() => { undo(); notify('Reverted'); }}>
              <IcUndo size={14} />
            </button>
          </div>
          <div className="hint" style={{ marginTop: -6 }}>
            Applying is one undo step. Every decision above is editable first, and
            stays editable on the timeline after.
          </div>
        </>
      )}
    </div>
  );
}
