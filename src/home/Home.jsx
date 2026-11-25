import { useRef, useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { STYLE_PACKS } from '../agent/stylePacks.js';
import { autoDirect } from '../agent/autoDirector.js';
import { ingestFiles } from '../engine/ingest.js';

// The two house looks get a card each; everything else sits behind "More".
const FEATURED = [
  {
    id: 'signature',
    title: 'Signature',
    tag: 'Default',
    image: '/kit/walls/w02_olive_window_t.jpg',
    lines: ['Olive, cream and champagne', 'Matte cloth panels, no glow', 'Desk sounds and an acoustic bed'],
  },
  {
    id: 'premium-kinetic',
    title: 'Premium',
    tag: 'Gold look',
    image: null,
    lines: ['Big kinetic keywords', 'Glass cards and gold accent', 'Whooshes and a synth bed'],
  },
];

const CAPTION_MODES = [
  { id: 'translate', label: 'English captions (translate what is said)' },
  { id: 'transcribe', label: 'Captions in the spoken language' },
  { id: 'off', label: 'No captions' },
];
const LANGS = [
  { id: 'ar', label: 'Arabic' },
  { id: 'en', label: 'English' },
  { id: '', label: 'Detect automatically' },
];

export default function Home({ onReady, onOpenEditor }) {
  const assets = useEditor((s) => s.assets);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [packId, setPackId] = useState('signature');
  const [more, setMore] = useState(false);
  const [captions, setCaptions] = useState('translate');
  const [lang, setLang] = useState('ar');
  const [hook, setHook] = useState('');
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const video = assets.find((a) => a.type === 'video');
  const others = STYLE_PACKS.filter((p) => !FEATURED.some((f) => f.id === p.id));

  const take = async (files) => {
    setReading(true);
    try {
      await ingestFiles(files, { quiet: true });
    } finally {
      setReading(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setError('');
    setSteps([]);
    try {
      await autoDirect({
        packId,
        assetId: video?.id,
        hook,
        transcribe: useEditor.getState().captions.words.length ? 'off' : captions,
        asrModel: 'Xenova/whisper-small',
        language: lang || undefined,
        onStep: ({ label, state, detail }) =>
          setSteps((prev) => {
            const i = prev.findIndex((e) => e.label === label);
            const entry = { label, state, detail };
            if (i < 0) return [...prev, entry];
            const next = [...prev];
            next[i] = entry;
            return next;
          }),
      });
      onReady();
    } catch (e) {
      setError(e.message || 'Something went wrong while building the reel.');
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    useEditor.getState().reset();
    setSteps([]);
    setError('');
  };

  return (
    <div className="home">
      <div className="home-inner">
        <header className="home-head">
          <h1>Make a reel</h1>
          <p>Add your video, choose the look, check the result, export.</p>
        </header>

        <ol className="flow">
          <li className={`flow-step${video ? ' done' : ' active'}`}>
            <div className="flow-n">1</div>
            <div className="flow-body">
              <h2>Your video</h2>
              {!video ? (
                <div
                  className={`drop big${over ? ' over' : ''}`}
                  onClick={() => input.current.click()}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
                >
                  <div className="drop-title">{reading ? 'Reading the file…' : 'Drop the video here, or click to choose'}</div>
                  <div className="hint">MP4 or MOV. It stays on this Mac.</div>
                  <input ref={input} type="file" accept="video/*" hidden
                    onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
                </div>
              ) : (
                <div className="picked">
                  {video.thumb ? <img src={video.thumb} alt="" /> : <div className="picked-ph" />}
                  <div>
                    <div className="picked-name">{video.name}</div>
                    <div className="hint">
                      {Math.round(video.duration)} s{video.width ? ` · ${video.width}×${video.height}` : ''}
                    </div>
                  </div>
                  <button className="btn ghost sm" disabled={busy} onClick={startOver}>Change</button>
                </div>
              )}
            </div>
          </li>

          <li className={`flow-step${video ? ' active' : ''}`}>
            <div className="flow-n">2</div>
            <div className="flow-body">
              <h2>The look</h2>
              <div className="looks">
                {FEATURED.map((f) => (
                  <button key={f.id} className={`look${packId === f.id ? ' on' : ''}`} onClick={() => setPackId(f.id)} disabled={busy}>
                    <div className={`look-art${f.image ? '' : ' gold'}`} style={f.image ? { backgroundImage: `url(${f.image})` } : null}>
                      <span className="look-tag">{f.tag}</span>
                    </div>
                    <div className="look-title">{f.title}</div>
                    <ul>{f.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                  </button>
                ))}
              </div>
              <button className="link" onClick={() => setMore((m) => !m)}>{more ? 'Hide other styles' : 'Other styles'}</button>
              {more && (
                <div className="chips">
                  {others.map((p) => (
                    <button key={p.id} className={`chip${packId === p.id ? ' on' : ''}`} onClick={() => setPackId(p.id)} disabled={busy} title={p.blurb}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="home-opts">
                <label>
                  <span className="label">Spoken language</span>
                  <select className="field" value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy}>
                    {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </select>
                </label>
                <label>
                  <span className="label">Captions</span>
                  <select className="field" value={captions} onChange={(e) => setCaptions(e.target.value)} disabled={busy}>
                    {CAPTION_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <label className="wide">
                  <span className="label">Opening line on screen (optional)</span>
                  <input className="field" value={hook} onChange={(e) => setHook(e.target.value)} disabled={busy}
                    placeholder="e.g. Before you pick the villa, know your number" />
                </label>
              </div>
            </div>
          </li>

          <li className={`flow-step${video ? ' active' : ''}`}>
            <div className="flow-n">3</div>
            <div className="flow-body">
              <h2>Build and check</h2>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn primary lg" disabled={!video || busy} onClick={build}>
                  {busy ? 'Building…' : 'Build my reel'}
                </button>
                <button className="btn ghost" onClick={onOpenEditor}>Open the full editor instead</button>
              </div>
              {!video && <div className="hint" style={{ marginTop: 8 }}>Add a video first.</div>}
              {captions !== 'off' && video && !busy && !steps.length && (
                <div className="hint" style={{ marginTop: 8 }}>
                  The first build downloads the speech model once, so it takes longer than later ones.
                </div>
              )}
              {!!steps.length && (
                <ul className="build-log">
                  {steps.map((s) => (
                    <li key={s.label} className={s.state}>
                      <span className="dot" />
                      {s.label}
                      {s.state === 'error' && s.detail ? <em> — {String(s.detail)}</em> : null}
                    </li>
                  ))}
                </ul>
              )}
              {error && <div className="home-error">{error}</div>}
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}
