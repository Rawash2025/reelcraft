import { useEffect, useState } from 'react';

// Brand playbooks (markdown files in public/playbooks), shown as read-only reference.
// They are the rules the Signature and Premium looks were built from.
export default function PlaybooksPage() {
  const [index, setIndex] = useState([]);
  const [open, setOpen] = useState(null);
  const [text, setText] = useState('');

  useEffect(() => {
    fetch('/playbooks/index.json').then((r) => r.json()).then((list) => {
      setIndex(list);
      if (list[0]) setOpen(list[0]);
    }).catch(() => setIndex([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    setText('');
    fetch(open.file).then((r) => r.text()).then((t) => setText(t.replace(/^---[\s\S]*?---\s*/, '')));
  }, [open]);

  return (
    <div className="page">
      <div className="page-inner wide">
        <header className="page-head">
          <div>
            <h1>Playbooks</h1>
            <p>Your brand rules for reels, covers, posts and copy. Add markdown files to public/playbooks and list them in index.json.</p>
          </div>
        </header>
        <div className="pb">
          <nav className="pb-list">
            {index.map((p) => (
              <button key={p.id} className={`pb-link${open?.id === p.id ? ' on' : ''}`} onClick={() => setOpen(p)}>
                <strong>{p.title}</strong>
                <span>{p.description}</span>
              </button>
            ))}
          </nav>
          <article className="pb-doc">
            {text ? <pre>{text}</pre> : <div className="hint">Loading…</div>}
          </article>
        </div>
      </div>
    </div>
  );
}
