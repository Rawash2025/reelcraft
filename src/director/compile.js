/**
 * Compile an EDL into the existing editor timeline.
 *
 * This is the single bridge between the director's plan and everything the
 * renderer already knows how to draw. It reuses the store's own operations, so
 * an EDL-driven edit is indistinguishable from a hand edit and stays fully
 * editable afterwards.
 *
 * Deterministic given the same EDL and the same media, except for B-roll
 * fetches (network) — those are optional and skipped when `fetchBroll` is off.
 */
import { useEditor } from '../store/editorStore.js';
import { runTool } from '../agent/tools.js';
import { log } from '../engine/log.js';

// EDL camera verbs -> the motion patterns the renderer already supports.
const CAMERA_TO_MOTION = {
  PUNCH_IN: (c) => ({ type: 'punch', from: c.end_scale, to: 1, duration: c.duration || 0.35 }),
  GESTURE_ZOOM: (c) => ({ type: 'punch', from: c.end_scale, to: 1, duration: 0.3 }),
  DYNAMIC_REFRAME: (c) => ({ type: 'punch', from: c.end_scale, to: 1, duration: 0.4 }),
  CENTER_REFRAME: (c) => ({ type: 'punch', from: c.end_scale, to: 1, duration: 0.4 }),
  PUNCH_OUT: (c) => ({ type: 'push', from: c.start_scale, to: 1, duration: c.duration || 0.4 }),
  SLOW_PUSH_IN: (c) => ({ type: 'push', from: 1, to: c.end_scale, duration: c.duration || 1.2 }),
  SLOW_PULL_OUT: (c) => ({ type: 'push', from: c.start_scale, to: c.end_scale, duration: 1.2 }),
  PAN_LEFT: () => ({ type: 'kenburns', from: 1.06, to: 1.06, dx: -0.12, dy: 0, duration: 1.2 }),
  PAN_RIGHT: () => ({ type: 'kenburns', from: 1.06, to: 1.06, dx: 0.12, dy: 0, duration: 1.2 }),
  FACE_FOLLOW: () => ({ type: 'kenburns', from: 1.08, to: 1.08, dx: 0, dy: 0, duration: 1.2 }),
};

// EDL caption animations -> the caption styles that already exist. Several EDL
// verbs map to one style plus an emphasis behaviour; the mapping is explicit so
// nothing is silently dropped.
const CAPTION_TO_STYLE = {
  KEYWORD_PUNCH: 'bold-pop', WORD_POP: 'bold-pop', PHRASE_POP: 'bold-pop',
  WORD_SCALE: 'impact', NUMBER_SCALE: 'impact',
  WORD_HIGHLIGHT: 'boxed', BACKGROUND_HIGHLIGHT: 'boxed',
  PHRASE_SLIDE: 'gradient', WORD_FADE: 'minimal', TYPE_ON: 'typewriter',
  UNDERLINE_DRAW: 'minimal',
};

/**
 * Apply an EDL to the store. Returns a report of what landed.
 *
 * @param edl        the plan
 * @param opts.assetId       main video asset (defaults to first video)
 * @param opts.fetchBroll    download and place B-roll (needs Pexels key)
 * @param opts.onStep        progress callback
 */
