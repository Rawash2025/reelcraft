import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../store/editorStore.js';
import { ingestUrl } from '../engine/ingest.js';
import { helperOnline, getLibrary, getConfig, setConfig, fileUrl } from '../engine/helper.js';

const mb = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const MAX_SHOWN = 120;

function Item({ item, onAdd, adding }) {
  return (
    <div className="lib-item">
      <div className={`lib-thumb ${item.type}`}>
        {item.type === 'image' && <img src={item.thumb || item.url} alt="" loading="lazy" />}
        {item.type === 'video' && (item.thumb ? <img src={item.thumb} alt="" loading="lazy" /> : <span>Video</span>)}
        {item.type === 'audio' && <audio src={item.url} controls preload="none" />}
      </div>
      <div className="lib-meta">
        <div className="lib-name" title={item.label}>{item.label}</div>
        {item.sub && <div className="hint">{item.sub}</div>}
      </div>
      <button className="btn sm" disabled={adding} onClick={() => onAdd(item)}>{adding ? 'Adding…' : 'Add'}</button>
    </div>
  );
}

export default function LibraryPage() {
  const { notify } = useEditor.getState();
  const [kit, setKit] = useState(null);
  const [online, setOnline] = useState(null);
  const [libs, setLibs] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [newDir, setNewDir] = useState('');
  const [adding, setAdding] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');

  const loadDisk = async () => {
    const ok = await helperOnline();
    setOnline(ok);
    if (!ok) return;
    try {
      setCfg(await getConfig());
      setLibs((await getLibrary()).libraries);
    } catch (e) {
      notify(e.message, 'bad');
    }
  };

  useEffect(() => {
    fetch('/kit/manifest.json').then((r) => r.json()).then(setKit).catch(() => setKit({ groups: [] }));
    loadDisk();
  }, []);

  const add = async (item) => {
    setAdding(item.url);
    try {
      const name = item.fileName || item.url.split('/').pop().split('?')[0];
      await ingestUrl(item.url, name, { toTimeline: 'never', quiet: true });
      notify(`${item.label} added to the media bin`, 'good');
    } catch (e) {
      notify(e.message, 'bad');
    } finally {
      setAdding('');
    }
  };

  const addFolder = async () => {
    const dir = newDir.trim();
    if (!dir) return;
    try {
      const next = await setConfig({ libraryDirs: [...(cfg?.libraryDirs || []), dir] });
      setCfg(next);
      setNewDir('');
      if (!next.activeLibraryDirs.includes(dir)) notify('That folder was not found on this Mac', 'bad');
      setLibs((await getLibrary()).libraries);
    } catch (e) {
      notify(e.message, 'bad');
    }
  };

  const disk = useMemo(() => libs.map((lib) => {
    const needle = q.trim().toLowerCase();
    const items = lib.items
      .filter((i) => (kind === 'all' || i.kind === kind) && (!needle || `${i.folder}/${i.name}`.toLowerCase().includes(needle)))
      .map((i) => ({
        label: i.name, sub: `${i.folder ? `${i.folder} · ` : ''}${mb(i.size)}`, type: i.kind,
        url: fileUrl(i.path), fileName: i.name, thumb: i.kind === 'image' ? fileUrl(i.path) : null,
      }));
    return { ...lib, total: lib.items.length, items };
  }), [libs, q, kind]);

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>Library</h1>
            <p>The Signature brand kit and your materials folder. “Add” puts a file in the media bin of the current project.</p>
          </div>
        </header>

        <section>
          <h2 className="sec">Signature brand kit</h2>
          {!kit && <div className="hint">Loading…</div>}
          {kit?.groups.map((g) => (
            <div key={g.name} className="lib-group">
              <div className="label">{g.name}</div>
              <div className={`lib-grid${g.items[0]?.type === 'audio' ? ' audio' : ''}`}>
                {g.items.map((it) => <Item key={it.url} item={it} onAdd={add} adding={adding === it.url} />)}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="sec">Materials folder on this Mac</h2>
          {online === false && (
            <div className="notice">
              <strong>The helper is not running</strong>, so ReelCraft cannot read folders on the Mac. Start ReelCraft with
              the <code>ReelCraft.command</code> file (double-click) and this section fills in.
            </div>
          )}
          {online && (
            <>
              <div className="row lib-bar">
                <input className="field" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
                <select className="field" value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 130 }}>
                  <option value="all">All types</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                  <option value="image">Images</option>
                </select>
                <button className="btn" onClick={loadDisk}>Refresh</button>
              </div>
              {!disk.length && (
                <div className="notice">
                  No materials folder was found. ReelCraft looks for <code>~/Movies/ReelCraft Materials</code>. Add another folder below.
                </div>
              )}
              {disk.map((lib) => (
                <div key={lib.root} className="lib-group">
                  <div className="label">
                    {lib.name} · {lib.total} files{lib.truncated ? ' (first 1,500 shown)' : ''}
                  </div>
                  {!lib.items.length && <div className="hint">Nothing matches.</div>}
                  <div className="lib-grid">
                    {lib.items.slice(0, MAX_SHOWN).map((it) => <Item key={it.url} item={it} onAdd={add} adding={adding === it.url} />)}
                  </div>
                  {lib.items.length > MAX_SHOWN && (
                    <div className="hint" style={{ marginTop: 8 }}>
                      Showing {MAX_SHOWN} of {lib.items.length}. Search to narrow it down.
                    </div>
                  )}
                </div>
              ))}
              <div className="row lib-bar" style={{ marginTop: 16 }}>
                <input className="field" placeholder="Add another folder — full path, e.g. /Users/you/Movies/Stock"
                  value={newDir} onChange={(e) => setNewDir(e.target.value)} />
                <button className="btn" disabled={!newDir.trim()} onClick={addFolder}>Add folder</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
