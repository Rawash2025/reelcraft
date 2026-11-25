import { nanoid } from 'nanoid';

// Stock b-roll from Pexels.
//
// The clips are fetched as blobs rather than linked. A cross-origin <video>
// drawn to a canvas taints it, and a tainted canvas cannot be captured — which
// would break export with no visible error. Blob URLs are same-origin, so the
// renderer and the exporter both keep working.

const API = 'https://api.pexels.com/videos';

const KEY_STORE = 'reelcraft.pexels';

export const pexelsKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) || import.meta.env.VITE_PEXELS_KEY || '';
  } catch {
    return import.meta.env.VITE_PEXELS_KEY || '';
  }
};

export const setPexelsKey = (k) => {
  try { localStorage.setItem(KEY_STORE, k); } catch { /* private mode */ }
};

/** Search stock footage. `orientation` follows the project's aspect. */
export async function searchBroll(query, { orientation = 'portrait', perPage = 12 } = {}) {
  const key = pexelsKey();
  if (!key) throw new Error('No Pexels API key set.');

  const qs = new URLSearchParams({
    query,
    per_page: String(perPage),
    orientation,
    size: 'medium',
  });
  const res = await fetch(`${API}/search?${qs}`, { headers: { Authorization: key } });
  if (res.status === 401) throw new Error('Pexels rejected that API key.');
  if (res.status === 429) throw new Error('Pexels rate limit hit — wait a minute.');
  if (!res.ok) throw new Error(`Pexels ${res.status}`);

  const json = await res.json();
  return (json.videos || []).map((v) => ({
    id: String(v.id),
    thumb: v.image,
    duration: v.duration,
    width: v.width,
    height: v.height,
    author: v.user?.name,
    authorUrl: v.user?.url,
    pageUrl: v.url,
    files: (v.video_files || [])
      .filter((f) => f.file_type === 'video/mp4')
      .sort((a, b) => (b.width || 0) - (a.width || 0)),
  }));
}

/** Pick a file big enough for the canvas without hauling down a 4K master. */
function pickFile(files, targetW = 1080) {
  if (!files.length) return null;
  const ok = files.filter((f) => (f.width || 0) >= targetW);
  return (ok.length ? ok[ok.length - 1] : files[0]);
}

/** Download one result and hand back an asset ready for the media pool. */
export async function fetchBrollAsset(result, { targetW = 1080, signal } = {}) {
  const file = pickFile(result.files, targetW);
  if (!file) throw new Error('That clip has no usable MP4.');

  let res;
  try {
    res = await fetch(file.link, { signal });
  } catch {
    throw new Error('Could not download that clip (network or CORS).');
  }
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);

  const blob = await res.blob();
  const asJs = new File([blob], `pexels-${result.id}.mp4`, { type: 'video/mp4' });

  return {
    id: nanoid(8),
    name: `B-roll ${result.id}`,
    type: 'video',
    url: URL.createObjectURL(blob),
    file: asJs,
    thumb: result.thumb,
    duration: result.duration || 6,
    width: file.width || result.width,
    height: file.height || result.height,
    credit: result.author ? `${result.author} / Pexels` : 'Pexels',
    creditUrl: result.pageUrl,
  };
}

/**
 * Turn a transcript into b-roll search terms. Concrete nouns make better stock
 * searches than whatever the sentence happens to be about, so this favours
 * long, non-stopword tokens and de-duplicates near-repeats.
 */
const STOP = new Set(`
a an and are as at be been but by can do does for from had has have how i if in into
is it its just like me my not of on or our so than that the their then there these
they this to too up us was we were what when which who will with would you your very
el la los las un una de del que en es son ser por para con sin como mas pero si no lo
se su sus me te nos yo tu ella ellos hay ha han va van todo todos cada muy
`.trim().split(/\s+/));

export function brollTerms(words, max = 6) {
  const counts = new Map();
  for (const w of words) {
    const c = w.text.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (c.length < 5 || STOP.has(c)) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, max)
    .map(([t]) => t);
}