export async function compileEDL(edl, {
  assetId = null,
  fetchBroll = false,
  onStep = () => {},
} = {}) {
  const store = useEditor.getState();
  const asset =
    store.assets.find((a) => a.id === assetId) ||
    store.assets.find((a) => a.type === 'video') ||
    store.assets[0];
  if (!asset) throw new Error('No video to compile onto.');

  const report = { motions: 0, captions: 0, broll: 0, graphics: 0, scenes: 0, sfx: 0, cuts: 0, errors: [] };
  const step = (label) => onStep({ label });

  // 1. Captions come from the EDL's own word list, merged across segments, so
  //    the timeline caption track carries exactly what was planned.
  step('Applying captions');
  const words = [];
  const highlights = new Set();
  for (const s of edl.segments) {
    if (!s.caption?.words) continue;
    for (const w of s.caption.words) words.push({ ...w });
    for (const hw of s.caption.highlight_words || []) highlights.add(norm(hw));
  }
  if (words.length) {
    store.setWords(words);
    // Mark emphasis in one pass rather than per-segment thrash.
    const emphTerms = [...highlights];
    if (emphTerms.length) store.emphasizeWords(emphTerms);
    report.captions = words.length;

    // Dominant caption style = the one the most segments asked for.
    const styleVote = {};
    for (const s of edl.segments) {
      const st = CAPTION_TO_STYLE[s.caption?.animation] || 'bold-pop';
      styleVote[st] = (styleVote[st] || 0) + 1;
    }
    const style = Object.entries(styleVote).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bold-pop';
    store.commitCaptions({ styleId: style, enabled: true }, 'edl captions');
  }

  // 2. Cut the video at segment boundaries, then attach each segment's motion
  //    to its clip. Cutting first means motion lands on real clip objects.
  step('Cutting to segments');
  const boundaries = edl.segments.map((s) => s.start).filter((t) => t > 0.08).sort((a, b) => a - b);
  const fresh = useEditor.getState();
  fresh.commit((state) => {
    const tracks = state.tracks.map((t) => {
      if (t.kind !== 'video') return t;
      // Rebuild the video track as one clip per segment, referencing the take.
      const src = t.clips.find((c) => c.assetId === asset.id) || t.clips[0];
      if (!src) return t;
      const clips = [];
      for (let i = 0; i < edl.segments.length; i++) {
        const seg = edl.segments[i];
        const segEnd = edl.segments[i + 1]?.start ?? seg.end;
        const dur = Math.max(0.15, segEnd - seg.start);
        clips.push({
          ...src,
          id: `${src.id}_s${i}`,
          start: seg.start,
          duration: dur,
          in: (src.in || 0) + seg.start,
          motion: motionFor(seg.camera),
          _segment: seg.id,
        });
      }
      return { ...t, clips };
    });
    return { tracks };
  }, 'edl cut');
  report.cuts = boundaries.length;
  report.motions = edl.segments.filter((s) => motionFor(s.camera)).length;

  // 3. Transition + finish + accent from the plan's brand/intensity.
  if (edl.brand && edl.brand !== 'none') {
    useEditor.getState().setBrand(edl.brand);
    try { await runTool('set_accent', { hex: accentFor(edl) }); } catch (e) { report.errors.push(e.message); }
  }

  // 4. Graphics -> parameterised premium scenes. These are complete,
  //    brand-aware compositions (type, motion, depth and safe layout), not a
  //    row of generic cards standing in for every idea.
  step('Building premium scenes');
  const firstHook = edl.segments.find((s) => s.kind === 'HOOK');
  if (firstHook) {
    const keyword = firstHook.caption?.highlight_words?.[0] || firstHook.text.split(/\s+/).slice(-2).join(' ');
    useEditor.getState().addPremiumScene('hook-punch', {
      start: firstHook.start,
      duration: Math.min(2.4, Math.max(1.2, firstHook.end - firstHook.start + .25)),
      props: { text: firstHook.text, emphasis: keyword, eyebrow: 'BEFORE YOU DECIDE' },
    });
    report.scenes++;
  }
  for (const s of edl.segments) {
    for (const g of s.graphics || []) {
      const built = graphicToPremium(g, s, edl.brand);
      if (!built) { report.errors.push(`graphic ${g.type} not yet drawable`); continue; }
      try {
        useEditor.getState().addPremiumScene(built.type, {
          start: g.start ?? s.start,
          duration: g.duration ?? Math.min(3, s.end - s.start),
          props: built.props,
        });
        report.graphics++;
        report.scenes++;
      } catch (e) { report.errors.push(e.message); }
    }
  }

  // 5. Sound design driven by the EDL's own sfx marks.
  step('Sound design');
  const sfxCount = edl.segments.reduce((n, s) => n + (s.audio?.sfx?.length || 0), 0);
  if (sfxCount) {
    try {
      const hookSeg = edl.segments.find((s) => s.kind === 'HOOK');
      await runTool('add_sound_design', { intensity: Math.min(1.4, 0.6 + sfxCount / edl.segments.length), hook_at: hookSeg ? hookSeg.start + 0.1 : 0 });
      report.sfx = sfxCount;
    } catch (e) { report.errors.push(e.message); }
  }

  // 6. B-roll — optional, network. Uses the existing Pexels tools.
  if (fetchBroll) {
    step('Fetching B-roll');
    for (const s of edl.segments) {
      if (!s.broll?.query) continue;
      try {
        const found = await runTool('search_broll', { query: s.broll.query, count: 2 });
        const first = found.results?.[0];
        if (!first) continue;
        await runTool('add_broll', {
          result_id: first.id,
          start: s.broll.start,
          duration: s.broll.duration,
          placement: s.broll.placement,
        });
        report.broll++;
      } catch (e) { report.errors.push(`broll "${s.broll.query}": ${e.message}`); }
    }
  }

  useEditor.getState().refreshDerived?.();
  log.info('compile', 'EDL applied', report);
  return report;
}

