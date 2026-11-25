import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './store/editorStore.js';
import { MediaPool } from './engine/media.js';
import { Playback } from './engine/playback.js';
import { AudioMixer } from './engine/exporter.js';
import MediaPanel from './components/MediaPanel.jsx';
import TemplatePanel from './components/TemplatePanel.jsx';
import CaptionPanel from './components/CaptionPanel.jsx';
import TextPanel from './components/TextPanel.jsx';
import AudioPanel from './components/AudioPanel.jsx';
import PilotPanel from './components/PilotPanel.jsx';
import DirectorPanel from './components/DirectorPanel.jsx';
import FxPanel from './components/FxPanel.jsx';
import BackgroundPanel from './components/BackgroundPanel.jsx';
import Preview from './components/Preview.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector from './components/Inspector.jsx';
import ExportModal from './components/ExportModal.jsx';
import Home from './home/Home.jsx';
import ToolsPage from './home/ToolsPage.jsx';
import LibraryPage from './home/LibraryPage.jsx';
import PlaybooksPage from './home/PlaybooksPage.jsx';
import {
  IcMedia, IcGrid, IcCaption, IcText, IcAudio, IcSpark, IcRipple,
  IcUndo, IcRedo, IcDownload,
} from './components/Icons.jsx';

const TABS = [
  { id: 'director', label: 'Director', Icon: IcSpark, Panel: DirectorPanel },
  { id: 'pilot', label: 'Pilot', Icon: IcGrid, Panel: PilotPanel },
  { id: 'media', label: 'Media', Icon: IcMedia, Panel: MediaPanel },
  { id: 'templates', label: 'Templates', Icon: IcGrid, Panel: TemplatePanel },
  { id: 'captions', label: 'Captions', Icon: IcCaption, Panel: CaptionPanel },
  { id: 'fx', label: 'FX', Icon: IcRipple, Panel: FxPanel },
  { id: 'bg', label: 'Background', Icon: IcMedia, Panel: BackgroundPanel },
  { id: 'text', label: 'Text', Icon: IcText, Panel: TextPanel },
  { id: 'audio', label: 'Audio', Icon: IcAudio, Panel: AudioPanel },
];

const VIEWS = [
  { id: 'home', label: 'Home' },
  { id: 'editor', label: 'Editor' },
  { id: 'library', label: 'Library' },
  { id: 'tools', label: 'Tools' },
  { id: 'playbooks', label: 'Playbooks' },
];

export default function App() {
  const [tab, setTab] = useState('media');
  // home: the simple flow. review: preview only, after a build. editor: everything.
  const [view, setView] = useState('home');
  const [exporting, setExporting] = useState(false);
  const assets = useEditor((s) => s.assets);
  const project = useEditor((s) => s.project);
  const toast = useEditor((s) => s.toast);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);

  const pool = useMemo(() => new MediaPool(), []);
  const mixerRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const playback = useMemo(() => new Playback(pool), [pool]);

  // Feed the playback engine a live view of the store.
  useEffect(() => {
    playback.getState = () => {
      const s = useEditor.getState();
      return { ...s, duration: s.duration() };
    };
    playback.onTime = (t) => useEditor.getState().setTime(t);
    return () => playback.destroy();
  }, [playback]);

  // Keep media elements in step with the bin, and wire new ones to the mixer.
  useEffect(() => {
    pool.sync(assets);
    if (!mixerRef.current && assets.length) {
      mixerRef.current = new AudioMixer();
      playback.setMixer(mixerRef.current);
    }
    if (mixerRef.current) {
      assets.forEach((a) => {
        const el = pool.get(a.id);
        if (el && a.type !== 'image') mixerRef.current.register(el);
      });
    }
    playback.paint();
    if (import.meta.env.DEV) window.__rig = { pool, playback, mixer: mixerRef.current };
  }, [assets, pool, playback]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      // Editing shortcuts belong to the editor and the review screen only.
      if (viewRef.current !== 'editor' && viewRef.current !== 'review') return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
        playback.seek(st.time);
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelected();
        return;
      }
      if (typing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (st.playing) {
          playback.pause();
          st.setPlaying(false);
        } else {
          playback.play();
          st.setPlaying(true);
        }
      }
      if (e.key === 's' || e.key === 'S') st.splitAt(st.time);
      if (e.key === 'Backspace' || e.key === 'Delete') st.removeSelected();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const d = (e.shiftKey ? 1 : 1 / project.fps) * (e.key === 'ArrowRight' ? 1 : -1);
        const t = Math.max(0, st.time + d);
        st.setTime(t);
        playback.seek(t);
      }
      if (e.key === 'Home') { st.setTime(0); playback.seek(0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback, project.fps]);

  const Panel = TABS.find((t) => t.id === tab).Panel;
  const go = (v) => {
    if (playback && useEditor.getState().playing) { playback.pause(); useEditor.getState().setPlaying(false); }
    setView(v);
  };
  const navOn = view === 'review' ? 'home' : view;

  return (
    <div className={`app view-${view}`} style={{ '--accent': project.accent }}>
      <header className="topbar">
        <div className="brand">
          <div className="mark">R</div>
          ReelCraft
        </div>
        <nav className="views">
          {VIEWS.map((v) => (
            <button key={v.id} className={`view-tab${navOn === v.id ? ' on' : ''}`} onClick={() => go(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <input
          className="proj-name"
          value={project.name}
          onChange={(e) => useEditor.getState().setProject({ name: e.target.value })}
        />
        <div style={{ flex: 1 }} />
        <button className="btn icon" disabled={!past.length} title="Undo"
          onClick={() => { useEditor.getState().undo(); playback.seek(useEditor.getState().time); }}>
          <IcUndo size={15} />
        </button>
        <button className="btn icon" disabled={!future.length} title="Redo"
          onClick={() => { useEditor.getState().redo(); playback.seek(useEditor.getState().time); }}>
          <IcRedo size={15} />
        </button>
        <button className="btn primary" onClick={() => setExporting(true)}>
          <IcDownload size={15} /> Export
        </button>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav className="tabs">
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                <Icon />
                {label}
              </button>
            ))}
          </nav>
          <div className="panel-body">
            <Panel />
          </div>
        </aside>

        <Preview playback={playback} />
        <Inspector />
      </div>

      <Timeline playback={playback} />

      {view === 'review' && (
        <div className="review-bar">
          <div>
            <strong>Check your reel.</strong> Press play. If it looks right, export it.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" onClick={() => go('home')}>Back</button>
            <button className="btn" onClick={() => go('editor')}>Fine-tune in the editor</button>
            <button className="btn primary" onClick={() => setExporting(true)}>
              <IcDownload size={15} /> Export
            </button>
          </div>
        </div>
      )}

      {view === 'home' && <Home onReady={() => go('review')} onOpenEditor={() => go('editor')} />}
      {view === 'tools' && <ToolsPage />}
      {view === 'library' && <LibraryPage />}
      {view === 'playbooks' && <PlaybooksPage />}

      {exporting && (
        <ExportModal
          onClose={() => setExporting(false)}
          pool={pool}
          mixer={mixerRef.current}
          playback={playback}
        />
      )}

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}
