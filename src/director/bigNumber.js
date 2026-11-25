// Big-number engine — parse numeric expressions from speech and format them
// for hero display. The reference gives figures dramatic typographic treatment
// (AED 2.4M, 98%, 2026, 15 DAYS), so numbers get their own structured model
// rather than being left inside a caption.

// Order matters: currency+scale before bare number, percent before number.
const PATTERNS = [
  // $40 million / AED 2.4M / 2,400,000 AED
  { type: 'currency', re: /\b(aed|usd|\$|€|£|dhs?|dirhams?|dollars?)\s?([\d.,]+)\s?(million|billion|thousand|k|m|b|mn|bn)?\b/i,
    build: (m) => ({ prefix: cur(m[1]), value: numShort(m[2], m[3]), suffix: scaleSuffix(m[3]), unit: cur(m[1]) }) },
  { type: 'currency', re: /\b([\d.,]+)\s?(million|billion|thousand|k|m|b)?\s?(aed|usd|dollars?|dirhams?)\b/i,
    build: (m) => ({ prefix: cur(m[3]), value: numShort(m[1], m[2]), suffix: scaleSuffix(m[2]), unit: cur(m[3]) }) },
  // 98% / 3.99 percent
  { type: 'percent', re: /\b([\d.]+)\s?(%|percent)\b/i,
    build: (m) => ({ value: m[1], suffix: '%' }) },
  // 15 days / 2 years / 30 minutes
  { type: 'duration', re: /\b(\d+)\s?(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i,
    build: (m) => ({ value: m[1], suffix: m[2].toUpperCase() }) },
  // 5,000+ / 1000+
  { type: 'count', re: /\b([\d,]{2,})\+/,
    build: (m) => ({ value: m[1].replace(/,/g, ','), suffix: '+' }) },
  // year 2024 / 2026
  { type: 'year', re: /\b(19|20)\d{2}\b/,
    build: (m) => ({ value: m[0] }) },
  // rate 3.99
  { type: 'rate', re: /\b(\d+\.\d{1,2})\b/,
    build: (m) => ({ value: m[1] }) },
];

const cur = (c) => {
  const x = String(c).toLowerCase();
  if (x.includes('aed') || x.includes('dirham') || x.includes('dh')) return 'AED';
  if (x.includes('$') || x.includes('usd') || x.includes('dollar')) return '$';
  if (x.includes('€')) return '€';
  if (x.includes('£')) return '£';
  return '';
};
const scaleSuffix = (s) => {
  if (!s) return '';
  const x = s.toLowerCase();
  if (x.startsWith('m') || x === 'mn') return 'M';
  if (x.startsWith('b') || x === 'bn') return 'B';
  if (x.startsWith('k') || x.startsWith('thous')) return 'K';
  return '';
};
const numShort = (v, scale) => String(v).replace(/,/g, '').replace(/\.0+$/, '');

/**
 * Find the strongest numeric expression in a sentence. Returns a structured
 * number { type, prefix, value, suffix, unit, label, raw } or null.
 */
export function parseBigNumber(text) {
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      const parts = p.build(m);
      return { type: p.type, prefix: '', suffix: '', unit: '', label: '', raw: m[0], ...parts };
    }
  }
  return null;
}

/** Compose display lines for a big-number hero from a structured number. */
export function bigNumberLines(n, { label = '' } = {}) {
  const main = `${n.prefix ? n.prefix + ' ' : ''}${n.value}${n.suffix || ''}`.trim();
  const lines = [{ text: main, scale: 2.1, weight: 900, accent: true }];
  const lbl = label || n.label;
  if (lbl) lines.push({ text: lbl, scale: 0.5, weight: 800, color: '#ffffff' });
  return lines;
}
