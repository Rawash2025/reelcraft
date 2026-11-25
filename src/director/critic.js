/**
 * The edit critic.
 *
 * A second pass over a finished EDL that looks for the failure modes a human
 * editor would catch: a weak opening, a dead stretch, the same effect on repeat,
 * captions that never emphasise the point. It returns findings AND a revised
 * EDL, because the brief requires the critic to modify the plan before render.
 *
 * It is deterministic and runs with no API key. A model, when present, can add
 * findings — but the structural checks below always run.
 */
import { events, pacing, validateEDL } from './edl.js';

export function critique(edl, cfg) {
  const findings = [];
  const revised = structuredClone(edl);
  const segs = revised.segments;
  const dur = revised.video?.duration || 0;
  const targets = cfg?.targets || { eventsPerMinute: 50, majorEvery: [3, 5] };

  /* 1. The first two seconds decide everything. */
  const opener = segs[0];
  if (opener) {
    const hasMove = opener.camera && opener.camera.type !== 'STATIC_MEDIUM';
    const strongCap = opener.caption && ['KEYWORD_PUNCH', 'PHRASE_POP', 'WORD_POP'].includes(opener.caption.animation);
    if (!hasMove || !strongCap) {
      findings.push({ severity: 'high', at: opener.start, msg: 'Weak opening — the first line needs a push-in and a strong caption.' });
      opener.camera = { type: 'PUNCH_IN', start_scale: 1, end_scale: 1.12, focus: 'face', easing: 'easeOutCubic', duration: 0.35 };
      if (opener.caption) opener.caption.animation = 'KEYWORD_PUNCH';
      opener.reason = (opener.reason || '') + ' | critic: strengthened the hook';
    }
  }

  /* 2. Visual stagnation — any gap longer than the target ceiling. */
  const ev = events(revised);
  const ceiling = targets.majorEvery[1] * 1.6;
  for (let i = 1; i < ev.length; i++) {
    const gap = ev[i].t - ev[i - 1].t;
    if (gap > ceiling) {
      findings.push({ severity: 'medium', at: ev[i - 1].t, msg: `Dead stretch of ${gap.toFixed(1)}s — added a gentle push to break it.` });
      const seg = nearestSegment(segs, (ev[i - 1].t + ev[i].t) / 2);
      if (seg && (!seg.camera || seg.camera.type === 'STATIC_MEDIUM')) {
        seg.camera = { type: 'SLOW_PUSH_IN', start_scale: 1, end_scale: 1.04, focus: 'face', easing: 'easeInOutQuad' };
        seg.reason = (seg.reason || '') + ' | critic: filled a dead stretch';
      }
    }
  }

  /* 3. Too many effects, or the same one repeated. */
  const p = pacing(revised);
  if (p.perMinute > targets.eventsPerMinute * 1.6) {
    findings.push({ severity: 'medium', at: 0, msg: `Over-edited: ${p.perMinute}/min vs target ${targets.eventsPerMinute}. Thinning minor camera moves.` });
    thinMinorCameras(segs);
  }
  flagRuns(segs, findings);

  /* 4. Are the key statements emphasised? */
  const keySegs = segs.filter((s) => ['HOOK', 'CTA', 'STATISTIC', 'NUMBER', 'WARNING'].includes(s.kind));
  const unemphasised = keySegs.filter((s) => !s.caption || !s.caption.highlight_words?.length);
  if (unemphasised.length) {
    findings.push({ severity: 'medium', at: unemphasised[0].start, msg: `${unemphasised.length} key line(s) had no highlighted word.` });
  }

  /* 5. Is there a CTA at all? */
  if (dur > 12 && !segs.some((s) => s.kind === 'CTA')) {
    findings.push({ severity: 'low', at: dur, msg: 'No call-to-action detected. Consider adding one at the end.' });
  }

  /* 6. Captions covering the face — all captions live low, so just confirm. */
  const highCaptions = segs.filter((s) => s.caption && s.caption.position === 'centre');
  if (highCaptions.length) {
    findings.push({ severity: 'low', at: highCaptions[0].start, msg: 'Some captions sit centre-frame and may cover the face.' });
  }

  revised.meta.critic = {
    ran_at: new Date().toISOString(),
    findings,
    pacing: pacing(revised),
    validation: validateEDL(revised),
  };
  return { edl: revised, findings };
}

function nearestSegment(segs, t) {
  let best = null; let bestD = Infinity;
  for (const s of segs) {
    const mid = (s.start + s.end) / 2;
    const d = Math.abs(mid - t);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function thinMinorCameras(segs) {
  // Drop every other non-major camera move to reduce density without touching
  // hooks, CTAs or anything the planner marked important.
  let drop = false;
  for (const s of segs) {
    if (s.camera && ['SLOW_PUSH_IN', 'SLOW_PULL_OUT', 'PAN_LEFT', 'PAN_RIGHT'].includes(s.camera.type) && s.importance < 0.6) {
      if (drop) { s.camera = { type: 'STATIC_MEDIUM', start_scale: 1, end_scale: 1, focus: 'face', easing: 'linear' }; s.reason += ' | critic: thinned'; }
      drop = !drop;
    }
  }
}

function flagRuns(segs, findings) {
  let runType = null; let run = 0;
  for (const s of segs) {
    const t = s.camera?.type;
    if (t && t === runType && t !== 'STATIC_MEDIUM') {
      run++;
      if (run >= 3) {
        findings.push({ severity: 'medium', at: s.start, msg: `Three ${t} moves in a row — swap one for contrast.` });
        run = 0;
      }
    } else { runType = t; run = 1; }
  }
}
