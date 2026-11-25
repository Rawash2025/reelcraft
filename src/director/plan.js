import {
  emptyEDL, makeSegment, makeCamera, makeCaption, makeBroll, makeGraphic,
  makeAudio, resetIds, validateEDL,
} from './edl.js';
import { classifyTranscript } from './classify.js';
import { attentionScore, Staleness, eventStrength, energyBySentence } from './attention.js';
import { EffectMemory } from './memory.js';
import { resolveIntensity } from './intensity.js';
import { getBrand } from '../brand/brands.js';
import { conceptForSentence } from '../engine/concepts.js';
import { log } from '../engine/log.js';

/**
 * Build an Edit Decision List from a transcript.
 *
 * Deterministic: same transcript + same settings produce the same EDL, every
 * time. Nothing here touches the store or the canvas — planning and applying
 * are separate steps so a plan can be reviewed and edited before it lands.
 */
export function planEDL({
  words,
  duration,
  aspect = '9:16',
  fps = 30,
  intensity = 'BALANCED',
  knobs = {},
  brandId = 'none',
  audioChannel = null,
  sampleRate = 0,
  gestures = [],
} = {}) {
  resetIds();
  const cfg = resolveIntensity(intensity, knobs);
  const brand = getBrand(brandId);
  const edl = emptyEDL({ duration, aspect, fps, brand: brand.id });
  edl.intensity = { preset: cfg.preset, knobs: cfg.knobs };

  if (!words?.length) {
    log.warn('plan', 'no transcript — returning an empty EDL');
    return edl;
  }

  const sentences = classifyTranscript(words);
  const energies = energyBySentence(sentences, audioChannel, sampleRate);
  const rates = sentences.map((s) => s.wordsPerSecond).sort((a, b) => a - b);
  const medianWps = rates[Math.floor(rates.length / 2)] || 3;

  const stale = new Staleness({ fullAt: cfg.preset === 'AGGRESSIVE' ? 3 : 4.5 });
  const mem = new EffectMemory({ cooldown: 2 });

  let closeStreak = 0; // consecutive tight framings, so we can breathe

  sentences.forEach((s, i) => {
    const gesture = gestureNear(gestures, s.start, s.end);
    const { score, parts } = attentionScore(s, {
      energy: energies[i],
      gesture,
      staleness: stale.at(s.start),
      medianWps,
    });

    const strength = eventStrength(score, cfg.targets);
    const seg = makeSegment({
      start: s.start,
      end: s.end,
      text: s.text,
      kind: s.kind,
      importance: score,
      attention: score,
      pace: s.wordsPerSecond > medianWps * 1.15 ? 'fast'
        : s.wordsPerSecond < medianWps * 0.85 ? 'slow' : 'medium',
      emotion: emotionFor(s.kind),
    });

    /* ---------------------------------------------------------- camera */
    if (strength !== 'none') {
      const cam = pickCamera({ kind: s.kind, strength, mem, closeStreak, cfg });
      seg.camera = cam.camera;
      seg.reason = cam.reason;
      mem.record('camera', cam.camera.type, s.start);
      stale.mark(s.start);
      closeStreak = cam.tight ? closeStreak + 1 : 0;
    } else {
      seg.camera = makeCamera({ type: 'STATIC_MEDIUM' });
      seg.reason = `attention ${score.toFixed(2)} below threshold — held the frame`;
    }

    /* --------------------------------------------------------- caption */
    const kw = s.keywords.slice(0, keywordBudget(s, cfg));
    const anim = pickCaptionAnim({ kind: s.kind, strength, mem, cfg });
    seg.caption = makeCaption({
      text: s.text,
      words: s.words,
      style: s.kind === 'HOOK' ? 'hook' : s.kind === 'CTA' ? 'cta' : 'body',
      position: 'lower_middle',
      highlight_words: kw.map((k) => k.text),
      animation: anim,
      size: s.kind === 'HOOK' ? 1.12 : 1,
    });
    mem.record('caption', anim, s.start);

    /* ---------------------------------------------------------- b-roll */
    // Cutaways go where the speaker is least interesting to look at: a pause,
    // or a stretch where nothing has changed.
    const brollWanted =
      cfg.f.broll > 0.1 &&
      (s.pauseBefore > 0.35 || stale.at(s.start) > 0.6) &&
      !mem.usedRecently('broll', 3) &&
      s.kind !== 'HOOK';
    if (brollWanted) {
      const query = brollQuery(s, brand);
      if (query) {
        const layout = mem.choose('broll', [
          'PICTURE_IN_PICTURE', 'SIDE_PANEL', 'FULLSCREEN', 'BACKGROUND',
        ]);
        seg.broll = makeBroll({
          query,
          layout,
          start: s.start,
          duration: Math.min(1.8, Math.max(0.6, s.duration * 0.7)),
          placement: layoutToPlacement(layout),
          reason: `pause ${s.pauseBefore.toFixed(2)}s / staleness ${stale.at(s.start).toFixed(2)}`,
        });
        mem.record('broll', layout, s.start);
        stale.mark(s.start);
      }
    }

    /* -------------------------------------------------------- graphics */
    const g = pickGraphic({ sentence: s, cfg, mem });
    if (g) {
      seg.graphics.push(g);
      mem.record('graphic', g.type, s.start);
      stale.mark(s.start);
    }

    /* ----------------------------------------------------------- audio */
    const sfx = [];
    if (strength === 'major' && cfg.f.sfx > 0.25 && !mem.usedRecently('sfx', 2)) {
      const pick = mem.choose('sfx', ['soft_whoosh', 'impact_soft', 'rise']);
      sfx.push(pick);
      mem.record('sfx', pick, s.start);
    }
    seg.audio = makeAudio({
      sfx,
      music_duck_db: s.kind === 'CTA' || s.kind === 'HOOK' ? -5 : -2,
    });

    edl.segments.push(seg);
  });

  const check = validateEDL(edl);
  edl.meta.validation = check;
  if (!check.ok) log.error('plan', 'EDL failed validation', check.errors);
  else if (check.warnings.length) log.info('plan', 'EDL warnings', check.warnings);

  log.info('plan', `planned ${edl.segments.length} segments`, {
    preset: cfg.preset,
    events: edl.segments.filter((s) => s.camera?.type !== 'STATIC_MEDIUM').length,
  });
  return edl;
}

