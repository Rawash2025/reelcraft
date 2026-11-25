// Recipes for common short-form genres. Each pack is both a set of numbers the
// deterministic director executes and a brief the model reads, so the two
// produce recognisably the same kind of edit.

export const STYLE_PACKS = [
  {
    id: 'signature',
    name: 'Signature',
    transition: 'none',
    audio: 'podcast',
    brollFrame: 'soft',
    finish: 'subtle',
    sfx: 0.9,
    sfxKit: 'desk',
    music: true,
    musicFile: 'mus01_signature_calm',
    icons: false,
    hero: false,
    premiumScenes: true,
    brand: 'signature',
    blurb: 'The house look: olive, cream and champagne, matte cloth panels, calm cuts, desk sounds and an acoustic bed. Nothing glows.',
    template: 'talking-head',
    silence: { minSilence: 0.3, padding: 0.06, sensitivity: 0.55 },
    captions: { styleId: 'shadow-pop', groupSize: 3, y: 0.6, scale: 1 },
    motion: { pattern: 'alternate', strength: 0.08 },
    grade: 'film',
    accent: '#C7B995',
    emphasisRate: 0.1,
    brief:
      'Signature reel. Every graphic should feel like an object on a desk: matte olive panels with a thin champagne hairline, cream text, one champagne accent, red only for a warning word. Calm, confident pacing with gentle punch-ins; no whip transitions, no glow, no emoji or icons, no neon. One graphic per beat, never covering the speaker\'s head. Sound is desk sounds only (paper, pen, seal) under a quiet acoustic bed. Never promise approval; rates are "from X%" and subject to bank approval.',
  },
  {
    id: 'premium-kinetic',
    name: 'Premium Kinetic Reel',
    transition: 'whip',
    audio: 'bright',
    brollFrame: 'luxury',
    finish: 'subtle',
    sfx: 1.1,
    music: true,
    icons: true,
    iconMax: 5,
    hero: false,
    premiumScenes: true,
    brand: 'olive',
    blurb: 'The reference look: small+HUGE hero words (some behind the speaker), tight word captions upper-centre, punch-ins on beats, proof cards, big numbers.',
    template: 'talking-head',
    silence: { minSilence: 0.28, padding: 0.05, sensitivity: 0.55 },
    captions: { styleId: 'shadow-pop', groupSize: 3, y: 0.6, scale: 1 },
    motion: { pattern: 'alternate', strength: 0.12 },
    grade: 'vivid',
    accent: '#ffe600',
    emphasisRate: 0.14,
    brief:
      'Premium kinetic talking-head reel modelled on a high-end real-estate creator edit. Continuous speaker foundation, tight word-level captions upper-centre (never bottom subtitles), a small supporting line + ONE huge uppercase keyword on important beats with one word placed behind the speaker for depth, big-number treatment for figures and dates, proof/collage cards beside the speaker, controlled punch-ins on emphasis and sentence turns, brief pattern interrupts every few seconds with clean rest moments between. White text plus one brand accent — never multicolour.',
  },
  {
    id: 'creator-fastcut',
    icons: true,
    finish: 'cinematic',
    sfx: 1.0,
    music: true,
    transition: 'whip',
    audio: 'bright',
    brollFrame: 'luxury',
    name: 'Creator fast-cut',
    blurb: 'Hard jump cuts, punch-ins every other cut, three-word captions with the payoff words in accent colour.',
    template: 'talking-head',
    silence: { minSilence: 0.18, padding: 0.045, sensitivity: 0.55 },
    captions: { styleId: 'bold-pop', groupSize: 3, y: 0.72, scale: 1.05 },
    motion: { pattern: 'alternate', strength: 0.13 },
    grade: 'vivid',
    accent: '#ffe600',
    emphasisRate: 0.14,
    brief:
      'Fast-paced creator reel. Cut every pause hard so the delivery never drags. Punch in on alternating cuts. Captions large, low-centre, three words at a time, with numbers and payoff words in the accent colour. Open with a text hook over the first two seconds.',
  },
  {
    id: 'podcast-pull',
    icons: false,
    finish: 'subtle',
    sfx: 0.6,
    music: false,
    transition: 'none',
    audio: 'podcast',
    brollFrame: 'soft',
    name: 'Podcast pull-quote',
    blurb: 'Two-word captions, heavy stroke, film grade. Built to read on a muted feed.',
    template: 'podcast-clip',
    silence: { minSilence: 0.32, padding: 0.07, sensitivity: 0.5 },
    captions: { styleId: 'impact', groupSize: 2, y: 0.62, scale: 1 },
    motion: { pattern: 'push', strength: 0.07 },
    grade: 'film',
    accent: '#39ff88',
    emphasisRate: 0.1,
    brief:
      'Podcast clip. Keep the natural rhythm — only trim long dead air. Slow push in across each clip. Two-word captions, centred, heavy stroke.',
  },
  {
    id: 'tutorial-clean',
    icons: false,
    finish: 'none',
    sfx: 0.0,
    music: false,
    transition: 'none',
    audio: 'clean',
    brollFrame: 'hard',
    name: 'Tutorial',
    blurb: 'Quiet subtitles, no camera moves, light trimming. Nothing competes with the screen.',
    template: 'tutorial',
    silence: { minSilence: 0.45, padding: 0.1, sensitivity: 0.45 },
    captions: { styleId: 'minimal', groupSize: 6, y: 0.86, scale: 1 },
    motion: { pattern: 'none', strength: 0 },
    grade: 'none',
    accent: '#2bb8ff',
    emphasisRate: 0.06,
    brief:
      'Instructional video. Trim only long pauses. No motion. Subtitles quiet and low so they never obscure what is being shown.',
  },
  {
    id: 'hype-cuts',
    icons: true,
    finish: 'cinematic',
    sfx: 1.35,
    music: true,
    transition: 'whip',
    audio: 'bright',
    brollFrame: 'luxury',
    name: 'Hype montage',
    blurb: 'Punch on every cut, neon captions, cool grade. Music-led.',
    template: 'hype-reel',
    silence: { minSilence: 0.16, padding: 0.03, sensitivity: 0.6 },
    captions: { styleId: 'neon', groupSize: 3, y: 0.68, scale: 1.1 },
    motion: { pattern: 'punch', strength: 0.16 },
    grade: 'cool',
    accent: '#4be1ff',
    emphasisRate: 0.18,
    brief:
      'High-energy montage. Cut aggressively. Punch in on every cut. If a music asset exists, snap the cuts to its beat. Glowing captions.',
  },
  {
    id: 'story-vo',
    icons: false,
    finish: 'film',
    sfx: 0.7,
    music: true,
    transition: 'none',
    audio: 'warm',
    brollFrame: 'soft',
    name: 'Story voiceover',
    blurb: 'Centre-screen typed lines over a slow drift. For narration.',
    template: 'story-mode',
    silence: { minSilence: 0.4, padding: 0.09, sensitivity: 0.45 },
    captions: { styleId: 'typewriter', groupSize: 4, y: 0.5, scale: 1 },
    motion: { pattern: 'kenburns', strength: 0.12 },
    grade: 'fade',
    accent: '#ff8a3d',
    emphasisRate: 0.08,
    brief:
      'Narrated story. Keep breathing room between sentences. Slow drifting camera. Lines typed out centre-screen.',
  },
];

