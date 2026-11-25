// Small levelled logger. Rendering runs 30x a second, so anything logged from
// the draw path must be rate-limited or it becomes the bottleneck it is meant
// to diagnose.
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

let level = LEVELS.warn;
try {
  const saved = localStorage.getItem('reelcraft.log');
  if (saved && saved in LEVELS) level = LEVELS[saved];
} catch { /* private mode */ }

export function setLogLevel(name) {
  if (name in LEVELS) {
    level = LEVELS[name];
    try { localStorage.setItem('reelcraft.log', name); } catch { /* noop */ }
  }
}

const seen = new Map();

const emit = (lvl, fn, scope, msg, data) => {
  if (level < lvl) return;
  fn(`[${scope}] ${msg}`, data ?? '');
};

export const log = {
  error: (scope, msg, data) => emit(LEVELS.error, console.error, scope, msg, data),
  warn: (scope, msg, data) => emit(LEVELS.warn, console.warn, scope, msg, data),
  info: (scope, msg, data) => emit(LEVELS.info, console.info, scope, msg, data),
  debug: (scope, msg, data) => emit(LEVELS.debug, console.debug, scope, msg, data),

  /** Log a given key at most once every `ms` — safe to call from a draw loop. */
  throttle(key, ms, lvl, scope, msg, data) {
    const now = performance.now();
    const last = seen.get(key) || 0;
    if (now - last < ms) return;
    seen.set(key, now);
    log[lvl](scope, msg, data);
  },

  /** Log a key exactly once for the life of the page. */
  once(key, lvl, scope, msg, data) {
    if (seen.has(`once:${key}`)) return;
    seen.set(`once:${key}`, 1);
    log[lvl](scope, msg, data);
  },
};

if (typeof window !== 'undefined') window.reelcraftLog = setLogLevel;
