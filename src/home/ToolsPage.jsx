import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { ingestFiles } from '../engine/ingest.js';
import {
  helperOnline, getTools, startDownload, startVoice, startWhisper, startProject,
  waitForJob, fetchAsFile,
} from '../engine/helper.js';

const MARK = { ffmpeg: 'FF', ytdlp: 'dlp', whisper: 'W', remotion: 'R', hyperframes: 'HF' };

export default function ToolsPage() {
  const assets = useEditor((s) => s.assets);
  const { notify } = useEditor.getState();
  const [online, setOnline] = useState(null);
  const [tools, setTools] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
  const [dirs, setDirs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('reelcraft.projectDirs') || '{}'); } catch { return {}; }
  });
  const setDir = (tool, v) => {
    const next = { ...dirs, [tool]: v };
    setDirs(next);
    try { localStorage.setItem('reelcraft.projectDirs', JSON.stringify(next)); } catch { /* private mode */ }
  };

  const refresh = async () => {
    const ok = await helperOnline();
    setOnline(ok);
    if (ok) {
      try { setTools((await getTools()).tools); } catch { setTools([]); }
    }
  };
  useEffect(() => { refresh(); }, []);

  const has = (id) => tools.find((t) => t.id === id)?.installed;
  const source = assets.find((a) => a.type === 'video') || assets.find((a) => a.type === 'audio');

  const runJob = async (key, start, after) => {
    setBusy(key);
    setJob(null);
    try {
      const j = await start();
      const result = await waitForJob(j.id, setJob);
      await after?.(result);
    } catch (e) {
      notify(e.message, 'bad');
    } finally {
      setBusy('');
    }
  };

  const download = () =>
    runJob('ytdlp', () => startDownload(link.trim()), async (r) => {
      const file = await fetchAsFile(r.path, r.name);
      await ingestFiles([file], { quiet: true });
      notify('Reference video added to the media bin', 'good');
      setLink('');
    });

  const voice = () =>
    runJob('voice', () => startVoice(source.file), async (r) => {
      const file = await fetchAsFile(r.path, r.name);
      await ingestFiles([file], { toTimeline: 'never', quiet: true });
      notify('Cleaned voice added to the media bin — drag it to the audio track', 'good');
    });

  const transcribe = (task) =>
    runJob('whisper', () => startWhisper(source.file, { language: 'ar', task, model: 'small' }), async (r) => {
      useEditor.getState().setWords(r.words);
      notify(`${r.words.length} words transcribed`, 'good');
    });

  const project = (tool, action) =>
    runJob(`${tool}-${action}`, () => startProject({ tool, action, dir: (dirs[tool] || '').trim() }), (r) => {
      notify(r.started ? 'Preview is starting' : 'Render finished — the file is in the project folder', 'good');
    });

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>Tools</h1>
            <p>Programs on this Mac that ReelCraft can run for you.</p>
          </div>
          <button className="btn" onClick={refresh}>Check again</button>
        </header>

        {online === false && (
          <div className="notice">
            <strong>The helper is not running.</strong> These tools need it. Close ReelCraft and start it with
            the <code>ReelCraft.command</code> file in the ReelCraft folder (double-click), or run <code>npm start</code> there.
            Everything else in ReelCraft works without it.
          </div>
        )}

        {online && (
          <div className="tool-grid">
            {tools.map((t) => (
              <div key={t.id} className={`tool${t.installed ? '' : ' off'}`}>
                <div className="tool-top">
                  <div className="tool-mark">{MARK[t.id]}</div>
                  <div>
                    <div className="tool-name">{t.name}</div>
                    <div className={`tool-state${t.installed ? ' ok' : ''}`}>{t.installed ? 'Ready' : 'Not installed'}</div>
                  </div>
                </div>
                <p>{t.use}</p>
                {t.installed
                  ? <div className="hint">{t.version}</div>
                  : <div className="hint">To install, in Terminal: <code>{t.install}</code></div>}

                {t.id === 'ytdlp' && t.installed && (
                  <div className="tool-act">
                    <input className="field" placeholder="Paste a video link" value={link} onChange={(e) => setLink(e.target.value)} />
                    <button className="btn primary" disabled={!link.trim() || !!busy} onClick={download}>
                      {busy === 'ytdlp' ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                )}
                {t.id === 'ffmpeg' && t.installed && (
                  <div className="tool-act">
                    <button className="btn primary" disabled={!source || !!busy} onClick={voice}>
                      {busy === 'voice' ? 'Cleaning…' : 'Clean the voice of the current video'}
                    </button>
                  </div>
                )}
                {t.id === 'whisper' && t.installed && (
                  <div className="tool-act">
                    <button className="btn primary" disabled={!source || !!busy} onClick={() => transcribe('transcribe')}>
                      {busy === 'whisper' ? 'Transcribing…' : 'Transcribe (Arabic)'}
                    </button>
                    <button className="btn" disabled={!source || !!busy} onClick={() => transcribe('translate')}>To English</button>
                  </div>
                )}
                {(t.id === 'remotion' || t.id === 'hyperframes') && t.installed && (
                  <div className="tool-act col">
                    <input className="field" placeholder="Project folder, e.g. /Users/you/Movies/My Reel/project"
                      value={dirs[t.id] || ''} onChange={(e) => setDir(t.id, e.target.value)} />
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn" disabled={!dirs[t.id] || !!busy} onClick={() => project(t.id, 'studio')}>Open preview</button>
                      <button className="btn primary" disabled={!dirs[t.id] || !!busy} onClick={() => project(t.id, 'render')}>
                        {busy === `${t.id}-render` ? 'Rendering…' : 'Render'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {online && !source && (
          <div className="hint" style={{ marginTop: 14 }}>Add a video on the Home page to use voice cleaning and transcription.</div>
        )}

        {job && (
          <div className="job">
            <div className="job-head">
              <strong>{job.label}</strong>
              <span className={`tool-state${job.status === 'done' ? ' ok' : ''}`}>
                {job.status === 'running' ? 'Working…' : job.status === 'done' ? 'Finished' : 'Failed'}
              </span>
            </div>
            {job.error && <div className="home-error">{job.error}</div>}
            {!!job.log?.length && <pre>{job.log.slice(-8).join('\n')}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
