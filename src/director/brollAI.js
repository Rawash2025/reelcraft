/**
 * LLM-backed B-roll query generation.
 *
 * The concept map (concepts.js) covers filmable sentences with 100% relevance
 * but leaves abstract lines uncovered — which is the correct default, because
 * forcing stock footage onto "this changed my life" looks worse than nothing.
 *
 * When the user has configured a Pilot provider, this asks the model for a
 * short, concrete, filmable search phrase for every sentence that still needs
 * one. It reuses the existing provider adapters, so it works with Anthropic,
 * OpenAI, Gemini, Groq, OpenRouter or a local model — no new key.
 *
 * Falls back to the concept map on any failure, so it can never make coverage
 * worse than the heuristic.
 */
import { sendTurn } from '../agent/providers.js';
import { conceptForSentence } from '../engine/concepts.js';
import { log } from '../engine/log.js';

const SYSTEM = `You suggest stock-footage search queries for short vertical
videos. For each numbered line of a transcript, reply with the SAME number and a
short, concrete, filmable search phrase (3-5 words) describing b-roll that would
visually support that line. Prefer literal, shootable scenes (objects, places,
people doing things) over abstract concepts. If a line has no good visual, reply
with the number and the single word NONE. Reply with only the numbered list,
nothing else.`;

/**
 * Get a query for every sentence. Concept map first (fast, free, on-topic),
 * LLM for the remainder. Returns array aligned to `sentences`:
 * [{ query, source }] where source is 'concept' | 'ai' | null.
 */
export async function brollQueriesAI(sentences, { cfg, brand = null, signal } = {}) {
  // 1. Concept map pass.
  const result = sentences.map((s) => {
    const hit = conceptForSentence(s.text || s, brand);
    return hit ? { query: hit.query, source: 'concept' } : { query: null, source: null };
  });

  // 2. Nothing configured — return the heuristic result as-is.
  if (!cfg?.provider) return result;

  const gaps = [];
  result.forEach((r, i) => { if (!r.query) gaps.push(i); });
  if (!gaps.length) return result;

  const list = gaps.map((i, n) => `${n + 1}. ${sentences[i].text || sentences[i]}`).join('\n');

  try {
    const reply = await sendTurn({
      cfg,
      apiKey: cfg.apiKey,
      system: SYSTEM,
      turns: [{ role: 'user', content: list }],
      tools: [],
      onText: () => {},
      signal,
    });
    const lines = String(reply.text || '').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
      if (!m) continue;
      const n = parseInt(m[1], 10) - 1;
      const q = m[2].trim();
      if (n < 0 || n >= gaps.length) continue;
      if (/^none$/i.test(q)) continue;
      result[gaps[n]] = { query: q.replace(/["']/g, '').slice(0, 60), source: 'ai' };
    }
    log.info('brollAI', `filled ${gaps.length} gaps via ${cfg.provider}`);
  } catch (e) {
    log.warn('brollAI', 'LLM query generation failed — keeping heuristic', e.message);
  }

  return result;
}