/* ---------------------------------------------------------------- helpers */

function motionFor(camera) {
  if (!camera || camera.type === 'STATIC_MEDIUM' || camera.type === 'STATIC_CLOSE' || camera.type === 'STATIC_WIDE') {
    return null;
  }
  const fn = CAMERA_TO_MOTION[camera.type];
  return fn ? fn(camera) : null;
}

function graphicToPremium(g, seg, brandId) {
  const value = String(g.props?.value || '');
  const words = seg.text.split(/\s+/).filter(Boolean);
  const emphasis = seg.caption?.highlight_words?.[0] || words.slice(-2).join(' ');
  switch (g.type) {
    case 'CHECKLIST':
      return { type: 'process-steps', props: { text: seg.text, steps: inferSteps(seg.text) } };
    case 'WARNING_CARD':
      return { type: 'problem-alert', props: { text: seg.text, emphasis, eyebrow: g.props?.text || 'COMMON MISTAKE' } };
    case 'PERCENTAGE_CARD':
    case 'NUMBER_COUNTER':
    case 'STAT_CARD':
      return { type: 'number-impact', props: { value, text: seg.text.replace(value, '').trim(), eyebrow: 'THE NUMBER TO KNOW' } };
    case 'CTA_CARD':
      return { type: 'premium-cta', props: {
        text: seg.text || 'Compare. Choose. Move in.', emphasis,
        eyebrow: brandId === 'olive' ? 'YOUR BRAND' : 'TAKE THE NEXT STEP',
        cta: brandId === 'olive' ? 'APPLY NOW' : 'LEARN MORE',
        url: brandId === 'olive' ? 'yourwebsite.com' : '',
      } };
    case 'COMPARISON_TABLE':
      return { type: 'bank-comparison', props: {
        text: seg.text, leftLabel: 'OPTION A', leftValue: 'COMPARE',
        rightLabel: 'OPTION B', rightValue: 'COMPARE',
        footnote: 'Illustrative comparison — eligibility and terms vary.',
      } };
    default:
      return null;
  }
}

function inferSteps(text) {
  const chunks = String(text).split(/(?:,|;|\bthen\b|\bnext\b|\band\b)/i)
    .map((s) => s.trim()).filter(Boolean);
  if (chunks.length >= 2) return chunks.slice(0, 3).map((s) => s.split(/\s+/).slice(0, 3).join(' ').toUpperCase());
  return ['ASSESS', 'COMPARE', 'APPLY'];
}

function accentFor(edl) {
  // Import lazily to avoid a cycle; brand colours live in the brand module.
  const map = { olive: '#9aad00', none: '#7c5cff' };
  return map[edl.brand] || '#7c5cff';
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