/* ------------------------------------------------------------- selection */

function pickCamera({ kind, strength, mem, closeStreak, cfg }) {
  const zoom = cfg.f.zoom;

  // Too many tight shots in a row flattens the edit — force contrast.
  if (closeStreak >= 3) {
    return {
      camera: makeCamera({ type: 'STATIC_WIDE', start_scale: 1.06, end_scale: 1.0, easing: 'easeOutCubic' }),
      reason: `${closeStreak} close framings in a row — pulled out for contrast`,
      tight: false,
    };
  }

  if (strength === 'major') {
    const options = kind === 'HOOK' || kind === 'WARNING'
      ? ['PUNCH_IN', 'GESTURE_ZOOM', 'DYNAMIC_REFRAME']
      : ['PUNCH_IN', 'SLOW_PUSH_IN', 'CENTER_REFRAME', 'PUNCH_OUT'];
    const type = mem.choose('camera', options);
    const amount = 0.06 + 0.1 * zoom;
    const cam = type === 'PUNCH_OUT'
      ? makeCamera({ type, start_scale: 1 + amount, end_scale: 1, easing: 'easeOutCubic', duration: 0.4 })
      : makeCamera({ type, start_scale: 1, end_scale: 1 + amount, easing: 'easeOutCubic', duration: 0.35 });
    return { camera: cam, reason: `${kind}: strong beat, ${type.toLowerCase().replace('_', ' ')}`, tight: type !== 'PUNCH_OUT' };
  }

  const type = mem.choose('camera', ['SLOW_PUSH_IN', 'SLOW_PULL_OUT', 'PAN_LEFT', 'PAN_RIGHT']);
  const amount = 0.02 + 0.045 * zoom;
  return {
    camera: makeCamera({
      type,
      start_scale: 1,
      end_scale: type === 'SLOW_PULL_OUT' ? 1 - amount * 0.5 : 1 + amount,
      easing: 'easeInOutQuad',
    }),
    reason: `${kind}: minor beat, gentle ${type.toLowerCase().replace('_', ' ')}`,
    tight: type === 'SLOW_PUSH_IN',
  };
}

