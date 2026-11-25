import { nanoid } from 'nanoid';
import { useEditor } from '../store/editorStore.js';
import { detectSilences, detectBeats, invertRanges, snapToBeat } from '../engine/analyze.js';
import { CAPTION_STYLES } from '../engine/captionStyles.js';
import { TEMPLATES } from '../engine/templates.js';
import { FILTERS } from '../engine/filters.js';
import { enhanceVoice, VOICE_PRESETS } from '../engine/audioFx.js';
import { searchBroll, fetchBrollAsset } from '../engine/pexels.js';
import { conceptQueries } from '../engine/concepts.js';
import { brollQueriesAI } from '../director/brollAI.js';
import { loadPilotCfg } from './pilotCfg.js';
import { toSentences } from '../director/classify.js';
import { getBrand } from '../brand/brands.js';
import { FRAME_STYLES, BROLL_PLACEMENTS, BROLL_ANIMS } from '../engine/layers.js';
import { initSegmenter } from '../engine/segment.js';
import { FINISH_PRESETS } from '../engine/finish.js';
import { renderSfxBed, renderMusicBed } from '../engine/sfx.js';

const ids = (arr) => arr.map((x) => x.id);

// Analysis results are cached per asset — silence detection decodes the whole
// file, and the director will ask for it more than once.
const analysisCache = new Map();

// Last search_broll page, so add_broll can resolve an id without re-querying.
const brollResults = new Map();

/**
 * The editor's capabilities, described once. Each entry carries the JSON schema
 * Claude sees and the function that actually performs the edit, so there is no
 * way for the two to drift apart.
 */
