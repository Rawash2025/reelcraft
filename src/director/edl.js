/**
 * The Edit Decision List.
 *
 * Every automatic edit becomes a row here before anything is drawn. The
 * renderer consumes a compiled timeline, and the compile step is a pure
 * function of this document — so the same EDL always produces the same frames,
 * and any decision can be inspected or overridden before rendering.
 *
 * Shapes are documented as JSDoc typedefs. They are checked at runtime by
 * validateEDL rather than by a compiler, because this is plain JS.
 */

/**
 * @typedef {'HOOK'|'PROBLEM'|'WARNING'|'QUESTION'|'EDUCATION'|'EXPLANATION'
 *   |'BENEFIT'|'NUMBER'|'STATISTIC'|'COMPARISON'|'LIST'|'STEPS'|'OBJECTION'
 *   |'PROOF'|'CTA'|'BRAND'} SegmentKind
 *
 * @typedef {'PUNCH_IN'|'PUNCH_OUT'|'SLOW_PUSH_IN'|'SLOW_PULL_OUT'|'PAN_LEFT'
 *   |'PAN_RIGHT'|'FACE_FOLLOW'|'GESTURE_ZOOM'|'CENTER_REFRAME'
 *   |'DYNAMIC_REFRAME'|'STATIC_CLOSE'|'STATIC_MEDIUM'|'STATIC_WIDE'} CameraKind
 *
 * @typedef {'WORD_POP'|'WORD_SCALE'|'WORD_HIGHLIGHT'|'WORD_FADE'|'PHRASE_SLIDE'
 *   |'PHRASE_POP'|'TYPE_ON'|'UNDERLINE_DRAW'|'BACKGROUND_HIGHLIGHT'
 *   |'KEYWORD_PUNCH'|'NUMBER_SCALE'} CaptionAnim
 *
 * @typedef {'FULLSCREEN'|'PICTURE_IN_PICTURE'|'SPLIT_SCREEN'|'BACKGROUND'
 *   |'SIDE_PANEL'|'MASKED_OVERLAY'} BrollLayout
 */

export const SEGMENT_KINDS = [
  'HOOK', 'PROBLEM', 'WARNING', 'QUESTION', 'EDUCATION', 'EXPLANATION',
  'BENEFIT', 'NUMBER', 'STATISTIC', 'COMPARISON', 'LIST', 'STEPS',
  'OBJECTION', 'PROOF', 'CTA', 'BRAND',
];

export const CAMERA_KINDS = [
  'PUNCH_IN', 'PUNCH_OUT', 'SLOW_PUSH_IN', 'SLOW_PULL_OUT', 'PAN_LEFT',
  'PAN_RIGHT', 'FACE_FOLLOW', 'GESTURE_ZOOM', 'CENTER_REFRAME',
  'DYNAMIC_REFRAME', 'STATIC_CLOSE', 'STATIC_MEDIUM', 'STATIC_WIDE',
];

export const CAPTION_ANIMS = [
  'WORD_POP', 'WORD_SCALE', 'WORD_HIGHLIGHT', 'WORD_FADE', 'PHRASE_SLIDE',
  'PHRASE_POP', 'TYPE_ON', 'UNDERLINE_DRAW', 'BACKGROUND_HIGHLIGHT',
  'KEYWORD_PUNCH', 'NUMBER_SCALE',
];

export const BROLL_LAYOUTS = [
  'FULLSCREEN', 'PICTURE_IN_PICTURE', 'SPLIT_SCREEN', 'BACKGROUND',
  'SIDE_PANEL', 'MASKED_OVERLAY',
];

export const GRAPHIC_KINDS = [
  'WARNING_CARD', 'NUMBER_COUNTER', 'PERCENTAGE_CARD', 'CHECKLIST',
  'COMPARISON_TABLE', 'STAT_CARD', 'APPROVAL_STAMP', 'LOWER_THIRD',
  'CTA_CARD', 'LOGO_REVEAL', 'FLOATING_ICON', 'PROGRESS_BAR',
];

export const EDL_VERSION = 1;

/* --------------------------------------------------------------- builders */

/** An empty, valid EDL for a project. */
export function emptyEDL({ duration = 0, aspect = '9:16', fps = 30, brand = null } = {}) {
  return {
    version: EDL_VERSION,
    video: { duration: round(duration), aspect_ratio: aspect, fps },
    brand,
    intensity: null,
    segments: [],
    meta: { generated_at: new Date().toISOString(), critic: null },
  };
}

let seq = 0;
export const segmentId = () => `segment_${String(++seq).padStart(3, '0')}`;
export const resetIds = () => { seq = 0; };

/**
 * Build one segment. Only `start` and `end` are required; everything else has
 * a defined default so a partial plan is still a valid EDL.
 */
