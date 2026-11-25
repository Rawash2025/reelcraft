// Emoji icons attached to keywords, rendered above the word as it lands.
//
// This is the "icons mixed with words" effect: a 💰 that pops in over the word
// "money", a ⚠️ over "warning". Rendered with the caption so it stays in sync
// with the word timing, and pulled from a concept map so the director does not
// have to place them by hand.

const ICON_MAP = [
  [/\b(money|cash|dirhams?|dollars?|aed|price|cost|pay|paid)\b/i, '💰'],
  [/\b(save|saving|savings|discount|cheaper)\b/i, '💸'],
  [/\b(mortgage|loan|finance|financing)\b/i, '🏦'],
  [/\b(home|house|property|apartment|villa)\b/i, '🏠'],
  [/\b(keys?|handover|move)\b/i, '🔑'],
  [/\b(bank|banks)\b/i, '🏦'],
  [/\b(rate|rates|interest|percent|percentage|%)\b/i, '📊'],
  [/\b(document|documents|paperwork|contract|form|sign)\b/i, '📄'],
  [/\b(approve|approved|approval|eligible|qualify)\b/i, '✅'],
  [/\b(reject|rejected|denied|declined)\b/i, '❌'],
  [/\b(warning|careful|dont|avoid|risk|mistake|beware)\b/i, '⚠️'],
  [/\b(fast|quick|speed|instant|now)\b/i, '⚡'],
  [/\b(grow|growth|increase|rise|up|boost|profit)\b/i, '📈'],
  [/\b(down|drop|fall|decrease|lose|loss)\b/i, '📉'],
  [/\b(time|days?|weeks?|months?|years?|deadline)\b/i, '⏰'],
  [/\b(idea|tip|secret|smart|clever)\b/i, '💡'],
  [/\b(fire|hot|trending|viral)\b/i, '🔥'],
  [/\b(target|goal|aim|focus)\b/i, '🎯'],
  [/\b(call|phone|contact|whatsapp|dm|message)\b/i, '📱'],
  [/\b(win|winner|success|achieve|best)\b/i, '🏆'],
  [/\b(free|bonus|gift|offer)\b/i, '🎁'],
  [/\b(number|first|one|1)\b/i, '1️⃣'],
  [/\b(dubai|uae|emirates)\b/i, '🌆'],
];

/** Best icon for a word, or null. */
export function iconForWord(text) {
  const t = String(text || '');
  for (const [re, icon] of ICON_MAP) if (re.test(t)) return icon;
  return null;
}

/**
 * Attach icons to a word list. Only emphasised words get one, and only the
 * first occurrence of each icon, so the effect stays sparing.
 */
export function attachIcons(words, { onlyEmphasised = true, max = 6 } = {}) {
  const used = new Set();
  let n = 0;
  return words.map((w) => {
    if (n >= max) return w;
    if (onlyEmphasised && !w.emph) return w;
    const icon = iconForWord(w.text);
    if (!icon || used.has(icon)) return w;
    used.add(icon);
    n++;
    return { ...w, icon };
  });
}
