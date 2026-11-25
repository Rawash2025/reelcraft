import { useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { VOICE_PRESETS } from '../engine/audioFx.js';
import { searchBroll, fetchBrollAsset, pexelsKey, setPexelsKey } from '../engine/pexels.js';
import { FRAME_STYLES } from '../engine/layers.js';
import { FINISH_PRESETS } from '../engine/finish.js';
import { runTool } from '../agent/tools.js';
import { Slider } from './CaptionPanel.jsx';
import { IcSpark, IcKey, IcPlus, IcAudio } from './Icons.jsx';

const CARD_PRESETS = [
  [{ icon: '🪶', label: 'Plan' }, { icon: '📷', label: 'Shoot' }, { icon: '📝', label: 'Script' }],
  [{ icon: '🎯', label: 'Hook' }, { icon: '💡', label: 'Value' }, { icon: '🔁', label: 'Loop' }],
  [{ icon: '📈', label: 'Reach' }, { icon: '❤️', label: 'Engage' }, { icon: '💰', label: 'Convert' }],
  [{ icon: '⚡', label: 'Fast' }, { icon: '🎬', label: 'Clean' }, { icon: '🔥', label: 'Viral' }],
];

export default function FxPanel() {
  const assets = useEditor((s) => s.assets);
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const captions = useEditor((s) => s.captions);
  const { notify, setTransition, duration } = useEditor.getState();

  const [busy, setBusy] = useState(null);
  const [preset, setPreset] = useState('podcast');
  const [strength, setStrength] = useState(1);
  const [report, setReport] = useState(null);

  const [key, setKey] = useState(pexelsKey());
  const [showKey, setShowKey] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [frame, setFrame] = useState('luxury');

  const [cards, setCards] = useState(CARD_PRESETS[0]);

  const video = assets.filter((a) => a.type === 'video' && !a.credit);
  const main = video[0];

  const runEnhance = async () => {
    if (!main) return notify('Import a clip first', 'bad');
    setBusy('audio');
    setReport(null);
    try {
      const r = await runTool('enhance_audio', { asset_id: main.id, preset, strength });
      setReport(r);
      notify('Voice cleaned up', 'good');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setBusy('search');
    try {
      const aspect = project.aspect;
      const orientation = aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait';
      const found = await searchBroll(query.trim(), { orientation, perPage: 9 });
      setResults(found);
      if (!found.length) notify('Nothing found for that', 'bad');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const place = async (result) => {
    setBusy(`add-${result.id}`);
    try {
      const asset = await fetchBrollAsset(result);
      useEditor.getState().addAssets([asset]);
      useEditor.getState().addBrollClip(asset.id, {
        start: time,
        duration: Math.min(2.6, asset.duration),
        frame,
      });
      notify(`Placed at ${time.toFixed(1)}s — ${asset.credit}`, 'good');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const autoBroll = async () => {
    if (!captions.words.length) return notify('Generate captions first', 'bad');
    setBusy('auto');
    try {
      const r = await runTool('auto_broll', { count: 3, frame });
      const ok = r.placed.filter((p) => !p.error).length;
      notify(ok ? `${ok} cutaways placed` : 'No clips found for those terms', ok ? 'good' : 'bad');
    } catch (e) {
      notify(e.message.slice(0, 140), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const placeCards = () => {
    useEditor.getState().addCards(cards, {
      start: time,
      duration: Math.min(3.2, Math.max(1.5, duration() - time)),
      y: 0.62,
      walk: true,
    });
    notify('Card row added');
  };

  return (
    <div className="stack">
      {/* ------------------------------------------------------------ audio */}
      <div>
        <div className="spread" style={{ marginBottom: 9 }}>
          <span className="label" style={{ margin: 0 }}>Voice enhance</span>
          <IcAudio size={14} />
        </div>
        <select className="field" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {Object.entries(VOICE_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>{v.name}</option>
          ))}
        </select>
        <div style={{ marginTop: 10 }}>
          <Slider
            label={`Strength — ${Math.round(strength * 100)}%`}
            min={0} max={1} step={0.05} value={strength} onChange={setStrength}
          />
        </div>
        <button
          className="btn primary"
          style={{ justifyContent: 'center', width: '100%', marginTop: 10 }}
          disabled={!!busy}
          onClick={runEnhance}
        >
          <IcSpark size={14} />
          {busy === 'audio' ? 'Processing…' : 'Enhance voice'}
        </button>
        {report && (
          <div style={{ marginTop: 9, padding: 10, borderRadius: 9, background: 'var(--panel-2)' }}>
            <div className="hint">
              Signal-to-noise {report.signal_to_noise_before} →{' '}
              <b style={{ color: 'var(--good)' }}>{report.signal_to_noise_after} dB</b>
              {' '}({report.snr_gain_db > 0 ? '+' : ''}{report.snr_gain_db})
            </div>
            <div className="hint">
              Loudness {report.loudness_before} → <b>{report.loudness_after} dB</b>, peak {report.peak_after}
            </div>
          </div>
        )}
        <div className="hint" style={{ marginTop: 7 }}>
          Renders a cleaned copy and mutes the original take. Undo restores it.
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ----------------------------------------------------------- b-roll */}
      <div>
        <div className="spread" style={{ marginBottom: 9 }}>
          <span className="label" style={{ margin: 0 }}>B-roll — Pexels</span>
          <button className="btn icon sm" onClick={() => setShowKey((v) => !v)}>
            <IcKey size={13} />
          </button>
        </div>
        {showKey && (
          <input
            className="field"
            type="password"
            placeholder="Pexels API key"
            value={key}
            onChange={(e) => { setKey(e.target.value); setPexelsKey(e.target.value); }}
            style={{ marginBottom: 8 }}
          />
        )}

        <div className="row">
          <input
            className="field"
            placeholder="city night, laptop desk, ocean…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          />
          <button className="btn" disabled={busy === 'search'} onClick={runSearch}>
            {busy === 'search' ? '…' : 'Find'}
          </button>
        </div>

        <div style={{ marginTop: 9 }}>
          <span className="label">Frame</span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {FRAME_STYLES.map((f) => (
              <button
                key={f}
                className={`btn sm${frame === f ? ' primary' : ''}`}
                onClick={() => setFrame(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {!!results.length && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginTop: 10 }}>
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => place(r)}
                disabled={!!busy}
                title={`${r.duration}s · ${r.author || 'Pexels'} — add at playhead`}
                style={{
                  position: 'relative', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--line)', aspectRatio: '9/14', padding: 0,
                  background: `center/cover url(${r.thumb})`,
                  opacity: busy === `add-${r.id}` ? 0.45 : 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute', bottom: 3, right: 4, fontSize: 9,
                    background: 'rgba(0,0,0,.7)', padding: '1px 4px', borderRadius: 4,
                  }}
                >
                  {r.duration}s
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          className="btn"
          style={{ justifyContent: 'center', width: '100%', marginTop: 9 }}
          disabled={!!busy}
          onClick={autoBroll}
        >
          <IcSpark size={14} />
          {busy === 'auto' ? 'Fetching…' : 'Auto b-roll from transcript'}
        </button>
        <div className="hint" style={{ marginTop: 6 }}>
          Clips are downloaded, not linked — a linked cross-origin video would
          break export. Credit the creator when you post.
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ------------------------------------------------------------ cards */}
      <div>
        <span className="label">Graphic cards</span>
        <div style={{ display: 'grid', gap: 5 }}>
          {CARD_PRESETS.map((set, i) => (
            <button
              key={i}
              className={`style-chip${cards === set ? ' on' : ''}`}
              style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: 9 }}
              onClick={() => setCards(set)}
            >
              {set.map((c) => (
                <span key={c.label} style={{ fontSize: 11 }}>
                  {c.icon} {c.label}
                </span>
              ))}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          style={{ justifyContent: 'center', width: '100%', marginTop: 9 }}
          onClick={placeCards}
        >
          <IcPlus size={14} /> Add at playhead
        </button>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ----------------------------------------------------------- motion */}
      <div>
        <span className="label">Camera move</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {['none', 'alternate', 'punch', 'push', 'kenburns', 'parallax'].map((m) => (
            <button
              key={m}
              className="btn sm"
              onClick={() => {
                useEditor.getState().setMotionPattern(m, 0.13);
                notify(`Motion — ${m}`);
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Parallax is a dolly-and-drift that reads as depth. It is not depth-map
          parallax — there is no per-pixel displacement, so it will not match a
          true 3D-photo tool on a still.
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ----------------------------------------------------------- finish */}
      <div>
        <span className="label">Finishing pass</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(FINISH_PRESETS).map(([id, f]) => (
            <button
              key={id}
              className={`btn sm${project.finish === id ? ' primary' : ''}`}
              onClick={() => useEditor.getState().setFinish(id)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Vignette, film grain and a touch of bloom. The cheapest way to stop a
          clip looking like a raw screen grab.
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ------------------------------------------------------ sound design */}
      <div>
        <span className="label">Sound design</span>
        <div className="row">
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={!!busy}
            onClick={async () => {
              setBusy('sfx');
              try {
                const r = await runTool('add_sound_design', { intensity: 1, hook_at: 0.35 });
                notify(`${r.whooshes} whooshes laid down`, 'good');
              } catch (e) { notify(e.message, 'bad'); } finally { setBusy(null); }
            }}
          >
            {busy === 'sfx' ? '…' : 'Whooshes + impact'}
          </button>
          <button
            className="btn sm"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={!!busy}
            onClick={async () => {
              setBusy('music');
              try {
                await runTool('add_music_bed', { bpm: 90, level: 0.14 });
                notify('Backing bed added', 'good');
              } catch (e) { notify(e.message, 'bad'); } finally { setBusy(null); }
            }}
          >
            {busy === 'music' ? '…' : 'Backing bed'}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Synthesised on the spot, so there is nothing to license. The backing
          bed is deliberately plain — drop your own track on the Music track
          when you have one.
        </div>
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-soft)' }} />

      {/* ------------------------------------------------------- transitions */}
      <div>
        <span className="label">Cut transition</span>
        <div className="row">
          {['none', 'whip'].map((k) => (
            <button
              key={k}
              className={`btn sm${project.transition === k ? ' primary' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => setTransition(k)}
            >
              {k === 'none' ? 'Straight cut' : 'Whip pan'}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Whip adds a blurred pan through every cut on the video track.
        </div>
      </div>
    </div>
  );
}
