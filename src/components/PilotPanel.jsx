import { useRef, useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { STYLE_PACKS } from '../agent/stylePacks.js';
import { LOCAL_MODELS } from '../engine/transcribe.js';
import { autoDirect } from '../agent/autoDirector.js';
import { direct } from '../agent/director.js';
import { PROVIDERS } from '../agent/providers.js';
import { loadKeys, saveKeys } from '../engine/transcribe.js';
import { IcSpark, IcKey, IcUndo, IcX } from './Icons.jsx';

const label = (name) =>
  name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const CFG_STORE = 'reelcraft.pilot';
const loadCfg = () => {
  try {
    return JSON.parse(localStorage.getItem(CFG_STORE) || '{}');
  } catch {
    return {};
  }
};
const saveCfg = (c) => {
  try { localStorage.setItem(CFG_STORE, JSON.stringify(c)); } catch { /* private mode */ }
};

export default function PilotPanel() {
  const assets = useEditor((s) => s.assets);
  const captions = useEditor((s) => s.captions);
  const { notify, undo } = useEditor.getState();

  const [packId, setPackId] = useState('signature');
  const [assetId, setAssetId] = useState('');
  const [hook, setHook] = useState('');
  const [transcribe, setTranscribe] = useState('translate');
  // Small by default: base was measurably unusable on non-English audio.
  const [asrModel, setAsrModel] = useState('Xenova/whisper-small');
  const [srcLang, setSrcLang] = useState('');
  const [brollCount, setBrollCount] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [keys, setKeys] = useState(loadKeys());
  const [showKey, setShowKey] = useState(false);
  const [cfg, setCfgState] = useState(() => {
    const saved = loadCfg();
    const provider = saved.provider || 'anthropic';
    return {
      provider,
      model: saved.model || PROVIDERS[provider].defaultModel,
      baseUrl: saved.baseUrl || '',
    };
  });
  const provider = PROVIDERS[cfg.provider];

  const setCfg = (patch) => {
    const next = { ...cfg, ...patch };
    // Switching provider resets the model to that provider's default, since a
    // model name from one provider is meaningless to another.
    if (patch.provider && patch.provider !== cfg.provider) {
      next.model = PROVIDERS[patch.provider].defaultModel;
      next.baseUrl = '';
    }
    setCfgState(next);
    saveCfg(next);
  };
  const [log, setLog] = useState([]);
  const [narration, setNarration] = useState('');
  const [busy, setBusy] = useState(null);
  const abort = useRef(null);
  const history = useRef([]);

  const videoAssets = assets.filter((a) => a.type !== 'audio');
  const source = videoAssets.find((a) => a.id === assetId) || videoAssets[0];
  const pack = STYLE_PACKS.find((p) => p.id === packId);

  const push = (entry) => setLog((l) => [...l, { ...entry, id: l.length }]);

  const runAuto = async () => {
    if (!assets.length) return notify('Import a clip first', 'bad');
    setLog([]);
    setNarration('');
    setBusy('auto');
    try {
      const out = await autoDirect({
        packId,
        assetId: source?.id,
        hook,
        transcribe: captions.words.length ? 'off' : transcribe,
        asrModel,
        language: srcLang || undefined,
        brollCount,
        onStep: ({ label: l, state, detail }) =>
          setLog((prev) => {
            const i = prev.findIndex((e) => e.label === l);
            const entry = { label: l, state, detail, id: i < 0 ? prev.length : prev[i].id };
            if (i < 0) return [...prev, entry];
            const next = [...prev];
            next[i] = entry;
            return next;
          }),
      });
      notify(`Edit built — ${out.duration}s`, 'good');
    } catch (e) {
      notify(e.message, 'bad');
      push({ label: 'Failed', state: 'error', detail: e.message });
    } finally {
      setBusy(null);
    }
  };

  const runPilot = async () => {
    if (!assets.length) return notify('Import a clip first', 'bad');
    if (cfg.provider !== 'custom' && !keys[cfg.provider]) {
      setShowKey(true);
      return notify(`Add your ${provider.name} API key`, 'bad');
    }
    if (provider.needsBaseUrl && !cfg.baseUrl) {
      setShowKey(true);
      return notify('Set the base URL for your server', 'bad');
    }
    const ask = instruction.trim() || `Edit this into a ${pack.name.toLowerCase()} video.${hook ? ` Hook: "${hook}"` : ''}`;
    setLog([]);
    setNarration('');
    setBusy('pilot');
    abort.current = new AbortController();
    try {
      const out = await direct({
        cfg: { ...cfg, apiKey: keys[cfg.provider] || '' },
        instruction: ask,
        packId,
        history: history.current,
        signal: abort.current.signal,
        onEvent: (e) => {
          if (e.type === 'text') setNarration((n) => n + e.text);
          else if (e.type === 'tool') push({ label: label(e.name), state: 'running', input: e.input });
          else if (e.type === 'result')
            setLog((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].state === 'running') {
                  next[i] = {
                    ...next[i],
                    state: e.error ? 'error' : 'done',
                    detail: e.error || e.output,
                  };
                  break;
                }
              }
              return next;
            });
          else if (e.type === 'error') push({ label: 'Error', state: 'error', detail: e.text });
        },
      });
      history.current = out.turns || [];
      if (!out.refused) notify('Pilot finished', 'good');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  return (
    <div className="stack">
      <div>
        <span className="label">Style</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {STYLE_PACKS.map((p) => (
            <button
              key={p.id}
              className={`style-chip${packId === p.id ? ' on' : ''}`}
              style={{ textAlign: 'left', padding: '9px 11px' }}
              onClick={() => setPackId(p.id)}
            >
              <b style={{ fontSize: 12 }}>{p.name}</b>
              <div className="hint" style={{ marginTop: 3 }}>{p.blurb}</div>
            </button>
          ))}
        </div>
      </div>

      {videoAssets.length > 1 && (
        <div>
          <span className="label">Main clip</span>
          <select className="field" value={source?.id || ''} onChange={(e) => setAssetId(e.target.value)}>
            {videoAssets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className="label">Hook line (optional)</span>
        <input
          className="field"
          placeholder="The line that stops the scroll"
          value={hook}
          onChange={(e) => setHook(e.target.value)}
        />
      </div>

      {!captions.words.length && (
        <div>
          <span className="label">Captions</span>
          <select
            className="field"
            value={transcribe}
            onChange={(e) => setTranscribe(e.target.value)}
          >
            <option value="translate">Speech → English captions (any language)</option>
            <option value="transcribe">Captions in the spoken language</option>
            <option value="off">Skip — I'll add captions myself</option>
          </select>
          {transcribe !== 'off' && (
            <div className="row" style={{ marginTop: 7 }}>
              <select
                className="field"
                value={asrModel}
                onChange={(e) => setAsrModel(e.target.value)}
              >
                {LOCAL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input
                className="field"
                style={{ maxWidth: 92 }}
                placeholder="ar, es…"
                value={srcLang}
                onChange={(e) => setSrcLang(e.target.value)}
              />
            </div>
          )}
          {transcribe !== 'off' && !srcLang && (
            <div className="hint" style={{ marginTop: 6, color: 'var(--warn)' }}>
              Set the language code if the speech is not English. Left blank on
              Arabic audio, Whisper misdetected the language and returned
              nonsense — this is the single biggest quality factor.
            </div>
          )}
          {transcribe === 'translate' && (
            <div className="hint" style={{ marginTop: 6 }}>
              One pass, so the English keeps the timing of the original speech.
              Tested on Arabic: <b>Small</b> transcribes accurately but
              translation only gets the gist and misreads ambiguous words. Plan
              to fix a few lines in Captions → Edit words.
            </div>
          )}
        </div>
      )}

      <div>
        <span className="label">B-roll cutaways — {brollCount || 'none'}</span>
        <input
          type="range" min={0} max={4} step={1} value={brollCount}
          onChange={(e) => setBrollCount(+e.target.value)}
        />
        <div className="hint">Stock footage from Pexels, chosen from the transcript.</div>
      </div>

      <button
        className="btn primary"
        style={{ justifyContent: 'center' }}
        disabled={!!busy}
        onClick={runAuto}
      >
        <IcSpark size={15} />
        {busy === 'auto' ? 'Editing…' : 'Auto-edit'}
      </button>
      <div className="hint" style={{ marginTop: -6 }}>
        Transcribes, cuts the pauses, styles and highlights the captions, sets
        the framing and grade, adds the finishing pass, cleans the voice and
        lays down sound design. Everything except b-roll runs offline.
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="label" style={{ margin: 0 }}>AI pilot</span>
          <button className="btn icon sm" onClick={() => setShowKey((v) => !v)} title="API key">
            <IcKey size={13} />
          </button>
        </div>
        {showKey && (
          <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
            <div>
              <span className="label">Provider</span>
              <select
                className="field"
                value={cfg.provider}
                onChange={(e) => setCfg({ provider: e.target.value })}
              >
                {Object.entries(PROVIDERS).map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
            </div>

            {provider.needsBaseUrl && (
              <div>
                <span className="label">Base URL</span>
                <input
                  className="field"
                  placeholder="http://localhost:11434/v1"
                  value={cfg.baseUrl}
                  onChange={(e) => setCfg({ baseUrl: e.target.value })}
                />
              </div>
            )}

            <div>
              <span className="label">Model</span>
              <input
                className="field"
                list="pilot-models"
                placeholder={provider.defaultModel || 'model name'}
                value={cfg.model}
                onChange={(e) => setCfg({ model: e.target.value })}
              />
              <datalist id="pilot-models">
                {provider.models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>

            <div>
              <span className="label">API key</span>
              <input
                className="field"
                type="password"
                placeholder={provider.keyHint}
                value={keys[cfg.provider] || ''}
                onChange={(e) => {
                  const next = { ...keys, [cfg.provider]: e.target.value };
                  setKeys(next);
                  saveKeys({ [cfg.provider]: e.target.value });
                }}
              />
              <div className="hint" style={{ marginTop: 5 }}>
                Get one at {provider.console}. Stored in this browser only and
                sent straight to {provider.name} — it never passes through
                anything else.
              </div>
            </div>
          </div>
        )}
        <textarea
          className="field"
          rows={3}
          placeholder={`Tell the pilot what you want. e.g. "Cut this tight, put the hook on screen, and highlight every number."`}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn primary"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={!!busy}
            onClick={runPilot}
          >
            <IcSpark size={15} />
            {busy === 'pilot' ? 'Working…' : 'Run pilot'}
          </button>
          {busy === 'pilot' && (
            <button className="btn icon" onClick={() => abort.current?.abort()} title="Stop">
              <IcX size={14} />
            </button>
          )}
        </div>
        <div className="hint" style={{ marginTop: 7 }}>
          Using <b>{provider.name}</b> · {cfg.model || 'no model set'}
          {provider.streams ? '' : ' · replies arrive per turn, not streamed'}
        </div>
        {!captions.words.length && (
          <div className="hint" style={{ marginTop: 7 }}>
            No transcript yet — generate captions first and the pilot can edit to
            what is actually said.
          </div>
        )}
      </div>

      {(log.length > 0 || narration) && (
        <div>
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="label" style={{ margin: 0 }}>Session</span>
            <button className="btn sm ghost" onClick={() => { undo(); notify('Stepped back'); }}>
              <IcUndo size={12} /> Undo
            </button>
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            {log.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: '7px 9px',
                  borderRadius: 8,
                  background: 'var(--panel-2)',
                  borderLeft: `2px solid ${
                    e.state === 'error' ? 'var(--bad)'
                      : e.state === 'running' ? 'var(--warn)' : 'var(--good)'
                  }`,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 600 }}>{e.label}</div>
                {e.detail != null && (
                  <div className="hint" style={{ marginTop: 2, wordBreak: 'break-word' }}>
                    {typeof e.detail === 'string' ? e.detail : summarise(e.detail)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {narration && (
            <div
              style={{
                marginTop: 10, padding: 11, borderRadius: 10,
                background: 'var(--panel-2)', border: '1px solid var(--line-soft)',
                fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}
            >
              {narration}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tool results are objects; show the parts a person cares about.
function summarise(d) {
  if (Array.isArray(d)) return d.slice(0, 6).join(', ');
  if (typeof d !== 'object') return String(d);
  return Object.entries(d)
    .filter(([, v]) => v != null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
}
