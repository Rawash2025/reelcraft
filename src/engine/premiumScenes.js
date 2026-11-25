// Parameterised, brand-aware scene templates for premium talking-head reels.
//
// A scene is an editable overlay clip, not a baked video.  The same scene can
// be fed different copy, numbers and media while keeping the typography,
// spacing, depth and motion consistent.  drawPremiumScene is called by the
// shared canvas renderer, so live preview and local export remain WYSIWYG.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeBack = (t) => {
  const c = 1.70158;
  const p = clamp(t) - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};

export const PREMIUM_SCENES = [
  { id: 'hook-punch', name: 'Hook Punch', icon: '⚡', category: 'Typography', duration: 2.2, hideCaptions: true, blurb: 'Fast opening statement with one oversized payoff word.' },
  { id: 'kinetic-caption', name: 'Kinetic Caption', icon: 'Aa', category: 'Typography', duration: 2.4, hideCaptions: true, blurb: 'Short premium phrase with a moving accent underline.' },
  { id: 'text-behind-person', name: 'Text Behind Person', icon: '◫', category: 'Depth', duration: 2.2, hideCaptions: true, depth: true, blurb: 'Oversized word split behind and in front of the speaker.' },
  { id: 'floating-cards', name: 'Floating Cards', icon: '▱', category: 'Depth', duration: 2.8, hideCaptions: false, depth: true, media: true, blurb: 'Media cards orbit the subject with foreground depth.' },
  { id: 'bank-comparison', name: 'Bank Comparison', icon: '⇄', category: 'Mortgage', duration: 3, hideCaptions: true, blurb: 'Two clean offer cards with no automatic winner claim.' },
  { id: 'number-impact', name: 'Number Impact', icon: '#', category: 'Data', duration: 2.2, hideCaptions: true, blurb: 'Large statistic with count-up and supporting label.' },
  { id: 'problem-alert', name: 'Problem Alert', icon: '!', category: 'Message', duration: 2.2, hideCaptions: true, blurb: 'Controlled red warning treatment for a problem beat.' },
  { id: 'solution-reveal', name: 'Solution Reveal', icon: '✓', category: 'Message', duration: 2.4, hideCaptions: true, blurb: 'Olive/gold benefit reveal after a problem.' },
  { id: 'fullscreen-broll', name: 'Full-screen B-roll', icon: '▶', category: 'Media', duration: 1.8, hideCaptions: false, media: true, blurb: 'Fast full-frame pattern interrupt with a label.' },
  { id: 'split-screen', name: 'Split Screen', icon: '◧', category: 'Media', duration: 2.8, hideCaptions: true, media: true, blurb: 'Speaker-side copy and supporting media panel.' },
  { id: 'phone-ui', name: 'Phone / UI Demo', icon: '▯', category: 'Media', duration: 3, hideCaptions: true, media: true, blurb: 'Premium device mock-up for websites and calculators.' },
  { id: 'logo-orbit', name: 'Logo Orbit', icon: '◎', category: 'Depth', duration: 2.8, hideCaptions: false, depth: true, blurb: 'Bank names orbit the speaker on a subtle depth ring.' },
  { id: 'process-steps', name: 'Process Steps', icon: '123', category: 'Data', duration: 3.2, hideCaptions: true, blurb: 'Three staggered steps with an active progress line.' },
  { id: 'testimonial', name: 'Testimonial', icon: '★', category: 'Proof', duration: 3, hideCaptions: true, blurb: 'Review card with rating, quote and author.' },
  { id: 'premium-cta', name: 'Premium CTA', icon: '↗', category: 'Brand', duration: 2.8, hideCaptions: true, blurb: 'Branded end card with URL and action button.' },
];

export const getPremiumScene = (id) => PREMIUM_SCENES.find((s) => s.id === id);
export const sceneHasDepth = (clip) => !!getPremiumScene(clip.sceneType)?.depth;