export function makeSegment({
  id, start, end,
  importance = 0.5, attention = 0.5, kind = 'EXPLANATION',
  emotion = 'neutral', pace = 'medium',
  camera = null, caption = null, broll = null, graphics = [], audio = null,
  text = '', reason = '',
}) {
  return {
    id: id || segmentId(),
    start: round(start),
    end: round(end),
    importance: clamp01(importance),
    attention: clamp01(attention),
    kind,
    emotion,
    pace,
    camera,
    caption,
    broll,
    graphics,
    audio,
    text,
    // Why the director made this call — surfaced in the UI so a human can
    // disagree with the reasoning, not just the result.
    reason,
    locked: false,
  };
}

export const makeCamera = ({
  type = 'STATIC_MEDIUM', start_scale = 1, end_scale = 1,
  focus = 'face', easing = 'easeOutCubic', duration = null, x = 0, y = 0,
}) => ({ type, start_scale, end_scale, focus, easing, duration, x, y });

export const makeCaption = ({
  text = '', words = [], style = 'body', position = 'lower_middle',
  highlight_words = [], animation = 'WORD_POP', size = 1,
}) => ({ text, words, style, position, highlight_words, animation, size });

export const makeBroll = ({
  query = '', layout = 'PICTURE_IN_PICTURE', start = 0, duration = 1.2,
  asset_id = null, placement = 'top', reason = '',
}) => ({ query, layout, start: round(start), duration: round(duration), asset_id, placement, reason });

export const makeGraphic = ({
  type = 'FLOATING_ICON', position = 'right', animation = 'spring',
  props = {}, start = null, duration = null, z = 10,
}) => ({ type, position, animation, props, start, duration, z });

export const makeAudio = ({ sfx = [], music_duck_db = 0 }) => ({ sfx, music_duck_db });

/* -------------------------------------------------------------- validation */

/**
 * Check an EDL is renderable. Returns { ok, errors, warnings }.
 * Errors block rendering; warnings are surfaced but do not.
 */
export function validateEDL(edl) {
  const errors = [];
  const warnings = [];

  if (!edl || typeof edl !== 'object') return { ok: false, errors: ['EDL is not an object'], warnings };
  if (edl.version !== EDL_VERSION) warnings.push(`EDL version ${edl.version} != ${EDL_VERSION}`);
  if (!edl.video || !(edl.video.duration >= 0)) errors.push('video.duration missing');
  if (!Array.isArray(edl.segments)) return { ok: false, errors: ['segments is not an array'], warnings };

  const dur = edl.video?.duration ?? 0;
  const sorted = [...edl.segments].sort((a, b) => a.start - b.start);

  sorted.forEach((s, i) => {
    const where = s.id || `#${i}`;
    if (!(s.end > s.start)) errors.push(`${where}: end must be after start`);
    if (s.start < -0.001) errors.push(`${where}: negative start`);
    if (dur && s.end > dur + 0.25) {
      warnings.push(`${where}: extends ${round(s.end - dur)}s past the video`);
    }
    if (s.kind && !SEGMENT_KINDS.includes(s.kind)) warnings.push(`${where}: unknown kind ${s.kind}`);
    if (s.camera && !CAMERA_KINDS.includes(s.camera.type)) {
      errors.push(`${where}: unknown camera ${s.camera.type}`);
    }
    if (s.caption && !CAPTION_ANIMS.includes(s.caption.animation)) {
      warnings.push(`${where}: unknown caption animation ${s.caption.animation}`);
    }
    for (const g of s.graphics || []) {
      if (!GRAPHIC_KINDS.includes(g.type)) warnings.push(`${where}: unknown graphic ${g.type}`);
    }
    const prev = sorted[i - 1];
    if (prev && s.start < prev.end - 0.001) {
      warnings.push(`${where}: overlaps ${prev.id}`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

/** Every visual event in the EDL, flattened and time-ordered. */
export function events(edl) {
  const out = [];
  for (const s of edl.segments) {
    if (s.camera && s.camera.type !== 'STATIC_MEDIUM') {
      out.push({ t: s.start, kind: 'camera', name: s.camera.type, segment: s.id });
    }
    if (s.caption) out.push({ t: s.start, kind: 'caption', name: s.caption.animation, segment: s.id });
    if (s.broll) out.push({ t: s.broll.start, kind: 'broll', name: s.broll.layout, segment: s.id });
    for (const g of s.graphics || []) {
      out.push({ t: g.start ?? s.start, kind: 'graphic', name: g.type, segment: s.id });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Rough event density, used by the critic and the pacing rules. */
export function pacing(edl) {
  const ev = events(edl);
  const dur = edl.video?.duration || 0;
  if (!dur) return { events: ev.length, perMinute: 0, gaps: [] };
  const gaps = [];
  for (let i = 1; i < ev.length; i++) gaps.push(round(ev[i].t - ev[i - 1].t));
  return {
    events: ev.length,
    perMinute: round((ev.length / dur) * 60),
    longestGap: gaps.length ? Math.max(...gaps) : round(dur),
    gaps,
  };
}

const round = (n) => Math.round(n * 1000) / 1000;
const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