export const TOOLS = {
  get_project: {
    description:
      'Read the current project: clips on the timeline, transcript, caption settings, assets. Call this first, and again after edits when you need to see the result.',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => useEditor.getState().summary(),
  },

  analyze_speech: {
    description:
      'Detect silent gaps in an asset (pauses, breaths, filler). Returns the gaps and how much time removing them would save. Read-only — it changes nothing.',
    schema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'Asset to analyse.' },
        min_silence: {
          type: 'number',
          description: 'Shortest gap to count, in seconds. 0.28 is natural; 0.15 is aggressive.',
        },
        sensitivity: {
          type: 'number',
          description: '0 to 1. Higher treats quieter audio as speech. Default 0.5.',
        },
      },
      required: ['asset_id'],
      additionalProperties: false,
    },
    run: async ({ asset_id, min_silence = 0.28, sensitivity = 0.5 }) => {
      const asset = useEditor.getState().assets.find((a) => a.id === asset_id);
      if (!asset) throw new Error(`No asset ${asset_id}`);
      const key = `${asset_id}:${min_silence}:${sensitivity}`;
      if (!analysisCache.has(key))
        analysisCache.set(
          key,
          await detectSilences(asset.file, { minSilence: min_silence, sensitivity })
        );
      const { silences, duration } = analysisCache.get(key);
      const removed = silences.reduce((a, s) => a + (s.end - s.start), 0);
      return {
        duration: +duration.toFixed(2),
        gaps: silences.length,
        seconds_removable: +removed.toFixed(2),
        resulting_duration: +(duration - removed).toFixed(2),
        longest_gaps: silences
          .slice()
          .sort((a, b) => b.end - b.start - (a.end - a.start))
          .slice(0, 5)
          .map((s) => ({ at: s.start, length: +(s.end - s.start).toFixed(2) })),
      };
    },
  },

  remove_silences: {
    description:
      'Cut the silent gaps out of an asset, leaving jump cuts. Caption timings are remapped automatically. This is the backbone of a fast-cut edit.',
    schema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        min_silence: { type: 'number', description: 'Shortest gap to remove, seconds. Default 0.28.' },
        padding: { type: 'number', description: 'Air left around speech, seconds. Default 0.06.' },
        sensitivity: { type: 'number' },
      },
      required: ['asset_id'],
      additionalProperties: false,
    },
    run: async ({ asset_id, min_silence = 0.28, padding = 0.06, sensitivity = 0.5 }) => {
      const asset = useEditor.getState().assets.find((a) => a.id === asset_id);
      if (!asset) throw new Error(`No asset ${asset_id}`);
      const { silences, duration } = await detectSilences(asset.file, {
        minSilence: min_silence,
        padding,
        sensitivity,
      });
      const keep = invertRanges(silences, duration);
      if (!keep.length) throw new Error('Nothing left after cutting — loosen min_silence.');
      const n = useEditor.getState().applyKeepRanges(asset_id, keep);
      return {
        cuts_made: n,
        removed_seconds: +(duration - keep.reduce((a, k) => a + (k.end - k.start), 0)).toFixed(2),
        new_duration: +useEditor.getState().duration().toFixed(2),
      };
    },
  },

  analyze_music: {
    description:
      'Find the beat of a music asset. Returns tempo and beat times, for snapping cuts or punches to the track.',
    schema: {
      type: 'object',
      properties: { asset_id: { type: 'string' } },
      required: ['asset_id'],
      additionalProperties: false,
    },
    run: async ({ asset_id }) => {
      const asset = useEditor.getState().assets.find((a) => a.id === asset_id);
      if (!asset) throw new Error(`No asset ${asset_id}`);
      const { beats, bpm, duration } = await detectBeats(asset.file);
      return { bpm, beat_count: beats.length, duration: +duration.toFixed(2), first_beats: beats.slice(0, 16) };
    },
  },

  snap_cuts_to_beats: {
    description:
      'Nudge each cut on the video track onto the nearest musical beat, so the edit locks to the track.',
    schema: {
      type: 'object',
      properties: {
        music_asset_id: { type: 'string' },
        tolerance: { type: 'number', description: 'Largest nudge allowed, seconds. Default 0.12.' },
      },
      required: ['music_asset_id'],
      additionalProperties: false,
    },
    run: async ({ music_asset_id, tolerance = 0.12 }) => {
      const st = useEditor.getState();
      const asset = st.assets.find((a) => a.id === music_asset_id);
      if (!asset) throw new Error(`No asset ${music_asset_id}`);
      const { beats } = await detectBeats(asset.file);
      if (!beats.length) return { moved: 0, note: 'No beats detected.' };
      let moved = 0;
      st.commit((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.kind !== 'video') return t;
          const ordered = [...t.clips].sort((a, b) => a.start - b.start);
          let cursor = 0;
          const remapped = ordered.map((c) => {
            const snapped = snapToBeat(cursor, beats, tolerance);
            if (Math.abs(snapped - cursor) > 0.001) moved++;
            const clip = { ...c, start: snapped };
            cursor = snapped + c.duration;
            return clip;
          });
          return { ...t, clips: remapped };
        }),
      }), 'beat snap');
      return { moved, beats: beats.length };
    },
  },

  set_template: {
    description: 'Apply a look: sets aspect ratio, caption style, colour grade, accent and caption placement in one move.',
    schema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', enum: ids(TEMPLATES) },
      },
      required: ['template_id'],
      additionalProperties: false,
    },
    run: ({ template_id }) => {
      useEditor.getState().applyTemplate(template_id);
      return { applied: template_id, project: useEditor.getState().summary().project };
    },
  },

  set_caption_style: {
    description: 'Tune the captions: which animated style, how many words on screen at once, and where they sit vertically.',
    schema: {
      type: 'object',
      properties: {
        style_id: { type: 'string', enum: ids(CAPTION_STYLES) },
        words_on_screen: { type: 'integer', minimum: 1, maximum: 8 },
        vertical_position: { type: 'number', minimum: 0.1, maximum: 0.94, description: '0 is top, 1 is bottom.' },
        size: { type: 'number', minimum: 0.5, maximum: 1.8, description: 'Scale multiplier. 1 is the style default.' },
      },
      additionalProperties: false,
    },
    run: ({ style_id, words_on_screen, vertical_position, size }) => {
      const patch = {};
      if (style_id) patch.styleId = style_id;
      if (words_on_screen) patch.groupSize = words_on_screen;
      if (vertical_position != null) patch.y = vertical_position;
      if (size != null) patch.scale = size;
      useEditor.getState().commitCaptions(patch, 'caption style');
      return { captions: useEditor.getState().summary().captions };
    },
  },

  emphasize_words: {
    description:
      'Render specific words in the accent colour, slightly larger. Use it on the words that carry the point — numbers, outcomes, the payoff. Replaces any previous emphasis.',
    schema: {
      type: 'object',
      properties: {
        words: { type: 'array', items: { type: 'string' }, description: 'Words as they appear in the transcript.' },
      },
      required: ['words'],
      additionalProperties: false,
    },
    run: ({ words }) => {
      const hits = useEditor.getState().emphasizeWords(words);
      return { matched: hits, requested: words.length };
    },
  },

  set_motion: {
    description:
      'Apply a framing move across the video clips. "alternate" punches in on every other cut — the standard treatment for a jump-cut edit. "punch" hits every cut, "push" drifts in slowly, "kenburns" drifts and pans, "parallax" is a slow dolly with a drifting centre that reads as depth on stills, "none" clears it.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', enum: ['alternate', 'punch', 'push', 'kenburns', 'parallax', 'none'] },
        strength: { type: 'number', minimum: 0.02, maximum: 0.4, description: 'How far it moves. 0.12 is a normal punch.' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    run: ({ pattern, strength = 0.12 }) => {
      useEditor.getState().setMotionPattern(pattern, strength);
      const clips = useEditor.getState().summary().videoClips;
      return { pattern, clips_affected: clips.length };
    },
  },

  add_text_overlay: {
    description:
      'Put a text card on screen — a hook line, a label, a payoff. Sits above the footage on its own track.',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        start: { type: 'number', description: 'Timeline seconds.' },
        duration: { type: 'number' },
        position: { type: 'string', enum: ['top', 'middle', 'bottom'] },
        size: { type: 'number', minimum: 0.02, maximum: 0.2, description: 'Fraction of frame height. 0.07 is a headline.' },
        style: { type: 'string', enum: ['solid', 'outline', 'badge'], description: 'badge fills the accent colour behind the text.' },
      },
      required: ['text', 'start', 'duration'],
      additionalProperties: false,
    },
    run: ({ text, start, duration, position = 'top', size = 0.07, style = 'solid' }) => {
      const y = position === 'top' ? 0.16 : position === 'middle' ? 0.5 : 0.86;
      const accent = useEditor.getState().project.accent;
      const id = nanoid(8);
      useEditor.getState().commit((s) => ({
        tracks: s.tracks.map((t) =>
          t.kind !== 'overlay' ? t : {
            ...t,
            clips: [...t.clips, {
              id, kind: 'text', name: 'Text', text,
              start: Math.max(0, start), duration: Math.max(0.4, duration),
              x: 0.5, y, anim: 'slide',
              style: {
                font: 'Archivo Black', weight: 900, size,
                color: style === 'badge' ? '#0b0b0f' : style === 'outline' ? 'transparent' : '#ffffff',
                stroke: style === 'outline' ? '#ffffff' : '#000000',
                strokeWidth: style === 'outline' ? 0.045 : 0.08,
                bg: style === 'badge' ? accent : null,
                uppercase: true,
              },
            }],
          }
        ),
      }), 'add text');
      return { id, text, start, duration };
    },
  },

  set_grade: {
    description: 'Apply a colour grade to every video clip.',
    schema: {
      type: 'object',
      properties: { filter_id: { type: 'string', enum: ids(FILTERS) } },
      required: ['filter_id'],
      additionalProperties: false,
    },
    run: ({ filter_id }) => {
      useEditor.getState().commit((s) => ({
        tracks: s.tracks.map((t) =>
          t.kind !== 'video' ? t : { ...t, clips: t.clips.map((c) => ({ ...c, filter: filter_id })) }
        ),
      }), 'grade');
      return { filter: filter_id };
    },
  },

  set_accent: {
    description: 'Set the accent colour used by emphasised caption words and badge text.',
    schema: {
      type: 'object',
      properties: { hex: { type: 'string', description: 'e.g. #7c5cff' } },
      required: ['hex'],
      additionalProperties: false,
    },
    run: ({ hex }) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Expected a hex colour like #7c5cff');
      useEditor.getState().setAccent(hex);
      return { accent: hex };
    },
  },

  trim_to_range: {
    description:
      'Keep only one stretch of the timeline and drop the rest — for pulling the strongest section out of a long take. Times are timeline seconds.',
    schema: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end'],
      additionalProperties: false,
    },
    run: ({ start, end }) => {
      if (end - start < 0.5) throw new Error('Range too short.');
      const st = useEditor.getState();
      st.commit((s) => {
        const tracks = s.tracks.map((t) => {
          const clips = [];
          for (const c of t.clips) {
            const cs = Math.max(c.start, start);
            const ce = Math.min(c.start + c.duration, end);
            if (ce - cs < 0.05) continue;
            clips.push({
              ...c,
              start: cs - start,
              duration: ce - cs,
              in: (c.in || 0) + (cs - c.start) * (c.speed || 1),
            });
          }
          return { ...t, clips };
        });
        const words = s.captions.words
          .filter((w) => w.end > start && w.start < end)
          .map((w) => ({ ...w, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) }));
        return { tracks, captions: { ...s.captions, words } };
      }, 'trim');
      st.refreshDerived();
      return { duration: +useEditor.getState().duration().toFixed(2) };
    },
  },

  enhance_audio: {
    description:
      'Clean up the voice track: rumble filter, noise gate, de-esser, presence lift, compression and normalise. Replaces the take audio with the cleaned render and mutes the original. Reports the measured noise floor and loudness before and after.',
    schema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        preset: { type: 'string', enum: Object.keys(VOICE_PRESETS) },
        strength: { type: 'number', minimum: 0, maximum: 1, description: 'Scales the whole treatment. Default 1.' },
      },
      required: ['asset_id'],
      additionalProperties: false,
    },
    run: async ({ asset_id, preset = 'podcast', strength = 1 }) => {
      const asset = useEditor.getState().assets.find((a) => a.id === asset_id);
      if (!asset) throw new Error(`No asset ${asset_id}`);
      const { blob, duration, report } = await enhanceVoice(asset.file, { preset, strength });
      const enhanced = {
        id: nanoid(8),
        name: `${asset.name} (enhanced)`,
        type: 'audio',
        url: URL.createObjectURL(blob),
        file: new File([blob], 'enhanced.wav', { type: 'audio/wav' }),
        thumb: null, duration, width: 0, height: 0,
      };
      useEditor.getState().useEnhancedAudio(enhanced);
      return report;
    },
  },

  search_broll: {
    description:
      'Search Pexels for stock b-roll. Read-only — returns candidates with ids you can pass to add_broll. Search for what is on screen, not the abstract topic: "laptop desk night" beats "productivity".',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async ({ query, count = 6 }) => {
      const aspect = useEditor.getState().project.aspect;
      const orientation = aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait';
      const found = await searchBroll(query, { orientation, perPage: count });
      brollResults.clear();
      found.forEach((f) => brollResults.set(f.id, f));
      return {
        query,
        results: found.map((f) => ({
          id: f.id, duration: f.duration, size: `${f.width}x${f.height}`, by: f.author,
        })),
      };
    },
  },

  add_broll: {
    description:
      'Download a stock clip from the last search and lay it over the footage in a frame. "luxury" is a floating panel with a glow and corner ticks, "soft" is rounded and plain, "hard" is a sharp rectangle, "full" covers the whole frame as a straight cutaway.',
    schema: {
      type: 'object',
      properties: {
        result_id: { type: 'string', description: 'id from search_broll.' },
        start: { type: 'number', description: 'Timeline seconds.' },
        duration: { type: 'number' },
        frame: { type: 'string', enum: FRAME_STYLES },
        placement: {
          type: 'string',
          enum: Object.keys(BROLL_PLACEMENTS),
          description: '"behind" puts the footage behind the speaker using person segmentation — the strongest look, but it needs a clear single subject. The rest float a panel over the shot.',
        },
        anim: { type: 'string', enum: BROLL_ANIMS, description: 'How the panel enters.' },
        label: { type: 'string', description: 'Optional caption chip on the panel.' },
      },
      required: ['result_id', 'start', 'duration'],
      additionalProperties: false,
    },
    run: async ({ result_id, start, duration, frame, placement = 'top', anim, label }) => {
      const found = brollResults.get(String(result_id));
      if (!found) throw new Error('Unknown result id — run search_broll first.');

      // Warm the segmenter before the frame is needed, so the first painted
      // frame is not an un-masked fallback.
      let segmentation = 'n/a';
      if (placement === 'behind') {
        try { await initSegmenter(); segmentation = 'ready'; }
        catch (e) { segmentation = `unavailable: ${e.message}`; }
      }

      const asset = await fetchBrollAsset(found);
      useEditor.getState().addAssets([asset]);
      const id = useEditor.getState().addBrollClip(asset.id, {
        start, duration: Math.min(duration, asset.duration),
        frame, placement, anim, label,
      });
      return { id, credit: asset.credit, placed_at: start, duration, placement, segmentation };
    },
  },

  auto_broll: {
    description:
      'Pick search terms from the transcript, fetch clips, and space them across the video automatically. The fastest way to get cutaways in; refine individual placements afterwards.',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 6 },
        frame: { type: 'string', enum: FRAME_STYLES },
        placement: { type: 'string', enum: Object.keys(BROLL_PLACEMENTS) },
        clip_length: { type: 'number', description: 'Seconds each cutaway stays up. Default 2.4.' },
      },
      additionalProperties: false,
    },
    run: async ({ count = 3, frame, placement = 'top', clip_length = 2.4 }) => {
      const st = useEditor.getState();
      const words = st.captions.words;
      if (!words.length) throw new Error('Need a transcript first — captions drive the search terms.');
      // Concept queries: sentence-level, mapped to filmable phrases, brand-aware.
      const brand = getBrand(st.project.brand || 'none');
      const sentences = toSentences(words);
      // If a Pilot provider + key is configured, fill abstract-sentence gaps
      // with an LLM query; otherwise the concept map alone (100% relevant, but
      // it skips lines with no filmable concept — which is the right default).
      const cfg = loadPilotCfg();
      let picks;
      if (cfg?.provider && cfg.apiKey) {
        const aligned = await brollQueriesAI(sentences, { cfg, brand });
        picks = aligned
          .map((r, i) => (r.query ? { query: r.query, source: r.source, start: sentences[i].start } : null))
          .filter(Boolean)
          .slice(0, count);
      } else {
        picks = conceptQueries(sentences, { brand, max: count });
      }
      const terms = picks.map((p) => p.query);
      if (!terms.length) throw new Error('No filmable concepts found in the transcript.');

      const total = st.duration();
      const aspect = st.project.aspect;
      const orientation = aspect === '16:9' ? 'landscape' : aspect === '1:1' ? 'square' : 'portrait';
      const placed = [];

      for (let i = 0; i < terms.length; i++) {
        try {
          const hits = await searchBroll(terms[i], { orientation, perPage: 3 });
          if (!hits.length) continue;
          const asset = await fetchBrollAsset(hits[0]);
          useEditor.getState().addAssets([asset]);
          // Place at the sentence the concept came from when known, else space
          // the cutaways through the body leaving the opening clear.
          const slot = picks[i].start != null
            ? picks[i].start
            : total * 0.18 + (i * (total * 0.68)) / Math.max(1, terms.length);
          useEditor.getState().addBrollClip(asset.id, {
            start: +slot.toFixed(2),
            duration: Math.min(clip_length, asset.duration),
            frame, placement,
          });
          placed.push({ term: terms[i], at: +slot.toFixed(2), source: picks[i].source, credit: asset.credit });
        } catch (e) {
          placed.push({ term: terms[i], error: e.message });
        }
      }
      return { terms, placed };
    },
  },

  add_graphic_cards: {
    description:
      'Put a row of icon cards on screen — the step-sequence look (an emoji and a word per card, one lit at a time). Use it when the script lists steps, stages or options. Two to four cards reads best.',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              icon: { type: 'string', description: 'A single emoji.' },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
        start: { type: 'number' },
        duration: { type: 'number' },
        vertical_position: { type: 'number', minimum: 0.1, maximum: 0.9 },
        walk: { type: 'boolean', description: 'Light each card in turn across the duration. Default true.' },
      },
      required: ['items', 'start', 'duration'],
      additionalProperties: false,
    },
    run: ({ items, start, duration, vertical_position = 0.62, walk = true }) => {
      const id = useEditor.getState().addCards(items, {
        start, duration, y: vertical_position, walk,
      });
      return { id, cards: items.map((i) => i.label) };
    },
  },

  set_finish: {
    description:
      'Apply the finishing pass — vignette, film grain, bloom and optional letterbox. This is what separates a raw screen grab from something that reads as graded. "subtle" suits most talking heads; "cinematic" is stronger; "film" leans into grain; "scope" adds letterbox bars.',
    schema: {
      type: 'object',
      properties: { preset: { type: 'string', enum: Object.keys(FINISH_PRESETS) } },
      required: ['preset'],
      additionalProperties: false,
    },
    run: ({ preset }) => {
      useEditor.getState().setFinish(preset);
      return { finish: preset };
    },
  },

  add_sound_design: {
    description:
      'Synthesise and lay down a sound-design bed: a whoosh through every cut, and a riser plus impact under the hook. Generated from scratch, so there is nothing to license. Re-running replaces the previous bed.',
    schema: {
      type: 'object',
      properties: {
        intensity: { type: 'number', minimum: 0, maximum: 1.5, description: '1 is normal, 0.5 restrained, 1.4 aggressive.' },
        hook_at: { type: 'number', description: 'Seconds where the hook lands. Omit for no impact.' },
      },
      additionalProperties: false,
    },
    run: async ({ intensity = 1, hook_at = 0 }) => {
      const st = useEditor.getState();
      const video = st.tracks.find((t) => t.kind === 'video');
      const cuts = (video?.clips || [])
        .map((c) => c.start)
        .filter((t) => t > 0.05)
        .sort((a, b) => a - b);
      const duration = st.duration();
      const { blob, duration: len } = await renderSfxBed({
        duration, cuts, hookAt: hook_at, intensity,
      });
      useEditor.getState().addAudioBed({
        id: nanoid(8), name: 'Sound design', type: 'audio',
        url: URL.createObjectURL(blob),
        file: new File([blob], 'sfx.wav', { type: 'audio/wav' }),
        thumb: null, duration: len, width: 0, height: 0,
      }, 'sfx');
      return { whooshes: cuts.length, hook_impact: hook_at > 0, duration: len };
    },
  },

  add_music_bed: {
    description:
      'Synthesise a quiet original backing bed — sub pulse, soft pad, light ticks. Deliberately plain: it removes silence rather than carrying the video. If the user has their own track, use that instead.',
    schema: {
      type: 'object',
      properties: {
        bpm: { type: 'integer', minimum: 60, maximum: 160 },
        level: { type: 'number', minimum: 0.04, maximum: 0.4, description: 'Bed volume. 0.16 sits under speech.' },
      },
      additionalProperties: false,
    },
    run: async ({ bpm = 90, level = 0.16 }) => {
      const duration = useEditor.getState().duration();
      const { blob, duration: len } = await renderMusicBed({ duration, bpm, level });
      useEditor.getState().addAudioBed({
        id: nanoid(8), name: 'Music bed', type: 'audio',
        url: URL.createObjectURL(blob),
        file: new File([blob], 'music.wav', { type: 'audio/wav' }),
        thumb: null, duration: len, width: 0, height: 0,
      }, 'music');
      return { bpm, level, duration: len };
    },
  },

  set_transition: {
    description:
      'Set what happens at each cut. "whip" adds a blurred pan through the cut; "none" is a straight cut.',
    schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['none', 'whip'] } },
      required: ['kind'],
      additionalProperties: false,
    },
    run: ({ kind }) => {
      useEditor.getState().setTransition(kind);
      return { transition: kind };
    },
  },

  set_captions_from_script: {
    description:
      'Create word-timed captions from a script when no transcription has been run. Words are spread across the given range by syllable weight.',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: ({ text, start = 0, end }) => {
      const st = useEditor.getState();
      st.wordsFromScript(text, start, end ?? st.duration());
      return { words: useEditor.getState().captions.words.length };
    },
  },
};

/** Anthropic tool definitions, derived from the same table. */
export const toolDefs = () =>
  Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: t.schema,
  }));

/** Execute one tool call, returning a result the model can read. */
export async function runTool(name, input) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool ${name}`);
  return tool.run(input || {});
}