export function sceneDefaults(type, brand = {}) {
  const common = { text: 'Your message here', emphasis: 'MESSAGE' };
  const defaults = {
    'hook-punch': { text: 'DON’T CHOOSE THE WRONG BANK', emphasis: 'WRONG BANK', eyebrow: 'BEFORE YOU APPLY' },
    'kinetic-caption': { text: 'Compare every mortgage option', emphasis: 'mortgage option' },
    'text-behind-person': { text: 'COMPARE', emphasis: 'CHOOSE SMARTER', eyebrow: 'MORE OPTIONS. BETTER DECISIONS.' },
    'floating-cards': { text: 'Compare offers', labels: ['DIB', 'ADIB', 'FAB', 'ENBD'], assetIds: [] },
    'bank-comparison': { text: 'COMPARE YOUR OPTIONS', leftLabel: 'OPTION A', leftValue: '3.95%', rightLabel: 'OPTION B', rightValue: '3.99%', footnote: 'Illustrative rates — eligibility and terms vary.' },
    'number-impact': { value: '80%', text: 'PROPERTY FINANCE', eyebrow: 'UP TO' },
    'problem-alert': { text: 'ONE BANK IS NOT THE WHOLE MARKET', emphasis: 'NOT THE WHOLE MARKET', eyebrow: 'COMMON MISTAKE' },
    'solution-reveal': { text: 'COMPARE. CHOOSE. MOVE IN.', emphasis: 'MOVE IN.', eyebrow: 'A SMARTER WAY TO FINANCE' },
    'fullscreen-broll': { text: 'THE RIGHT PROPERTY', assetIds: [] },
    'split-screen': { text: 'Your profile deserves the right strategy', emphasis: 'right strategy', assetIds: [] },
    'phone-ui': { text: 'CHECK YOUR ELIGIBILITY', eyebrow: 'YOUR BRAND', assetIds: [] },
    'logo-orbit': { text: 'COMPARE MORE BANKS', labels: ['FAB', 'ADIB', 'DIB', 'ENBD', 'CBD'] },
    'process-steps': { text: 'YOUR MORTGAGE JOURNEY', steps: ['ASSESS', 'COMPARE', 'APPLY'] },
    'testimonial': { quote: 'Clear advice, fast support and a smooth mortgage journey.', author: 'HAPPY CLIENT', rating: 5 },
    'premium-cta': { text: 'COMPARE. CHOOSE. MOVE IN.', cta: 'APPLY NOW', url: 'yourwebsite.com', eyebrow: 'YOUR BRAND' },
  };
  return {
    ...common,
    ...(defaults[type] || {}),
    accent: brand.captionAccent || brand.tertiary || brand.primary || '#9aad00',
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

function splitEmphasis(text, emphasis) {
  const raw = String(text || '');
  const key = String(emphasis || '').trim();
  if (!key) return [{ text: raw, hot: false }];
  const i = raw.toLowerCase().indexOf(key.toLowerCase());
  if (i < 0) return [{ text: raw, hot: false }];
  return [
    { text: raw.slice(0, i), hot: false },
    { text: raw.slice(i, i + key.length), hot: true },
    { text: raw.slice(i + key.length), hot: false },
  ].filter((p) => p.text);
}

function fitFont(ctx, text, maxWidth, start, weight = 900, family = 'Inter') {
  let size = start;
  do {
    ctx.font = `${weight} ${Math.round(size)}px ${family}, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  } while (size > 18);
  return size;
}

function drawSegmentedLine(ctx, text, emphasis, cx, cy, maxW, size, colors, opts = {}) {
  const parts = splitEmphasis(text, emphasis);
  const family = opts.family || 'Inter';
  const weight = opts.weight || 900;
  const resolved = fitFont(ctx, text, maxW, size, weight, family);
  ctx.font = `${weight} ${Math.round(resolved)}px ${family}, Arial, sans-serif`;
  const widths = parts.map((p) => ctx.measureText(p.text).width);
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (opts.stroke) {
      ctx.lineWidth = resolved * 0.055;
      ctx.strokeStyle = opts.stroke;
      ctx.strokeText(p.text, x, cy);
    }
    ctx.fillStyle = p.hot ? colors.accent : colors.text;
    ctx.fillText(p.text, x, cy);
    x += widths[i];
  }
  return resolved;
}

function drawEyebrow(ctx, text, cx, y, W, colors, alpha = 1) {
  if (!text) return;
  const size = fitFont(ctx, text, W * 0.74, W * 0.035, 800, 'Inter');
  ctx.globalAlpha *= alpha;
  ctx.font = `800 ${Math.round(size)}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${Math.max(1, W * 0.002)}px`;
  ctx.fillStyle = colors.muted;
  ctx.fillText(String(text).toUpperCase(), cx, y);
  ctx.letterSpacing = '0px';
}

function colorsFor(brand, clip) {
  return {
    accent: clip.props?.accent || brand.captionAccent || brand.tertiary || brand.primary || '#9aad00',
    primary: brand.primary || '#5c6454',
    deep: brand.deep || '#3f463a',
    gold: brand.gold || '#d6b35a',
    cream: brand.cream || '#f5f1e8',
    text: brand.text || '#ffffff',
    muted: brand.surface === 'matte' ? 'rgba(243,235,221,.78)' : 'rgba(255,255,255,.76)',
    danger: brand.surface === 'matte' ? '#B9424A' : '#e05252',
    matte: brand.surface === 'matte',
  };
}

function sceneProgress(clip, time) {
  const local = time - clip.start;
  const remaining = clip.start + clip.duration - time;
  return {
    local,
    enter: easeBack(local / 0.34),
    softEnter: easeOut(local / 0.28),
    alpha: clamp(local / 0.16) * clamp(remaining / 0.25),
    hold: clamp(local / Math.max(0.5, clip.duration)),
  };
}

function glassPanel(ctx, x, y, w, h, colors, { hot = false, alpha = 1, radius = 0.08 } = {}) {
  if (colors.matte) {
    // Signature surface: a flat olive cloth panel, soft real shadow, thin
    // champagne hairline. No glow, no gradient sheen.
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = 'rgba(8,10,6,.5)';
    ctx.shadowBlur = Math.min(w, h) * 0.1;
    ctx.shadowOffsetY = h * 0.03;
    ctx.fillStyle = colors.deep;
    roundRect(ctx, x, y, w, h, Math.min(w, h) * Math.min(radius, 0.035));
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(1.5, w * 0.0025);
    ctx.strokeStyle = hot ? colors.accent : 'rgba(199,185,149,.55)';
    roundRect(ctx, x, y, w, h, Math.min(w, h) * Math.min(radius, 0.035));
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = hot ? colors.accent : 'rgba(0,0,0,.55)';
  ctx.shadowBlur = Math.min(w, h) * (hot ? 0.22 : 0.14);
  ctx.shadowOffsetY = h * 0.04;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(24,27,22,.92)');
  g.addColorStop(1, 'rgba(8,10,8,.88)');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, Math.min(w, h) * radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeStyle = hot ? colors.accent : 'rgba(255,255,255,.2)';
  roundRect(ctx, x, y, w, h, Math.min(w, h) * radius);
  ctx.stroke();
  ctx.restore();
}

function drawMediaCover(ctx, el, x, y, w, h, radius = 0) {
  ctx.save();
  if (radius) { roundRect(ctx, x, y, w, h, radius); ctx.clip(); }
  if (el) {
    const sw = el.videoWidth || el.naturalWidth || w;
    const sh = el.videoHeight || el.naturalHeight || h;
    const sc = Math.max(w / sw, h / sh);
    try { ctx.drawImage(el, x + (w - sw * sc) / 2, y + (h - sh * sc) / 2, sw * sc, sh * sc); } catch { /* frame warming */ }
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#30372d'); g.addColorStop(1, '#0c0e0b');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawHook(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  const sc = 0.82 + clamp(p.enter, 0, 1.08) * 0.18;
  ctx.translate(W / 2, H * 0.29);
  ctx.scale(sc, sc);
  ctx.translate(-W / 2, -H * 0.29);
  drawEyebrow(ctx, props.eyebrow, W / 2, H * 0.225, W, c, p.softEnter);
  ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = H * 0.025;
  drawSegmentedLine(ctx, props.text, props.emphasis, W / 2, H * 0.3, W * 0.9, H * 0.067, c, { stroke: 'rgba(0,0,0,.5)' });
  const lineW = W * 0.5 * easeOut((p.local - 0.14) / 0.38);
  const g = ctx.createLinearGradient(W / 2 - lineW / 2, 0, W / 2 + lineW / 2, 0);
  g.addColorStop(0, 'transparent'); g.addColorStop(0.5, c.accent); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(W / 2 - lineW / 2, H * 0.35, lineW, Math.max(4, H * 0.003));
}

function drawKinetic(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  const slide = (1 - p.softEnter) * H * 0.035;
  drawSegmentedLine(ctx, props.text, props.emphasis, W / 2, H * 0.31 + slide, W * 0.84, H * 0.052, c, { stroke: 'rgba(0,0,0,.4)' });
  const pulse = 0.72 + Math.sin(p.local * 5) * 0.08;
  ctx.fillStyle = c.accent;
  roundRect(ctx, W * 0.29, H * 0.355, W * 0.42 * easeOut(p.local / 0.5), H * 0.005, H * 0.003);
  ctx.globalAlpha *= pulse; ctx.fill();
}

function drawTextBehind(ctx, W, H, clip, p, c, pass) {
  const props = clip.props || {};
  if (pass === 'behind' || pass === 'all') {
    ctx.save();
    ctx.globalAlpha *= 0.9;
    const size = fitFont(ctx, props.text || 'COMPARE', W * 1.02, H * 0.09, 900, 'Inter');
    ctx.font = `900 ${Math.round(size)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillText(String(props.text || '').toUpperCase(), W / 2, H * 0.35 + (1 - p.softEnter) * H * 0.04);
    ctx.restore();
  }
  if (pass === 'front' || pass === 'all') {
    drawEyebrow(ctx, props.eyebrow, W / 2, H * 0.22, W, c, p.softEnter);
    const size = fitFont(ctx, props.emphasis || '', W * 0.82, H * 0.047, 900, 'Inter');
    ctx.font = `900 ${Math.round(size)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c.accent;
    ctx.shadowColor = c.accent; ctx.shadowBlur = size * 0.28;
    ctx.fillText(String(props.emphasis || '').toUpperCase(), W / 2, H * 0.47);
  }
}

function drawFloatingCards(ctx, W, H, clip, p, c, media, pass) {
  const props = clip.props || {};
  const positions = [
    { x: .18, y: .34, w: .28, h: .19, r: -7, depth: 'behind' },
    { x: .82, y: .38, w: .3, h: .2, r: 7, depth: 'front' },
    { x: .22, y: .68, w: .3, h: .2, r: 5, depth: 'front' },
    { x: .78, y: .66, w: .27, h: .18, r: -5, depth: 'behind' },
  ];
  positions.forEach((pos, i) => {
    if (pass !== 'all' && pos.depth !== pass) return;
    const delay = i * 0.08;
    const ep = easeBack((p.local - delay) / 0.4);
    if (ep <= 0) return;
    const w = W * pos.w, h = H * pos.h;
    const float = Math.sin(p.local * 1.8 + i * 1.3) * H * 0.008;
    ctx.save();
    ctx.globalAlpha *= clamp((p.local - delay) / 0.18);
    ctx.translate(W * pos.x, H * pos.y + float);
    ctx.rotate((pos.r * Math.PI) / 180);
    ctx.scale(0.72 + 0.28 * clamp(ep, 0, 1.05), 0.72 + 0.28 * clamp(ep, 0, 1.05));
    glassPanel(ctx, -w / 2, -h / 2, w, h, c, { hot: i === 1, radius: .09 });
    const assetId = props.assetIds?.[i];
    if (assetId) drawMediaCover(ctx, media[assetId], -w / 2 + w * .035, -h / 2 + h * .05, w * .93, h * .72, w * .05);
    else {
      ctx.font = `900 ${Math.round(w * .14)}px Inter, Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = i === 1 ? c.accent : c.text;
      ctx.fillText(props.labels?.[i] || `CARD ${i + 1}`, 0, 0);
    }
    ctx.restore();
  });
}

function drawComparison(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  drawEyebrow(ctx, props.text, W / 2, H * 0.2, W, c, p.softEnter);
  const cards = [
    { x: .08, label: props.leftLabel, value: props.leftValue, hot: false, dx: -1 },
    { x: .52, label: props.rightLabel, value: props.rightValue, hot: true, dx: 1 },
  ];
  cards.forEach((card, i) => {
    const delay = i * .08;
    const ep = easeOut((p.local - delay) / .34);
    const w = W * .4, h = H * .2;
    const x = W * card.x + (1 - ep) * W * .18 * card.dx;
    const y = H * .25;
    glassPanel(ctx, x, y, w, h, c, { hot: card.hot, alpha: ep });
    ctx.globalAlpha = ep;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(W * .028)}px Inter, Arial, sans-serif`;
    ctx.fillStyle = c.muted; ctx.fillText(card.label || `OPTION ${i + 1}`, x + w / 2, y + h * .28);
    ctx.font = `900 ${Math.round(W * .067)}px Inter, Arial, sans-serif`;
    ctx.fillStyle = card.hot ? c.accent : c.text; ctx.fillText(card.value || '—', x + w / 2, y + h * .62);
  });
  ctx.globalAlpha = 1;
  ctx.font = `600 ${Math.round(W * .02)}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.fillText(props.footnote || '', W / 2, H * .49);
}

function drawNumber(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  drawEyebrow(ctx, props.eyebrow, W / 2, H * .2, W, c, p.softEnter);
  const raw = String(props.value || '0');
  const match = raw.match(/([\d,.]+)(.*)/);
  let display = raw;
  if (match) {
    const n = Number(match[1].replace(/,/g, ''));
    if (Number.isFinite(n)) display = `${Math.round(n * easeOut(p.local / .7)).toLocaleString()}${match[2]}`;
  }
  const size = fitFont(ctx, display, W * .9, H * .13, 900, 'Inter');
  ctx.font = `900 ${Math.round(size)}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = c.accent; ctx.shadowBlur = size * .38;
  ctx.fillStyle = c.accent; ctx.fillText(display, W / 2, H * .32);
  ctx.shadowBlur = 0;
  const labelSize = fitFont(ctx, props.text || '', W * .75, H * .035, 850, 'Inter');
  ctx.font = `850 ${Math.round(labelSize)}px Inter, Arial, sans-serif`;
  ctx.fillStyle = c.text; ctx.fillText(String(props.text || '').toUpperCase(), W / 2, H * .42);
}

function drawMessageCard(ctx, W, H, clip, p, c, kind) {
  const props = clip.props || {};
  const danger = kind === 'problem-alert';
  const hot = danger ? c.danger : c.accent;
  const w = W * .86, h = H * .2, x = (W - w) / 2;
  const y = H * .23 + (1 - p.softEnter) * H * .045;
  const cc = { ...c, accent: hot };
  glassPanel(ctx, x, y, w, h, cc, { hot: true, alpha: p.softEnter, radius: .06 });
  const badge = H * .048;
  ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(W / 2, y, badge, 0, Math.PI * 2); ctx.fill();
  ctx.font = `900 ${Math.round(badge * .9)}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0b0d0a';
  ctx.fillText(danger ? '!' : '✓', W / 2, y + 2);
  drawEyebrow(ctx, props.eyebrow, W / 2, y + h * .28, W, c, p.softEnter);
  drawSegmentedLine(ctx, props.text, props.emphasis, W / 2, y + h * .62, w * .88, H * .043, cc, { stroke: 'rgba(0,0,0,.45)' });
}

function drawFullscreenBroll(ctx, W, H, clip, p, c, media) {
  const assetId = clip.props?.assetIds?.[0];
  ctx.save();
  const sc = 1.08 - .08 * p.softEnter;
  ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
  drawMediaCover(ctx, media[assetId], 0, 0, W, H);
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.18)'); g.addColorStop(.58, 'rgba(0,0,0,.05)'); g.addColorStop(1, 'rgba(0,0,0,.72)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawSegmentedLine(ctx, clip.props?.text, clip.props?.emphasis, W / 2, H * .78, W * .84, H * .052, c, { stroke: 'rgba(0,0,0,.7)' });
}

function drawSplit(ctx, W, H, clip, p, c, media) {
  const props = clip.props || {};
  const gap = W * .025, w = W * .42, h = H * .43, y = H * .2;
  const lx = W * .06 - (1 - p.softEnter) * W * .14;
  const rx = W * .52 + (1 - p.softEnter) * W * .14;
  glassPanel(ctx, lx, y, w, h, c, { hot: false, alpha: p.softEnter });
  drawSegmentedLine(ctx, props.text, props.emphasis, lx + w / 2, y + h * .48, w * .8, H * .038, c);
  glassPanel(ctx, rx, y, w, h, c, { hot: true, alpha: p.softEnter });
  drawMediaCover(ctx, media[props.assetIds?.[0]], rx + w * .035, y + h * .03, w * .93, h * .94, w * .04);
}

function drawPhone(ctx, W, H, clip, p, c, media) {
  const props = clip.props || {};
  drawEyebrow(ctx, props.eyebrow, W / 2, H * .16, W, c, p.softEnter);
  const h = H * .52, w = h * .5, x = (W - w) / 2, y = H * .22;
  const ep = clamp(p.enter, 0, 1.04);
  ctx.save(); ctx.translate(W / 2, y + h / 2); ctx.scale(.82 + .18 * ep, .82 + .18 * ep); ctx.translate(-W / 2, -(y + h / 2));
  ctx.shadowColor = c.accent; ctx.shadowBlur = w * .18;
  ctx.fillStyle = '#050605'; roundRect(ctx, x, y, w, h, w * .12); ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = w * .025; ctx.strokeStyle = c.gold; roundRect(ctx, x, y, w, h, w * .12); ctx.stroke();
  drawMediaCover(ctx, media[props.assetIds?.[0]], x + w * .055, y + h * .035, w * .89, h * .93, w * .08);
  ctx.fillStyle = '#050605'; roundRect(ctx, W / 2 - w * .19, y + h * .025, w * .38, h * .025, h * .02); ctx.fill();
  ctx.restore();
  drawSegmentedLine(ctx, props.text, props.emphasis, W / 2, H * .81, W * .8, H * .041, c, { stroke: 'rgba(0,0,0,.5)' });
}

function drawLogoOrbit(ctx, W, H, clip, p, c, pass) {
  const labels = clip.props?.labels || [];
  const cx = W / 2, cy = H * .43, rx = W * .37, ry = H * .22;
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = W * .002;
  if (pass === 'behind' || pass === 'all') { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
  labels.forEach((label, i) => {
    const a = (i / Math.max(1, labels.length)) * Math.PI * 2 + p.local * .22;
    const front = Math.sin(a) >= 0;
    const depth = front ? 'front' : 'behind';
    if (pass !== 'all' && pass !== depth) return;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    const s = front ? 1 : .78;
    const r = W * .068 * s;
    ctx.save(); ctx.globalAlpha *= front ? 1 : .7;
    glassPanel(ctx, x - r, y - r, r * 2, r * 2, c, { hot: i === 0, alpha: p.softEnter, radius: .5 });
    ctx.font = `900 ${Math.round(r * .52)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = i === 0 ? c.accent : c.text;
    ctx.fillText(label, x, y); ctx.restore();
  });
  if (pass === 'front' || pass === 'all') drawEyebrow(ctx, clip.props?.text, W / 2, H * .17, W, c, p.softEnter);
}

function drawSteps(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  drawEyebrow(ctx, props.text, W / 2, H * .19, W, c, p.softEnter);
  const steps = (props.steps || ['ASSESS', 'COMPARE', 'APPLY']).slice(0, 4);
  const x0 = W * .1, y = H * .3, w = W * .8, rowH = H * .085;
  ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(ctx, x0 + W * .043, y, W * .006, rowH * (steps.length - 1), W * .003); ctx.fill();
  steps.forEach((label, i) => {
    const ep = easeOut((p.local - i * .13) / .34);
    if (ep <= 0) return;
    const cy = y + i * rowH;
    ctx.save(); ctx.globalAlpha = ep;
    ctx.fillStyle = i === Math.min(steps.length - 1, Math.floor(p.hold * steps.length)) ? c.accent : c.primary;
    ctx.beginPath(); ctx.arc(x0 + W * .046, cy, W * .038, 0, Math.PI * 2); ctx.fill();
    ctx.font = `900 ${Math.round(W * .03)}px Inter, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#090b08'; ctx.fillText(String(i + 1), x0 + W * .046, cy);
    glassPanel(ctx, x0 + W * .11, cy - rowH * .34, w - W * .11, rowH * .68, c, { hot: false, alpha: ep, radius: .12 });
    ctx.font = `850 ${Math.round(W * .032)}px Inter, Arial, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = c.text; ctx.fillText(label, x0 + W * .16, cy);
    ctx.restore();
  });
}

function drawTestimonial(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  const w = W * .84, h = H * .3, x = (W - w) / 2, y = H * .25 + (1 - p.softEnter) * H * .04;
  glassPanel(ctx, x, y, w, h, c, { hot: true, alpha: p.softEnter, radius: .07 });
  ctx.font = `900 ${Math.round(W * .05)}px Inter, Arial, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = c.gold;
  ctx.fillText('★'.repeat(clamp(props.rating || 5, 1, 5)), x + w * .08, y + h * .22);
  const quote = `“${props.quote || ''}”`;
  const size = fitFont(ctx, quote, w * .82, H * .035, 750, 'Inter');
  ctx.font = `750 ${Math.round(size)}px Inter, Arial, sans-serif`; ctx.fillStyle = c.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(quote, W / 2, y + h * .52);
  ctx.font = `800 ${Math.round(W * .024)}px Inter, Arial, sans-serif`; ctx.fillStyle = c.accent;
  ctx.fillText(props.author || 'CLIENT', W / 2, y + h * .78);
}

function drawCTA(ctx, W, H, clip, p, c) {
  const props = clip.props || {};
  const y = H * .25;
  drawEyebrow(ctx, props.eyebrow, W / 2, y, W, c, p.softEnter);
  drawSegmentedLine(ctx, props.text, props.emphasis || 'MOVE IN.', W / 2, y + H * .09, W * .86, H * .052, c, { stroke: 'rgba(0,0,0,.55)' });
  const bw = W * .52, bh = H * .065, bx = (W - bw) / 2, by = y + H * .16;
  ctx.shadowColor = c.accent; ctx.shadowBlur = bh * .6;
  ctx.fillStyle = c.accent; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = `900 ${Math.round(H * .023)}px Inter, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0b0d0a';
  ctx.fillText(props.cta || 'APPLY NOW', W / 2, by + bh / 2);
  ctx.font = `700 ${Math.round(W * .027)}px Inter, Arial, sans-serif`; ctx.fillStyle = c.text;
  ctx.fillText(props.url || 'yourwebsite.com', W / 2, by + bh + H * .045);
}

/** Draw a premium scene. pass is all|behind|front for subject-depth scenes. */
export function drawPremiumScene(ctx, W, H, clip, time, brand = {}, media = {}, pass = 'all') {
  if (time < clip.start || time > clip.start + clip.duration) return;
  const p = sceneProgress(clip, time);
  if (p.alpha <= .001) return;
  const c = colorsFor(brand, clip);
  const depth = sceneHasDepth(clip);
  if (!depth && pass === 'behind') return;
  if (!depth && pass === 'all') pass = 'front';

  ctx.save();
  ctx.globalAlpha = p.alpha;
  switch (clip.sceneType) {
    case 'hook-punch': if (pass === 'front') drawHook(ctx, W, H, clip, p, c); break;
    case 'kinetic-caption': if (pass === 'front') drawKinetic(ctx, W, H, clip, p, c); break;
    case 'text-behind-person': drawTextBehind(ctx, W, H, clip, p, c, pass); break;
    case 'floating-cards': drawFloatingCards(ctx, W, H, clip, p, c, media, pass); break;
    case 'bank-comparison': if (pass === 'front') drawComparison(ctx, W, H, clip, p, c); break;
    case 'number-impact': if (pass === 'front') drawNumber(ctx, W, H, clip, p, c); break;
    case 'problem-alert':
    case 'solution-reveal': if (pass === 'front') drawMessageCard(ctx, W, H, clip, p, c, clip.sceneType); break;
    case 'fullscreen-broll': if (pass === 'front') drawFullscreenBroll(ctx, W, H, clip, p, c, media); break;
    case 'split-screen': if (pass === 'front') drawSplit(ctx, W, H, clip, p, c, media); break;
    case 'phone-ui': if (pass === 'front') drawPhone(ctx, W, H, clip, p, c, media); break;
    case 'logo-orbit': drawLogoOrbit(ctx, W, H, clip, p, c, pass); break;
    case 'process-steps': if (pass === 'front') drawSteps(ctx, W, H, clip, p, c); break;
    case 'testimonial': if (pass === 'front') drawTestimonial(ctx, W, H, clip, p, c); break;
    case 'premium-cta': if (pass === 'front') drawCTA(ctx, W, H, clip, p, c); break;
    default: break;
  }
  ctx.restore();
}
