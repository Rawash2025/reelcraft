// Cloud rendering through JSON2Video.
//
// The local exporter captures the canvas in real time — a 60s video takes 60s
// and the tab has to stay in front. This path translates the timeline into a
// movie description, renders it server-side, and hands back an MP4 URL.
//
// buildMovie() is deliberately pure: timeline in, JSON out. It can be checked
// without an API key and without spending render credits.

const API = 'https://api.json2video.com/v2';

const KEY_STORE = 'reelcraft.json2video';
export const j2vKey = () => {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
};
export const setJ2vKey = (k) => {
  try { localStorage.setItem(KEY_STORE, k); } catch { /* private mode */ }
};

/* ------------------------------------------------------------------- ASS */

// ASS colours are &HAABBGGRR — byte-reversed from CSS hex, which is a classic
// place to get this silently wrong.
export function hexToASS(hex, alpha = '00') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
  const h = m ? m[1] : 'ffffff';
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

/**
 * Word-timed ASS with karaoke tags. JSON2Video will only do per-word
 * highlighting on supplied captions if they are ASS *and* carry per-word
 * timing — SRT and VTT lose it, which is why this exists.
 *
 * In ASS karaoke the secondary colour is the not-yet-spoken state and the
 * primary is the spoken state, so they are assigned that way round below.
 */
