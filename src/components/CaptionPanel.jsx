import { useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { CAPTION_STYLES } from '../engine/captionStyles.js';
import {
  transcribe, extractAudio, loadKeys, saveKeys, toSRT, toVTT,
  transcribeLocal, LOCAL_MODELS,
} from '../engine/transcribe.js';
import { downloadBlob } from '../engine/exporter.js';
import { IcSpark, IcKey, IcDownload } from './Icons.jsx';

export default function CaptionPanel() {
  const captions = useEditor((s) => s.captions);
  const assets = useEditor((s) => s.assets);
  const time = useEditor((s) => s.time);
  const { setCaptions, commitCaptions, setWords, wordsFromScript, notify, setTime, duration } =
    useEditor.getState();

  const [tab, setTab] = useState('auto');
  const [provider, setProvider] = useState('local');
  const [translate, setTranslate] = useState(false);
  const [localModel, setLocalModel] = useState('Xenova/whisper-small');
  const [status, setStatus] = useState('');
  const [keys, setKeys] = useState(loadKeys());
  const [showKey, setShowKey] = useState(false);
  const [lang, setLang] = useState('');
  const [script, setScript] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceId, setSourceId] = useState('');

  const speechAssets = assets.filter((a) => a.type !== 'image');
  const source = speechAssets.find((a) => a.id === sourceId) || speechAssets[0];

  const runAuto = async () => {
    if (!source) return notify('Import a video or audio file first', 'bad');

    // Local Whisper needs no key and no network beyond the one-time model fetch.
    if (provider === 'local') {
      setBusy(true);
      setStatus('Preparing…');
      try {
        const words = await transcribeLocal(source.file, {
          model: localModel,
          language: lang || undefined,
          translate,
          onProgress: (p) => {
            if (p.phase === 'download' && p.total)
              setStatus(`Downloading model ${Math.round((p.loaded / p.total) * 100)}%`);
            else if (p.phase === 'loading') setStatus('Loading model…');
            else if (p.phase === 'fallback') setStatus('WebGPU unavailable — using CPU…');
            else if (p.phase === 'transcribing') setStatus('Transcribing…');
          },
        });
        if (!words.length) throw new Error('No speech detected in that file');
        setWords(words);
      } catch (e) {
        notify(e.message.slice(0, 140), 'bad');
      } finally {
        setBusy(false);
        setStatus('');
      }
      return;
    }

    const key = keys[provider];
    const name = provider === 'groq' ? 'Groq' : provider === 'openai' ? 'OpenAI' : 'Deepgram';
    if (!key) {
      setShowKey(true);
      return notify(`Add your ${name} API key`, 'bad');
    }
    setBusy(true);
    try {
      notify('Extracting audio…');
      const blob = await extractAudio(source.file);
      notify(translate ? 'Transcribing + translating…' : 'Transcribing…');
      const words = await transcribe({ provider, blob, key, language: lang || undefined, translate });
      if (!words.length) throw new Error('No speech detected in that file');
      setWords(words);
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const runScript = () => {
    if (!script.trim()) return notify('Paste your script first', 'bad');
    wordsFromScript(script.trim(), 0, duration());
  };

  const exportSubs = (kind) => {
    if (!captions.words.length) return notify('No captions yet', 'bad');
    const text = kind === 'srt' ? toSRT(captions._chunks) : toVTT(captions._chunks);
    downloadBlob(new Blob([text], { type: 'text/plain' }), `captions.${kind}`);
  };

  return (
    <div className="stack">
      <div className="row" style={{ gap: 5 }}>
        {[['auto', 'Auto'], ['script', 'From script'], ['edit', 'Edit words']].map(([k, l]) => (
          <button
            key={k}
            className={`btn sm${tab === k ? ' primary' : ' ghost'}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'auto' && (
        <div className="stack">
          <div>
            <span className="label">Source audio</span>
            <select
              className="field"
              value={source?.id || ''}
              onChange={(e) => setSourceId(e.target.value)}
            >
              {!speechAssets.length && <option>No media imported</option>}
              {speechAssets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="label">Speech engine</span>
            <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="local">On this machine — free, no key</option>
              <option value="groq">Groq Whisper — free cloud, word timings</option>
              <option value="openai">OpenAI Whisper — word timings</option>
              <option value="deepgram">Deepgram Nova-2 — word timings</option>
            </select>
          </div>

          {provider === 'local' && (
            <div>
              <span className="label">Model</span>
              <select className="field" value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
                {LOCAL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="hint" style={{ marginTop: 6 }}>
                Runs Whisper inside this tab. The model downloads once and is
                cached by the browser; your audio never leaves the machine.
                <b> Always set the language code for non-English speech</b> —
                auto-detect failed badly on Arabic in testing.
              </div>
            </div>
          )}

          <div className="row">
            <input
              className="field"
              placeholder="Language code (auto if blank) — en, ar, es…"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            />
            {provider !== 'local' && (
              <button className="btn icon" title="API key" onClick={() => setShowKey((v) => !v)}>
                <IcKey size={15} />
              </button>
            )}
          </div>

          {showKey && provider !== 'local' && (
            <div>
              <span className="label">{provider} API key</span>
              <input
                className="field"
                type="password"
                placeholder="Stored in this browser only"
                value={keys[provider] || ''}
                onChange={(e) => {
                  const next = { ...keys, [provider]: e.target.value };
                  setKeys(next);
                  saveKeys(next);
                }}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                The key stays in localStorage and is sent only to that provider.
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            {[['', 'Auto'], ['en', 'English'], ['ar', 'Arabic']].map(([code, label]) => (
              <button key={label}
                className={`btn sm${(lang || '') === code ? ' primary' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setLang(code)}>{label}</button>
            ))}
          </div>
          <label className="row" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 10 }}>
            <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} />
            Translate speech → English captions
          </label>
          {translate && (
            <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
              For Arabic (or any language) speech with English captions. Timing
              follows the original speech; review a few lines afterwards — machine
              translation isn't word-perfect.
            </div>
          )}
          <button className="btn primary" disabled={busy} onClick={runAuto} style={{ justifyContent: 'center' }}>
            <IcSpark size={15} />
            {busy ? (status || 'Working…') : 'Generate captions'}
          </button>
          {busy && status && (
            <div className="bar"><i style={{ width: '100%', opacity: .5 }} /></div>
          )}
        </div>
      )}

      {tab === 'script' && (
        <div className="stack">
          <div>
            <span className="label">Paste what is said</span>
            <textarea
              className="field"
              rows={8}
              placeholder="Paste or type the script. Words are spread across the timeline by syllable length, then you can nudge any of them in the Edit words tab."
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
          </div>
          <button className="btn primary" onClick={runScript} style={{ justifyContent: 'center' }}>
            Time this script
          </button>
          <div className="hint">No API key needed. Good for voiceovers you already wrote.</div>
        </div>
      )}

      {tab === 'edit' && (
        <div className="stack">
          {!captions.words.length && <div className="empty">No captions yet.</div>}
          {!!captions.words.length && (
            <>
              <div className="hint">Click a word to jump the playhead to it.</div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {captions.words.map((w, i) => (
                  <span
                    key={i}
                    className={`word${time >= w.start && time <= w.end ? ' live' : ''}`}
                    onClick={() => setTime(w.start)}
                  >
                    {w.text}
                  </span>
                ))}
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => exportSubs('srt')}>
                  <IcDownload size={13} /> SRT
                </button>
                <button className="btn sm" onClick={() => exportSubs('vtt')}>
                  <IcDownload size={13} /> VTT
                </button>
                <button className="btn sm ghost" onClick={() => setWords([])}>Clear</button>
              </div>
            </>
          )}
        </div>
      )}

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      <div>
        <div className="spread" style={{ marginBottom: 9 }}>
          <span className="label" style={{ margin: 0 }}>Caption style</span>
          <label className="row" style={{ fontSize: 11, color: 'var(--dim)' }}>
            <input
              type="checkbox"
              checked={captions.enabled}
              onChange={(e) => setCaptions({ enabled: e.target.checked })}
            />
            Show
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {CAPTION_STYLES.map((s) => (
            <button
              key={s.id}
              className={`style-chip${captions.styleId === s.id ? ' on' : ''}`}
              onClick={() => commitCaptions({ styleId: s.id }, 'caption style')}
            >
              <div
                style={{
                  fontFamily: s.font.split('px ')[1]?.split(',')[0] || 'Inter',
                  fontWeight: 900,
                  fontSize: 13,
                  color: s.activeFill,
                  WebkitTextStroke: s.strokeWidth ? '0.7px #000' : 'none',
                  textShadow: s.glow ? `0 0 9px ${s.glow}` : 'none',
                  background: s.activeBox || 'transparent',
                  borderRadius: 4,
                  padding: '1px 5px',
                  display: 'inline-block',
                }}
              >
                {s.uppercase ? 'WORD' : 'Word'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--dimmer)', marginTop: 5 }}>{s.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="label" style={{ margin: 0 }}>Keyword icons</span>
        </div>
        <div className="row">
          <button className="btn sm" style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => {
              const n = useEditor.getState().addWordIcons({ onlyEmphasised: true, max: 6 });
              notify(n ? `${n} keyword icons added` : 'No matching keywords', n ? 'good' : 'bad');
            }}>
            ✨ Add icons to keywords
          </button>
          <button className="btn sm ghost" onClick={() => { useEditor.getState().clearWordIcons(); notify('Icons cleared'); }}>
            Clear
          </button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Pops a matching emoji above emphasised words — 💰 over "money", ⚠️ over
          "warning". Emphasise words first (Auto-edit does this automatically).
        </div>
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <Slider
          label={`Words on screen — ${captions.groupSize}`}
          min={1} max={8} step={1} value={captions.groupSize}
          onChange={(v) => setCaptions({ groupSize: v })}
        />
        <Slider
          label={`Vertical position — ${Math.round(captions.y * 100)}%`}
          min={0.1} max={0.94} step={0.01} value={captions.y}
          onChange={(v) => setCaptions({ y: v })}
        />
        <Slider
          label={`Size — ${Math.round(captions.scale * 100)}%`}
          min={0.5} max={1.8} step={0.05} value={captions.scale}
          onChange={(v) => setCaptions({ scale: v })}
        />
      </div>
    </div>
  );
}

export function Slider({ label, ...p }) {
  return (
    <div>
      <span className="label">{label}</span>
      <input type="range" {...p} onChange={(e) => p.onChange(+e.target.value)} />
    </div>
  );
}