export const packById = (id) => STYLE_PACKS.find((p) => p.id === id) || STYLE_PACKS[0];

// Stopwords for emphasis picking. English and Spanish, since those cover most
// short-form work; unknown languages fall back to the length heuristic.
const STOP = new Set(`
a an and are as at be been but by can do does for from had has have how i if in
into is it its just like me my not of on or our so than that the their then there
these they this to too up us was we were what when which who will with would you your
el la los las un una unos unas y o de del al que en es son ser fue eso esto esta este
por para con sin sobre como cuando donde quien mas muy pero si no lo se su sus me te
nos yo tu el ella ellos hay ha han va van todo todos cada
`.trim().split(/\s+/));

const clean = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}%$€]/gu, '');

/**
 * Pick the words worth colouring. Numbers and money always qualify — they are
 * the concrete claims. Otherwise take the longest non-stopwords, capped at a
 * rate so the effect stays an accent rather than a highlighter.
 */
export function pickEmphasis(words, rate = 0.12) {
  const scored = words.map((w, i) => {
    const c = clean(w.text);
    // Fragments like ",000." carry a digit and would otherwise score highly.
    if (!c || c.length < 2 || STOP.has(c)) return { i, score: -1, text: w.text };
    let score = Math.min(c.length, 12);
    if (/[0-9]/.test(c)) score += 14;
    if (/[%$€]/.test(w.text)) score += 10;
    return { i, score, text: w.text };
  });
  const budget = Math.max(1, Math.round(words.length * rate));
  return scored
    .filter((s) => s.score > 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)
    .map((s) => s.text);
}
