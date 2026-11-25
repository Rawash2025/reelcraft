/**
 * Turn a flat word list into sentences, and label what each one is doing.
 *
 * This runs with no API key. When a model is available the planner can revise
 * these labels, but the heuristics have to stand on their own — they are the
 * only classifier most users will ever run.
 */

const CUES = {
  CTA: [/\b(dm|message|comment|link in bio|register|sign ?up|book a call|contact|whatsapp|apply now|get in touch|follow)\b/i],
  QUESTION: [/\?\s*$/],
  WARNING: [/\b(don'?t|never|avoid|mistake|warning|careful|beware|risk|trap|lose|penalty|worst)\b/i],
  BENEFIT: [/\b(save|benefit|advantage|free|bonus|gain|profit|cheaper|faster|easier|better|win)\b/i],
  NUMBER: [/\d/],
  STATISTIC: [/\d+\s*%|\bpercent\b|\b(thousands|millions|hundreds)\b/i],
  COMPARISON: [/\b(vs\.?|versus|compared|instead of|rather than|better than|difference between)\b/i],
  LIST: [/\b(first|second|third|next|then|finally|step \d|number \d|tip \d)\b/i],
  STEPS: [/\b(step|how to|first you|then you|after that)\b/i],
  OBJECTION: [/\b(but|however|actually|the truth is|most people think|you might think)\b/i],
  PROOF: [/\b(proven|studies|data|clients|we helped|case study|results|testimonial)\b/i],
  PROBLEM: [/\b(problem|struggle|difficult|hard|confus|stuck|fail|issue|overpay|overpaying|waste|losing|too much)\b/i],
  BRAND: [/\b(our team|we are|our company)\b/i],
};

const HOOK_CUES = [
  /\b(stop|listen|here'?s|the secret|nobody tells you|most people|did you know|if you|watch this|before you)\b/i,
];

/** Split words into sentences using punctuation, then long pauses. */
export function toSentences(words, { maxGap = 0.55, maxWords = 22 } = {}) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      words: cur,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
    });
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const endsSentence = /[.!?]["')\]]?$/.test(w.text);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 0;
    if (endsSentence || gap > maxGap || cur.length >= maxWords) flush();
  }
  flush();
  return out;
}

/** Label one sentence. Returns { kind, scores, keywords }. */
export function classifySentence(sentence, index, total) {
  const t = sentence.text;
  const scores = {};

  for (const [kind, patterns] of Object.entries(CUES)) {
    let hit = 0;
    for (const re of patterns) if (re.test(t)) hit += 1;
    if (hit) scores[kind] = hit;
  }

  // Position matters as much as wording: the opening is a hook whether or not
  // it uses hook language, and the last line is usually the ask.
  // Only the very first line gets the strong hook lean. A wider window wrongly
  // labelled the second sentence of a short video as another hook.
  const isOpening = index === 0;
  const isClosing = index >= total - 2;
  if (isOpening) scores.HOOK = (scores.HOOK || 0) + 2;
  else if (index === 1 && sentence.start < 3) scores.HOOK = (scores.HOOK || 0) + 0.5;
  for (const re of HOOK_CUES) if (re.test(t)) scores.HOOK = (scores.HOOK || 0) + 1;
  if (isClosing && scores.CTA) scores.CTA += 2;

  // Statistic beats bare number; a question beats most things.
  if (scores.STATISTIC) scores.NUMBER = (scores.NUMBER || 0) - 1;

  const kind = Object.keys(scores).length
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : 'EXPLANATION';

  return { kind, scores, keywords: keywordsIn(sentence) };
}

const STOP = new Set(`
a an and are as at be been but by can did do does for from had has have how i if
in into is it its just like me my not of on or our so than that the their then
there these they this to too up us was we were what when which who will with
would you your very own out get got make made way too also into over
`.trim().split(/\s+/));

/** Words worth emphasising in this sentence, strongest first. */
export function keywordsIn(sentence) {
  return sentence.words
    .map((w, i) => {
      const raw = w.text;
      const c = raw.toLowerCase().replace(/[^\p{L}\p{N}%$€]/gu, '');
      if (!c || c.length < 2 || STOP.has(c)) return null;
      let score = Math.min(c.length, 10);
      if (/\d/.test(c)) score += 16;
      if (/[%$€]/.test(raw)) score += 12;
      if (/^[A-Z]{2,}$/.test(raw)) score += 6;      // shouted word
      if (/\b(never|don't|must|free|save|now)\b/i.test(raw)) score += 8;
      return { text: raw, index: i, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

/**
 * Classify a whole transcript. Returns sentences enriched with kind, keywords,
 * speaking rate and pause-before, which the attention engine consumes.
 */
export function classifyTranscript(words) {
  const sentences = toSentences(words);
  return sentences.map((s, i) => {
    const { kind, scores, keywords } = classifySentence(s, i, sentences.length);
    const dur = Math.max(0.001, s.end - s.start);
    const prev = sentences[i - 1];
    return {
      ...s,
      index: i,
      kind,
      scores,
      keywords,
      wordsPerSecond: s.words.length / dur,
      pauseBefore: prev ? Math.max(0, s.start - prev.end) : s.start,
      duration: dur,
    };
  });
}
