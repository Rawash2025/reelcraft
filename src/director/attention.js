/**
 * The attention engine.
 *
 * Decides *when* the picture should change, rather than changing it on a timer.
 * The weights come from the brief; the inputs are whatever signals are actually
 * available, and each one degrades to a neutral value when it is not.
 */

const W = {
  semantic: 0.30,
  emphasis: 0.15,
  gesture: 0.15,
  energy: 0.10,
  staleness: 0.20,
  hookCta: 0.10,
};

// How much each label contributes to semantic importance.
const KIND_WEIGHT = {
  HOOK: 1.0, CTA: 0.95, WARNING: 0.9, STATISTIC: 0.85, NUMBER: 0.8,
  COMPARISON: 0.75, BENEFIT: 0.7, PROBLEM: 0.7, QUESTION: 0.7,
  LIST: 0.65, STEPS: 0.65, PROOF: 0.6, OBJECTION: 0.6, BRAND: 0.55,
  EDUCATION: 0.5, EXPLANATION: 0.4,
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/**
 * Score a sentence.
 *
 * @param s          classified sentence
 * @param ctx.energy      0..1 audio energy over the sentence (0.5 if unknown)
 * @param ctx.gesture     0..1 gesture strength (0 if no pose model)
 * @param ctx.staleness   0..1 how long the framing has been unchanged
 * @param ctx.medianWps   median speaking rate across the video
 */
export function attentionScore(s, ctx = {}) {
  const semantic = KIND_WEIGHT[s.kind] ?? 0.4;

  // Emphasis: speaking faster than usual, or a hard pause just before, both
  // read as the speaker leaning on this line.
  const median = ctx.medianWps || 3;
  const rate = clamp01((s.wordsPerSecond - median) / (median * 0.6) * 0.5 + 0.5);
  const pause = clamp01(s.pauseBefore / 0.9);
  const emphasis = clamp01(rate * 0.6 + pause * 0.4);

  const gesture = clamp01(ctx.gesture ?? 0);
  const energy = clamp01(ctx.energy ?? 0.5);
  const staleness = clamp01(ctx.staleness ?? 0);
  const hookCta = s.kind === 'HOOK' || s.kind === 'CTA' ? 1 : 0;

  const score =
    semantic * W.semantic +
    emphasis * W.emphasis +
    gesture * W.gesture +
    energy * W.energy +
    staleness * W.staleness +
    hookCta * W.hookCta;

  return {
    score: clamp01(score),
    parts: { semantic, emphasis, gesture, energy, staleness, hookCta },
  };
}

/**
 * Tracks how long the frame has looked the same. Every visual event resets it;
 * it climbs while nothing happens, which is what eventually forces a change
 * during a long flat stretch of narration.
 */
export class Staleness {
  constructor({ fullAt = 4.5 } = {}) {
    this.lastEventAt = 0;
    this.fullAt = fullAt;
  }
  at(t) {
    return clamp01((t - this.lastEventAt) / this.fullAt);
  }
  mark(t) {
    this.lastEventAt = t;
  }
}

/**
 * Decide the strength of the edit a score deserves.
 * 'none' still permits a caption change — captions are not an "event".
 */
export function eventStrength(score, { threshold = 0.42, strong = 0.68 } = {}) {
  if (score >= strong) return 'major';
  if (score >= threshold) return 'minor';
  return 'none';
}

/** Audio energy per sentence, from the decoded samples. Cheap RMS. */
export function energyBySentence(sentences, channel, sampleRate) {
  if (!channel || !sampleRate) return sentences.map(() => 0.5);
  const raw = sentences.map((s) => {
    const from = Math.max(0, Math.floor(s.start * sampleRate));
    const to = Math.min(channel.length, Math.ceil(s.end * sampleRate));
    if (to <= from) return 0;
    let sum = 0;
    // Stride: full-rate RMS over a whole sentence is wasted precision here.
    const stride = Math.max(1, Math.floor((to - from) / 4000));
    let n = 0;
    for (let i = from; i < to; i += stride) { sum += channel[i] * channel[i]; n++; }
    return Math.sqrt(sum / Math.max(1, n));
  });
  const max = Math.max(...raw, 1e-6);
  return raw.map((r) => clamp01(r / max));
}