export function buildASS(state) {
  const { captions, project } = state;
  const chunks = captions._chunks || [];
  if (!chunks.length) return null;

  const style = captions.styleId || '';
  const upper = /bold-pop|impact|karaoke|boxed|gradient/.test(style);
  const fontSize = Math.round(project.height * 0.062 * (captions.scale || 1));
  const marginV = Math.round(project.height * (1 - (captions.y ?? 0.72)) - fontSize * 0.6);

  const spoken = hexToASS(project.accent || '#ffe600');
  const unspoken = hexToASS('#ffffff');

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${project.width}`,
    `PlayResY: ${project.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Reel,Archivo Black,${fontSize},${spoken},${unspoken},${hexToASS('#000000')},${hexToASS('#000000')},-1,0,0,0,100,100,0,0,1,${Math.round(fontSize * 0.09)},${Math.round(fontSize * 0.05)},2,80,80,${Math.max(20, marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = chunks.map((chunk) => {
    let cursor = chunk.start;
    const parts = chunk.words.map((w) => {
      // \k is centiseconds, and must cover the gap since the previous word or
      // the highlight drifts out of sync across a line.
      const dur = Math.max(1, Math.round((w.end - cursor) * 100));
      cursor = w.end;
      const text = upper ? w.text.toUpperCase() : w.text;
      return `{\\k${dur}}${escapeASS(text)}`;
    });
    return `Dialogue: 0,${assTime(chunk.start)},${assTime(chunk.end)},Reel,,0,0,0,,${parts.join(' ')}`;
  });

  return [...header, ...lines].join('\n');
}

const escapeASS = (s) => String(s).replace(/[{}\\]/g, '').replace(/\n/g, ' ');

/* ----------------------------------------------------------- movie build */

// Mirrors the inset maths in layers.js so the cloud render frames b-roll the
// same way the canvas does.
const FRAME_INSET = { luxury: 0.78, soft: 0.82, hard: 0.86, full: 1 };

/**
 * Translate the project into a JSON2Video movie.
 * `urls` maps assetId -> publicly reachable URL.
 */
export function buildMovie(state, urls) {
  const { project, tracks, captions } = state;
  const W = project.width;
  const H = project.height;
  const duration = state.duration;
  const elements = [];

  const video = tracks.find((t) => t.kind === 'video');
  const broll = tracks.find((t) => t.kind === 'broll');
  const overlay = tracks.find((t) => t.kind === 'overlay');
  const audio = tracks.find((t) => t.kind === 'audio');

  // Main footage.
  for (const c of video?.clips || []) {
    const src = urls[c.assetId];
    if (!src) continue;
    elements.push(clean({
      type: 'video',
      src,
      start: round(c.start),
      duration: round(c.duration),
      seek: round(c.in || 0),
      x: 0, y: 0, width: W, height: H,
      resize: c.fit === 'contain' ? 'contain' : 'cover',
      volume: video.muted ? 0 : round((c.volume ?? 1) * (video.volume ?? 1)),
      muted: !!video.muted,
      'fade-in': c.fadeIn || undefined,
      'fade-out': c.fadeOut || undefined,
      'z-index': 0,
    }));
  }

  // Framed b-roll, positioned to match the canvas layout.
  for (const c of broll?.clips || []) {
    const src = urls[c.assetId];
    if (!src) continue;
    const inset = FRAME_INSET[c.frame] ?? 0.78;
    const boxW = Math.round(W * inset);
    const boxH = inset === 1 ? H : Math.round(H * inset * (c.height ?? 0.4));
    elements.push(clean({
      type: 'video',
      src,
      start: round(c.start),
      duration: round(c.duration),
      seek: round(c.in || 0),
      x: Math.round((W - boxW) / 2 + (c.offsetX ?? 0) * W),
      y: Math.round(H * (c.y ?? 0.28) - boxH / 2),
      width: boxW,
      height: boxH,
      resize: 'cover',
      muted: true,
      'z-index': 1,
    }));
  }

  // Music / enhanced voice.
  for (const c of audio?.clips || []) {
    const src = urls[c.assetId];
    if (!src) continue;
    elements.push(clean({
      type: 'audio',
      src,
      start: round(c.start),
      duration: round(c.duration),
      seek: round(c.in || 0),
      volume: audio.muted ? 0 : round((c.volume ?? 1) * (audio.volume ?? 1)),
    }));
  }

  // Text overlays and card rows.
  for (const c of overlay?.clips || []) {
    if (c.kind === 'text') {
      const s = c.style || {};
      elements.push(clean({
        type: 'text',
        text: s.uppercase ? String(c.text).toUpperCase() : c.text,
        start: round(c.start),
        duration: round(c.duration),
        x: 0,
        y: Math.round(H * (c.y ?? 0.2) - H * (s.size ?? 0.06) * 0.75),
        width: W,
        settings: clean({
          'font-family': s.font || 'Inter',
          'font-size': `${Math.round(H * (s.size ?? 0.06))}px`,
          'font-weight': String(s.weight ?? 800),
          color: s.color === 'transparent' ? '#ffffff' : s.color || '#ffffff',
          'background-color': s.bg || undefined,
          'text-align': 'center',
          'horizontal-position': 'center',
        }),
        'z-index': 2,
      }));
    } else if (c.kind === 'cards') {
      // No native equivalent for the glass card row, so it goes over as HTML.
      elements.push(clean({
        type: 'html',
        html: cardsHTML(c, project.accent, W, H),
        start: round(c.start),
        duration: round(c.duration),
        x: 0, y: 0, width: W, height: H,
        'z-index': 3,
      }));
    }
  }

  // Captions, as ASS so the word highlight survives.
  const ass = captions.enabled ? buildASS(state) : null;
  if (ass) {
    elements.push({
      type: 'subtitles',
      captions: ass,
      settings: {
        style: 'classic-progressive',
        'font-family': 'Archivo Black',
        'font-size': Math.round(H * 0.062 * (captions.scale || 1)),
        'word-color': project.accent || '#ffe600',
        'line-color': '#ffffff',
        'outline-color': '#000000',
        'outline-width': Math.round(H * 0.0055),
        position: 'custom',
        y: Math.round(H * (captions.y ?? 0.72)),
        'max-words-per-line': captions.groupSize || 3,
      },
    });
  }

  return {
    resolution: 'custom',
    width: W,
    height: H,
    quality: 'high',
    fps: project.fps || 30,
    scenes: [
      {
        'background-color': project.background || '#000000',
        duration: round(duration),
        elements,
      },
    ],
  };
}

// Cards rendered as HTML — the closest match to the canvas treatment.
function cardsHTML(clip, accent, W, H) {
  const items = clip.items || [];
  const n = Math.max(1, items.length);
  const cardW = (W * (clip.width ?? 0.86) - W * 0.022 * (n - 1)) / n;
  const cardH = cardW * (clip.ratio ?? 1.12);
  const top = H * (clip.y ?? 0.55) - cardH / 2;
  const active = clip.active ?? -1;

  const cards = items.map((it, i) => {
    const on = i === active;
    return `<div class="c${on ? ' on' : ''}">
      <div class="i">${escapeHTML(it.icon || '')}</div>
      <div class="l">${escapeHTML(String(it.label || '').toUpperCase())}</div>
    </div>`;
  }).join('');

  return `<style>
  body{margin:0;width:${W}px;height:${H}px;background:transparent;
       font-family:'Archivo Black',Inter,sans-serif}
  .row{position:absolute;top:${Math.round(top)}px;left:0;width:${W}px;
       display:flex;gap:${Math.round(W * 0.022)}px;justify-content:center}
  .c{width:${Math.round(cardW)}px;height:${Math.round(cardH)}px;
     border-radius:${Math.round(cardW * 0.16)}px;
     background:linear-gradient(rgba(22,22,26,.72),rgba(12,12,15,.72));
     border:${Math.max(2, cardW * 0.008)}px solid rgba(255,255,255,.16);
     box-shadow:0 ${Math.round(cardH * 0.05)}px ${Math.round(cardW * 0.18)}px rgba(0,0,0,.55);
     display:flex;flex-direction:column;align-items:center;justify-content:center;
     gap:${Math.round(cardH * 0.08)}px}
  .c.on{background:linear-gradient(rgba(38,30,26,.92),rgba(20,14,12,.92));
        border-color:${accent};box-shadow:0 0 ${Math.round(cardW * 0.3)}px ${accent}}
  .i{font-size:${Math.round(cardW * 0.42)}px;line-height:1}
  .l{font-size:${Math.round(cardW * 0.135)}px;color:rgba(255,255,255,.82);letter-spacing:.02em}
  .c.on .l{color:${accent};text-shadow:0 0 ${Math.round(cardW * 0.12)}px ${accent}}
  </style><div class="row">${cards}</div>`;
}

const escapeHTML = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const round = (n) => Math.round(n * 1000) / 1000;

// JSON2Video rejects unknown/undefined keys in places, so strip them.
function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/* ------------------------------------------------------------- transport */

/**
 * Two-step upload: ask for a signed URL, then PUT the bytes straight to S3.
 * The signed URL expires in 120s, so the PUT follows immediately.
 */
export async function uploadAsset(file, apiKey, { name, signal } = {}) {
  if (file.size > 500 * 1024 * 1024)
    throw new Error(`${name || file.name} is over the 500 MB upload limit.`);

  const res = await fetch(`${API}/media/file`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      name: name || file.name,
      contentType: file.type || 'video/mp4',
      size: file.size,
    }),
  });
  if (!res.ok) throw new Error(`Upload request failed (${res.status}): ${(await res.text()).slice(0, 160)}`);

  const { uploadUrl, fileUrl } = await res.json();
  if (!uploadUrl || !fileUrl) throw new Error('Upload response was missing a URL.');

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    signal,
    headers: { 'Content-Type': file.type || 'video/mp4' },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status}).`);

  return fileUrl;
}

/** Full render: upload what the movie needs, submit, then poll to completion. */
export async function renderMovie({ state, apiKey, onProgress = () => {}, signal }) {
  if (!apiKey) throw new Error('Add your JSON2Video API key.');

  // Only upload assets the timeline actually references.
  const used = new Set();
  for (const t of state.tracks)
    for (const c of t.clips) if (c.assetId) used.add(c.assetId);
  const assets = state.assets.filter((a) => used.has(a.id));
  if (!assets.length) throw new Error('Nothing on the timeline to render.');

  const urls = {};
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    onProgress({ phase: 'upload', label: `Uploading ${a.name}`, value: i / assets.length });
    urls[a.id] = await uploadAsset(a.file, apiKey, { name: a.name, signal });
  }

  onProgress({ phase: 'submit', label: 'Submitting render', value: 0 });
  const movie = buildMovie(state, urls);

  const res = await fetch(`${API}/movies`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(movie),
  });
  if (res.status === 403) throw new Error('JSON2Video rejected that API key.');
  if (!res.ok) throw new Error(`Render request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);

  const created = await res.json();
  const project = created.project || created.movie?.project;
  if (!project) throw new Error('No project id came back from the render request.');

  // Poll. Renders are typically well under a minute, but allow for a queue.
  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    if (signal?.aborted) throw new Error('Cancelled.');
    await sleep(3000);

    const check = await fetch(`${API}/movies?project=${encodeURIComponent(project)}`, {
      signal,
      headers: { 'x-api-key': apiKey },
    });
    if (!check.ok) continue;

    const body = await check.json();
    const m = body.movie || {};
    if (m.status === 'done') {
      onProgress({ phase: 'done', label: 'Render complete', value: 1 });
      return { url: m.url, thumbnail: m.thumbnail, duration: m.duration, size: m.size, project };
    }
    if (m.status === 'error') throw new Error(m.message || 'The render failed.');
    onProgress({
      phase: m.status || 'running',
      label: m.status === 'pending' ? 'Queued…' : 'Rendering…',
      value: null,
    });
  }
  throw new Error('Render timed out after 15 minutes.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
