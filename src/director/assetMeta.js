// Asset metadata + proof matching.
//
// The proof engine works with the user's OWN assets — the AI cannot invent a
// private screenshot. It derives searchable metadata locally (filename tokens,
// dimensions, orientation, a resolution-based quality score, plus any manual
// tags), then matches transcript beats to the best asset. No cloud required;
// an optional Pilot-vision pass can enrich `semanticDescription` when a key
// exists, but nothing here depends on it.

const STOP = new Set('the a an of and or to for with img image screenshot screen shot photo pic final edit copy'.split(' '));

const TYPE_HINTS = [
  [/screenshot|screen|profile|analytics|insights|stats|dashboard/i, 'screenshot'],
  [/website|site|web|landing|page/i, 'website'],
  [/document|doc|contract|receipt|invoice|certificate|agreement|pdf/i, 'document'],
  [/review|testimonial|feedback|rating/i, 'testimonial'],
  [/listing|property|home|house|villa|apartment/i, 'listing'],
  [/client|customer|family|couple|people|team|portrait|headshot/i, 'photo'],
  [/logo|brand/i, 'logo'],
];

// Topic vocabulary so a beat about "property" matches a "listing" asset even if
// the words differ.
const TOPIC_SYNONYMS = {
  property: ['home', 'house', 'listing', 'villa', 'apartment', 'real', 'estate'],
  money: ['price', 'cost', 'dirham', 'aed', 'dollar', 'cash', 'revenue', 'sales', 'profit'],
  client: ['customer', 'family', 'couple', 'buyer', 'seller', 'people'],
  document: ['contract', 'receipt', 'invoice', 'certificate', 'paperwork'],
  proof: ['result', 'analytics', 'stats', 'review', 'testimonial', 'performance'],
  web: ['website', 'site', 'page', 'online', 'digital', 'social'],
};

const tokens = (str) =>
  String(str || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[^a-z0-9]+/i)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));

/** Derive metadata for one asset from its filename and dimensions. */
export function deriveMeta(asset, manual = {}) {
  const fnTokens = tokens(asset.name);
  let type = 'image';
  for (const [re, t] of TYPE_HINTS) if (re.test(asset.name)) { type = t; break; }

  const w = asset.width || 0, h = asset.height || 0;
  const orientation = !w || !h ? 'unknown' : w > h * 1.2 ? 'landscape' : h > w * 1.2 ? 'portrait' : 'square';
  const qualityScore = Math.min(1, ((w * h) || 0) / (1080 * 1080));

  return {
    id: asset.id,
    path: asset.name,
    type: manual.type || type,
    tags: [...new Set([...fnTokens, ...(manual.tags || [])])],
    people: manual.people || [],
    companies: manual.companies || [],
    topics: manual.topics || [],
    detectedText: manual.detectedText || '',
    semanticDescription: manual.semanticDescription || fnTokens.join(' '),
    orientation,
    width: w, height: h,
    qualityScore: +qualityScore.toFixed(2),
  };
}

/** Expand a token list with topic synonyms, for looser matching. */
function expand(list) {
  const out = new Set(list);
  for (const [topic, syns] of Object.entries(TOPIC_SYNONYMS)) {
    if (list.some((t) => t === topic || syns.includes(t))) {
      out.add(topic);
      syns.forEach((sSyn) => out.add(sSyn));
    }
  }
  return out;
}

/**
 * Score how well an asset supports a sentence. 0..1 with a confidence gate —
 * below `minConfidence` the director should place NOTHING rather than an
 * irrelevant image (the reference never shows off-topic proof).
 */
export function scoreAssetForBeat(meta, sentence) {
  const beatTokens = tokens(sentence.text || sentence);
  if (!beatTokens.length || !meta.tags.length) return 0;

  const beatSet = expand(beatTokens);
  const assetSet = expand([...meta.tags, ...meta.topics, ...meta.people, ...meta.companies, ...tokens(meta.semanticDescription)]);

  let overlap = 0;
  for (const t of assetSet) if (beatSet.has(t)) overlap++;
  if (!overlap) return 0;

  // Normalise by asset token count, reward quality and multiple hits.
  const base = overlap / Math.sqrt(assetSet.size);
  return +Math.min(1, base * 0.6 + Math.min(overlap, 3) * 0.15 + meta.qualityScore * 0.1).toFixed(3);
}

/**
 * For a list of sentences and assets, return the best proof placement per
 * sentence above the confidence gate. Each asset used at most once.
 */
export function matchProof(sentences, metas, { minConfidence = 0.28 } = {}) {
  const used = new Set();
  const placements = [];
  for (const s of sentences) {
    let best = null;
    for (const m of metas) {
      if (used.has(m.id)) continue;
      const score = scoreAssetForBeat(m, s);
      if (score > (best?.score || 0)) best = { meta: m, score };
    }
    if (best && best.score >= minConfidence) {
      used.add(best.meta.id);
      placements.push({
        sentence: s,
        assetId: best.meta.id,
        type: best.meta.type,
        orientation: best.meta.orientation,
        score: best.score,
        reason: `asset "${best.meta.path}" matches beat (score ${best.score})`,
      });
    }
  }
  return placements;
}

/**
 * Decide how a matched asset should appear, from its type and orientation.
 * Returns { overlay: 'card'|'document'|'pip'|'collage', ... }.
 */
export function overlayForAsset(meta, sentence) {
  if (meta.type === 'document') return { overlay: 'document' };
  if (meta.type === 'testimonial' || meta.type === 'photo') {
    return meta.orientation === 'portrait'
      ? { overlay: 'pip', pos: 'MID_RIGHT', shape: 'rect' }
      : { overlay: 'card', pos: 'SINGLE_LEFT' };
  }
  // screenshots / website / analytics / listing -> a side card
  return { overlay: 'card', pos: 'SINGLE_TOP_LEFT' };
}