function pickCaptionAnim({ kind, strength, mem, cfg }) {
  const hot = cfg.f.caption;
  if (kind === 'NUMBER' || kind === 'STATISTIC') return 'NUMBER_SCALE';
  if (kind === 'HOOK') return hot > 0.6 ? 'KEYWORD_PUNCH' : 'PHRASE_POP';
  if (kind === 'CTA') return 'BACKGROUND_HIGHLIGHT';
  if (strength === 'none' || hot < 0.35) {
    return mem.choose('caption', ['WORD_FADE', 'WORD_HIGHLIGHT']);
  }
  return mem.choose('caption', ['WORD_POP', 'WORD_SCALE', 'WORD_HIGHLIGHT', 'PHRASE_SLIDE']);
}

function pickGraphic({ sentence, cfg, mem }) {
  const want = cfg.f.graphics;
  if (want < 0.15) return null;
  const k = sentence.kind;
  const number = sentence.keywords.find((w) => /\d/.test(w.text));

  if (k === 'STATISTIC' && number) {
    return makeGraphic({ type: 'PERCENTAGE_CARD', position: 'right', animation: 'spring',
      props: { value: number.text }, start: sentence.start, duration: Math.min(2.2, sentence.duration) });
  }
  if (k === 'NUMBER' && number && want > 0.35) {
    return makeGraphic({ type: 'NUMBER_COUNTER', position: 'right', animation: 'spring',
      props: { value: number.text }, start: sentence.start, duration: Math.min(2.2, sentence.duration) });
  }
  if (k === 'WARNING' && want > 0.3) {
    return makeGraphic({ type: 'WARNING_CARD', position: 'right', animation: 'spring',
      props: { text: 'Careful' }, start: sentence.start, duration: Math.min(1.8, sentence.duration) });
  }
  if ((k === 'LIST' || k === 'STEPS') && want > 0.3 && !mem.usedRecently('graphic', 2)) {
    return makeGraphic({ type: 'CHECKLIST', position: 'centre', animation: 'stagger',
      props: {}, start: sentence.start, duration: Math.min(3, sentence.duration) });
  }
  if (k === 'COMPARISON' && want > 0.35) {
    return makeGraphic({ type: 'COMPARISON_TABLE', position: 'centre', animation: 'slide',
      props: {}, start: sentence.start, duration: Math.min(3, sentence.duration) });
  }
  if (k === 'CTA') {
    return makeGraphic({ type: 'CTA_CARD', position: 'bottom', animation: 'spring',
      props: {}, start: sentence.start, duration: Math.min(3, sentence.duration) });
  }
  return null;
}

/* ---------------------------------------------------------------- helpers */

const emotionFor = (kind) => ({
  HOOK: 'urgent', WARNING: 'warning', PROBLEM: 'concern', BENEFIT: 'positive',
  CTA: 'invite', QUESTION: 'curious', STATISTIC: 'confident', NUMBER: 'confident',
}[kind] || 'neutral');

const layoutToPlacement = (layout) => ({
  FULLSCREEN: 'full', BACKGROUND: 'behind', PICTURE_IN_PICTURE: 'corner',
  SIDE_PANEL: 'right', SPLIT_SCREEN: 'top', MASKED_OVERLAY: 'behind',
}[layout] || 'top');

/** How many words in this sentence may be emphasised. */
function keywordBudget(sentence, cfg) {
  const base = Math.max(1, Math.round(sentence.words.length * 0.16 * (0.5 + cfg.f.caption)));
  return Math.min(base, 3);
}

/**
 * A concrete, filmable query for this sentence. Delegates to the concept engine,
 * which maps recognised topics to curated stock queries and otherwise falls back
 * to a single concrete noun — never to abstract keyword combos, which is what
 * produced irrelevant results before.
 */
function brollQuery(sentence, brand) {
  const hit = conceptForSentence(sentence.text, brand);
  return hit ? hit.query : null;
}

function gestureNear(gestures, start, end) {
  if (!gestures?.length) return 0;
  let best = 0;
  for (const g of gestures) {
    if (g.t >= start - 0.15 && g.t <= end + 0.15) best = Math.max(best, g.strength ?? 0.6);
  }
  return best;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
