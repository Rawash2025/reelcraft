/**
 * Turning speech into good stock-footage searches.
 *
 * The naive approach — take the most frequent long words — fails because the
 * words that carry meaning ("system", "exact", "carefully") are not the words
 * that make good footage ("mortgage", "Dubai", "keys"). Stock search wants a
 * concrete, filmable noun phrase.
 *
 * This module maps recognised concepts to curated queries, and otherwise falls
 * back to concrete nouns — never to abstract adjectives or verbs. Without an LLM
 * or CLIP this is a heuristic, but a domain-aware one, which is what makes the
 * difference on finance content.
 */

// Concept -> a query that reliably returns on-topic, non-generic footage.
// Order matters: earlier, more specific entries win.
const CONCEPT_MAP = [
  // Real estate / property
  [/\b(mortgage|home ?loan|housing loan)\b/i, 'signing mortgage contract paperwork'],
  [/\b(property|real ?estate|apartment|villa|home|house)\b/i, 'modern apartment building exterior'],
  [/\b(keys|handover|move in|new home)\b/i, 'handing over house keys'],
  [/\b(dubai)\b/i, 'dubai skyline aerial'],
  [/\b(abu dhabi)\b/i, 'abu dhabi city skyline'],
  [/\b(uae|emirates)\b/i, 'uae city skyline'],
  [/\b(down ?payment|deposit)\b/i, 'counting money savings'],
  // Banking / finance
  [/\b(bank|lender|financial institution)\b/i, 'modern bank building'],
  [/\b(advisor|consultant|broker|agent)\b/i, 'financial advisor meeting client'],
  [/\b(rate|interest|apr|percentage)\b/i, 'financial charts on screen'],
  [/\b(salary|income|earnings)\b/i, 'person reviewing payslip'],
  [/\b(document|paperwork|contract|application|form)\b/i, 'reviewing documents at desk'],
  [/\b(approve|approved|approval|eligible|qualify|qualified|accepted)\w*/i, 'shaking hands business deal'],
  [/\b(save|saving|savings|cheaper)\b/i, 'putting coins in savings jar'],
  [/\b(calculate|calculator|budget|numbers)\b/i, 'using calculator with documents'],
  [/\b(invest|investment|portfolio|wealth)\b/i, 'stock market data screen'],
  // Generic-but-usable people/business
  [/\b(team|company|business|office)\b/i, 'modern office team working'],
  [/\b(phone|call|whatsapp|message|contact)\b/i, 'person using smartphone'],
  [/\b(computer|laptop|online|website|digital)\b/i, 'typing on laptop closeup'],
  [/\b(meeting|discuss|consultation)\b/i, 'business meeting handshake'],
  [/\b(city|urban|skyline|downtown)\b/i, 'city skyline timelapse'],
  // General life / business coverage so more sentences resolve to footage.
  [/\b(work|working|job|career|employee)\b/i, 'people working in modern office'],
  [/\b(travel|trip|vacation|flight|airport)\b/i, 'airplane window travel'],
  [/\b(car|vehicle|drive|driving)\b/i, 'luxury car driving city'],
  [/\b(food|eat|restaurant|meal|dinner)\b/i, 'restaurant food closeup'],
  [/\b(coffee|cafe|morning)\b/i, 'pouring coffee cafe'],
  [/\b(gym|fitness|workout|health|exercise)\b/i, 'person working out gym'],
  [/\b(study|student|school|university|learn|education)\b/i, 'student studying laptop'],
  [/\b(children|kids|child|baby|family)\b/i, 'happy family at home'],
  [/\b(shop|shopping|store|retail|buy)\b/i, 'shopping mall interior'],
  [/\b(nature|outdoor|forest|park|green)\b/i, 'sunlight through forest trees'],
  [/\b(water|ocean|sea|beach|wave)\b/i, 'ocean waves aerial'],
  [/\b(night|evening|sunset|dark)\b/i, 'city lights at night'],
  [/\b(technology|tech|ai|software|app|digital)\b/i, 'futuristic technology interface'],
  [/\b(social|instagram|tiktok|content|video|post)\b/i, 'person filming smartphone content'],
  [/\b(happy|smile|success|celebrate|joy)\b/i, 'happy person celebrating'],
  [/\b(stress|stressed|worry|worried|problem|struggle|struggling|hard|overwhelm)\w*/i, 'stressed person at desk'],
  [/\b(handshake|deal|agreement|partner)\b/i, 'business handshake closeup'],
  [/\b(growth|grow|scale|expand)\b/i, 'plant growing timelapse'],
  [/\b(map|location|destination|place)\b/i, 'world map navigation'],
  [/\b(clock|schedule|plan|calendar)\b/i, 'calendar planning desk'],
];

// Concrete-noun allow-list: words that name something filmable. Used only when
// no concept matched, to avoid searching stock for abstract words.
const CONCRETE = new Set(`
house home apartment building office bank money cash coins keys door car
phone laptop computer screen desk table chair paper document contract pen
city street road bridge sky sunset ocean beach mountain tree park garden
family people man woman person hands face team crowd meeting handshake
food coffee book calculator chart graph map camera clock
`.trim().split(/\s+/));

const STOP = new Set(`
a an and are as at be been but by can did do does for from had has have how i if
in into is it its just like me my not of on or our so than that the their them then
there these they this to too up us was we were what when which who will with would
you your very own out get got make made way also over more most only then now here
system exact carefully blindly thing things really actually basically literally
`.trim().split(/\s+/));

const clean = (w) => w.toLowerCase().replace(/[^\p{L}]/gu, '');

/**
 * Best stock query for one sentence. Returns { query, source } or null.
 * `brandQueries` (optional) is a curated list to prefer when a brand term hits.
 */
export function conceptForSentence(text, brand = null) {
  const t = String(text || '');

  // 1. Brand vocabulary wins — these are hand-picked to stay on-topic.
  if (brand?.vocabulary) {
    const lower = t.toLowerCase();
    const hit = brand.vocabulary.terms.find((term) => lower.includes(term));
    if (hit) {
      // Prefer a mapped concept for the specific term; else a curated brand query.
      for (const [re, query] of CONCEPT_MAP) if (re.test(hit)) return { query, source: 'brand+concept' };
      const q = brand.vocabulary.brollQueries[hashPick(hit, brand.vocabulary.brollQueries.length)];
      return { query: q, source: 'brand' };
    }
  }

  // 2. Concept map on the whole sentence.
  for (const [re, query] of CONCEPT_MAP) {
    if (re.test(t)) return { query, source: 'concept' };
  }

  // 3. Fall back to a concrete noun, if the sentence names one.
  const words = t.split(/\s+/).map(clean).filter(Boolean);
  const noun = words.find((w) => CONCRETE.has(w));
  if (noun) return { query: noun, source: 'noun' };

  // 4. Nothing filmable — better to place no b-roll than a random clip.
  return null;
}

/**
 * Queries across a whole transcript, de-duplicated, best first. Replaces the
 * old frequency-of-long-words approach, which produced abstract terms.
 */
export function conceptQueries(sentences, { brand = null, max = 6 } = {}) {
  const seen = new Set();
  const out = [];
  for (const s of sentences) {
    const hit = conceptForSentence(s.text || s, brand);
    if (!hit || seen.has(hit.query)) continue;
    seen.add(hit.query);
    out.push({ ...hit, start: s.start ?? null });
    if (out.length >= max) break;
  }
  return out;
}

function hashPick(str, n) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, n);
}
