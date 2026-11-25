/**
 * Effect memory — the anti-repetition engine.
 *
 * Four punch-ins in a row is what makes automatic editing look automatic. This
 * keeps a short history and penalises whatever was just used, so the planner
 * naturally rotates through its vocabulary.
 */
export class EffectMemory {
  constructor({ window = 4, cooldown = 2 } = {}) {
    this.window = window;      // how many recent events to consider
    this.cooldown = cooldown;  // events before a repeat is unpenalised
    this.history = [];         // [{ channel, name, t }]
  }

  record(channel, name, t) {
    this.history.push({ channel, name, t });
    if (this.history.length > 40) this.history.shift();
  }

  /** How recently this exact effect ran, in events ago. Infinity if never. */
  since(channel, name) {
    const rows = this.history.filter((h) => h.channel === channel);
    for (let i = rows.length - 1, back = 1; i >= 0; i--, back++) {
      if (rows[i].name === name) return back;
    }
    return Infinity;
  }

  /** 1 = fully fresh, approaching 0 = just used. */
  freshness(channel, name) {
    const back = this.since(channel, name);
    if (back === Infinity) return 1;
    if (back > this.cooldown) return 1;
    return back / (this.cooldown + 1);
  }

  /**
   * Pick from `options` (array of names, or {name, weight}) preferring the
   * least recently used. Deterministic: no randomness, so the same EDL is
   * produced from the same input every time.
   */
  choose(channel, options) {
    const norm = options.map((o) => (typeof o === 'string' ? { name: o, weight: 1 } : o));
    if (!norm.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const o of norm) {
      const score = (o.weight ?? 1) * this.freshness(channel, o.name);
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best.name;
  }

  /** Was this channel used within the last `n` events overall? */
  usedRecently(channel, n = this.window) {
    return this.history.slice(-n).some((h) => h.channel === channel);
  }

  reset() {
    this.history = [];
  }
}
