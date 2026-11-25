import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { ASPECTS, TEMPLATES } from '../engine/templates.js';
import { buildChunks, projectDuration } from '../engine/renderer.js';
import { BROLL_PLACEMENTS } from '../engine/layers.js';
import { timeWordsEvenly } from '../engine/transcribe.js';
import * as wordIconsMod from '../engine/wordIcons.js';
import { getPremiumScene, sceneDefaults } from '../engine/premiumScenes.js';
import { getBrand } from '../brand/brands.js';


// Map word timings from source time onto the timeline after a re-cut. Words
// inside a removed range collapse onto the cut point rather than vanishing.
function remapWords(words, ranges) {
  if (!words.length) return words;
  const offsets = [];
  let acc = 0;
  for (const r of ranges) {
    offsets.push({ ...r, out: acc });
    acc += r.end - r.start;
  }
  const map = (t) => {
    for (const r of offsets) {
      if (t < r.start) return r.out;
      if (t <= r.end) return r.out + (t - r.start);
    }
    return acc;
  };
  return words
    .map((w) => ({ ...w, start: +map(w.start).toFixed(3), end: +map(w.end).toFixed(3) }))
    .filter((w) => w.end - w.start > 0.01);
}

const newTrack = (kind, name) => ({
  id: nanoid(6),
  kind,
  name,
  clips: [],
  volume: 1,
  muted: false,
  locked: false,
});

const initial = () => ({
  project: {
    name: 'Untitled project',
    aspect: '9:16',
    ...ASPECTS['9:16'],
    fps: 30,
    background: '#000000',
    accent: '#7c5cff',
    transition: 'none',
    finish: 'none',
    // Background replacement (uses person segmentation).
    background_mode: 'none',      // none | color | blur | image | design
    background_color: '#12140e',
    background_blur: 0.5,
    background_backdrop: 'studio_dark',
    background_asset: null,       // assetId for image/video backgrounds
    templateId: null,
    brand: 'none',
    previewMuted: false,
  },
  assets: [],
  tracks: [
    newTrack('video', 'Video'),
    { ...newTrack('broll', 'B-roll'), muted: true },
    newTrack('overlay', 'Text & graphics'),
    newTrack('audio', 'Music'),
  ],
  captions: {
    enabled: true,
    words: [],
    styleId: 'bold-pop',
    groupSize: 3,
    y: 0.72,
    scale: 1,
    _chunks: [],
  },
  selection: null, // { trackId, clipId } | { type:'captions' }
  edl: null,       // the current Edit Decision List, if one has been planned
  time: 0,
  playing: false,
  zoom: 90, // px per second
});

// Undo/redo snapshots only the parts a user can change by hand.
const snapshot = (s) => ({
  project: s.project,
  tracks: s.tracks,
  captions: s.captions,
  assets: s.assets,
});

export const useEditor = create((set, get) => ({
  ...initial(),
  past: [],
  future: [],
  toast: null,

  notify: (message, tone = 'info') => {
    set({ toast: { message, tone, id: nanoid(4) } });
    setTimeout(() => {
      if (get().toast?.message === message) set({ toast: null });
    }, 3800);
  },

  commit: (fn, label = 'edit') => {
    const before = snapshot(get());
    set((s) => ({ ...fn(s), past: [...s.past.slice(-49), { label, state: before }] , future: [] }));
    get().refreshDerived();
  },

  undo: () => {
    const { past } = get();
    if (!past.length) return;
    const last = past[past.length - 1];
    set((s) => ({
      ...last.state,
      past: s.past.slice(0, -1),
      future: [...s.future, { label: last.label, state: snapshot(s) }],
    }));
    get().refreshDerived();
  },

  redo: () => {
    const { future } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    set((s) => ({
      ...next.state,
      future: s.future.slice(0, -1),
      past: [...s.past, { label: next.label, state: snapshot(s) }],
    }));
    get().refreshDerived();
  },

  refreshDerived: () =>
    set((s) => ({
      captions: { ...s.captions, _chunks: buildChunks(s.captions.words, s.captions.groupSize) },
    })),

  duration: () => {
    const d = projectDuration(get().tracks);
    return Number.isFinite(d) && d > 0 ? Math.max(d, 0.1) : 0.1;
  },

  /* ------------------------------------------------------------- project */

  setAspect: (aspect) =>
    get().commit(
      (s) => ({ project: { ...s.project, aspect, ...ASPECTS[aspect] } }),
      'aspect'
    ),

  setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch } })),

  applyTemplate: (id) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    get().commit(
      (s) => ({
        project: {
          ...s.project,
          aspect: t.aspect,
          ...ASPECTS[t.aspect],
          accent: t.accent,
          templateId: t.id,
        },
        captions: {
          ...s.captions,
          styleId: t.captionStyle,
          y: t.captionY,
          groupSize: t.groupSize,
        },
        tracks: s.tracks.map((tr) =>
          tr.kind === 'video'
            ? { ...tr, clips: tr.clips.map((c) => ({ ...c, filter: t.filter })) }
            : tr
        ),
      }),
      'template'
    );
    get().notify(`Template applied — ${t.name}`, 'good');
  },

  /* -------------------------------------------------------------- assets */

  addAssets: (assets) =>
    get().commit((s) => ({ assets: [...s.assets, ...assets] }), 'import'),

  updateAsset: (id, patch) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  // Drop an asset at the end of its natural track.
  addToTimeline: (assetId) => {
    const asset = get().assets.find((a) => a.id === assetId);
    if (!asset) return;
    const kind = asset.type === 'audio' ? 'audio' : 'video';
    get().commit((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.kind !== kind) return t;
        const start = t.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
        const clip = {
          id: nanoid(8),
          assetId,
          kind: asset.type,
          name: asset.name,
          start,
          duration: asset.duration || 5,
          in: 0,
          volume: 1,
          speed: 1,
          opacity: 1,
          filter: 'none',
          fit: 'cover',
          fadeIn: 0,
          fadeOut: 0,
          transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        };
        return { ...t, clips: [...t.clips, clip] };
      });
      return { tracks };
    }, 'add clip');
  },

  /* --------------------------------------------------------------- clips */

  updateClip: (trackId, clipId, patch) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id !== trackId
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
            }
      ),
    })),

  commitClip: (trackId, clipId, patch, label = 'clip') =>
    get().commit(
      (s) => ({
        tracks: s.tracks.map((t) =>
          t.id !== trackId
            ? t
            : {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
              }
        ),
      }),
      label
    ),

  splitAt: (time) => {
    const sel = get().selection;
    get().commit((s) => {
      const tracks = s.tracks.map((t) => {
        const clips = [];
        for (const c of t.clips) {
          const inside = time > c.start + 0.05 && time < c.start + c.duration - 0.05;
          const isTarget = sel ? sel.clipId === c.id : t.kind === 'video';
          if (!inside || !isTarget) {
            clips.push(c);
            continue;
          }
          const at = time - c.start;
          clips.push({ ...c, duration: at });
          clips.push({
            ...c,
            id: nanoid(8),
            start: time,
            duration: c.duration - at,
            in: (c.in || 0) + at * (c.speed || 1),
          });
        }
        return { ...t, clips };
      });
      return { tracks };
    }, 'split');
    get().notify('Clip split at playhead');
  },

  removeSelected: () => {
    const sel = get().selection;
    if (!sel?.clipId) return;
    get().commit(
      (s) => ({
        tracks: s.tracks.map((t) =>
          t.id !== sel.trackId ? t : { ...t, clips: t.clips.filter((c) => c.id !== sel.clipId) }
        ),
        selection: null,
      }),
      'delete'
    );
  },

  duplicateSelected: () => {
    const sel = get().selection;
    if (!sel?.clipId) return;
    get().commit((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.id !== sel.trackId) return t;
        const c = t.clips.find((x) => x.id === sel.clipId);
        if (!c) return t;
        return {
          ...t,
          clips: [...t.clips, { ...c, id: nanoid(8), start: c.start + c.duration }],
        };
      }),
    }), 'duplicate');
  },

  // Close gaps on the video track after a delete or trim.
  rippleClose: () =>
    get().commit((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.kind === 'overlay') return t;
        let cursor = 0;
        const clips = [...t.clips]
          .sort((a, b) => a.start - b.start)
          .map((c) => {
            const moved = { ...c, start: cursor };
            cursor += c.duration;
            return moved;
          });
        return { ...t, clips };
      }),
    }), 'ripple'),

  addTextClip: (time) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay'
          ? t
          : {
              ...t,
              clips: [
                ...t.clips,
                {
                  id,
                  kind: 'text',
                  name: 'Text',
                  text: 'Your headline',
                  start: time,
                  duration: 3,
                  x: 0.5,
                  y: 0.2,
                  anim: 'slide',
                  style: {
                    font: 'Archivo Black',
                    weight: 900,
                    size: 0.07,
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeWidth: 0.08,
                    uppercase: true,
                    bg: null,
                  },
                },
              ],
            }
      ),
    }), 'add text');
    const track = get().tracks.find((t) => t.kind === 'overlay');
    set({ selection: { trackId: track.id, clipId: id } });
  },

  /* ------------------------------------------------- director operations */

  // Rebuild the video track from a list of source-time ranges to keep. This is
  // how silence removal, and any ranged re-cut, is applied — and it is also why
  // caption words have to be remapped: after the cut, source time and timeline
  // time no longer agree.
  applyKeepRanges: (assetId, ranges, { gap = 0 } = {}) => {
    const clean = ranges
      .filter((r) => r.end - r.start > 0.1)
      .sort((a, b) => a.start - b.start);
    if (!clean.length) return 0;

    get().commit((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.kind !== 'video') return t;
        const template =
          t.clips.find((c) => c.assetId === assetId) || t.clips[0] || {};
        const keptOthers = t.clips.filter((c) => c.assetId !== assetId);
        let cursor = 0;
        const clips = clean.map((r, i) => {
          const clip = {
            ...template,
            id: nanoid(8),
            assetId,
            kind: 'video',
            name: `${template.name || 'clip'} ${i + 1}`,
            start: cursor,
            duration: r.end - r.start,
            in: r.start,
            motion: template.motion || null,
          };
          cursor += clip.duration + gap;
          return clip;
        });
        return { ...t, clips: [...keptOthers, ...clips] };
      });

      const words = remapWords(s.captions.words, clean);
      return { tracks, captions: { ...s.captions, words } };
    }, 'recut');
    get().refreshDerived();
    return clean.length;
  },

  // Framing moves. `pattern` "alternate" is the workhorse for jump-cut edits:
  // every other cut punches in, so the frame never sits still for long.
  setMotion: (clipId, motion) =>
    get().commit((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, motion } : c)),
      })),
    }), 'motion'),

  setMotionPattern: (pattern, strength = 0.12) => {
    get().commit((s) => ({
      tracks: s.tracks.map((t) => {
        if (t.kind !== 'video') return t;
        const ordered = [...t.clips].sort((a, b) => a.start - b.start);
        const ids = new Map();
        ordered.forEach((c, i) => {
          let motion = null;
          if (pattern === 'punch')
            motion = { type: 'punch', from: 1 + strength, to: 1, duration: 0.35 };
          else if (pattern === 'alternate')
            motion = i % 2 === 1
              ? { type: 'punch', from: 1 + strength, to: 1, duration: 0.35 }
              : null;
          else if (pattern === 'push')
            motion = { type: 'push', from: 1, to: 1 + strength, duration: c.duration };
          else if (pattern === 'parallax')
            motion = { type: 'parallax', amp: strength, cycles: 1, duration: c.duration };
          else if (pattern === 'kenburns')
            motion = {
              type: 'kenburns', from: 1 + strength * 0.4, to: 1 + strength,
              dx: (i % 2 ? -1 : 1) * strength * 0.15, dy: 0, duration: c.duration,
            };
          ids.set(c.id, motion);
        });
        return { ...t, clips: t.clips.map((c) => ({ ...c, motion: ids.get(c.id) ?? null })) };
      }),
    }), 'motion pattern');
  },

  // Mark words to render in the accent colour. Matching is on the word text so
  // the caller can think in language, not indices.
  emphasizeWords: (terms) => {
    const wanted = new Set(
      terms.map((t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    );
    let hits = 0;
    get().commit((s) => ({
      captions: {
        ...s.captions,
        words: s.captions.words.map((w) => {
          const key = w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          const emph = wanted.has(key);
          if (emph) hits++;
          return { ...w, emph };
        }),
      },
    }), 'emphasis');
    get().refreshDerived();
    return hits;
  },

  // Proof / screenshot card, collage, document, and PIP overlays. All land on
  // the overlay track as editable clips.
  addCard: (assetId, opts = {}) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, {
          id, kind: 'card', assetId,
          x: opts.x ?? 0.27, y: opts.y ?? 0.46, w: opts.w ?? 0.42, h: opts.h ?? 0.34,
          rot: opts.rot ?? -2.5, radius: opts.radius ?? 0.09, anim: opts.anim ?? 'scale',
          border: opts.border, label: opts.label ?? null, shape: opts.shape ?? 'rect',
          start: Math.max(0, opts.start ?? 0), duration: Math.max(0.4, opts.duration ?? 1.6),
        }] }
      ),
    }), 'card');
    return id;
  },
  addCollage: (assetIds, opts = {}) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, {
          id, kind: 'collage', assetIds: assetIds.slice(0, 4),
          layout: opts.layout || 'COLLAGE_3_AROUND_SUBJECT',
          start: Math.max(0, opts.start ?? 0), duration: Math.max(0.6, opts.duration ?? 2.2),
        }] }
      ),
    }), 'collage');
    return id;
  },
  addDocument: (assetId, opts = {}) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, {
          id, kind: 'document', assetId,
          w: opts.w ?? 0.56, h: opts.h ?? 0.6, y: opts.y ?? 0.46,
          start: Math.max(0, opts.start ?? 0), duration: Math.max(0.6, opts.duration ?? 2.4),
        }] }
      ),
    }), 'document');
    return id;
  },
  addPIP: (assetId, opts = {}) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, {
          id, kind: 'pip', assetId, pos: opts.pos || 'TOP_RIGHT',
          shape: opts.shape || 'rect', size: opts.size ?? 0.24,
          start: Math.max(0, opts.start ?? 0), duration: Math.max(0.4, opts.duration ?? 2.5),
        }] }
      ),
    }), 'pip');
    return id;
  },

  // Hero typography (small + huge word, optionally behind the speaker).
  addHero: (heroClip) => {
    const id = nanoid(8);
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, { ...heroClip, id, kind: 'hero' }] }
      ),
    }), 'hero text');
    return id;
  },

  // Add one reusable premium scene at the playhead (or an explicit start).
  // Scene copy/media live in props so the whole composition stays editable as
  // one timeline clip instead of becoming a pile of unrelated overlays.
  addPremiumScene: (sceneType, opts = {}) => {
    const def = getPremiumScene(sceneType);
    if (!def) return null;
    const id = nanoid(8);
    const brand = getBrand(get().project.brand || 'none');
    const props = {
      ...sceneDefaults(sceneType, brand),
      ...(opts.props || {}),
    };
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : { ...t, clips: [...t.clips, {
          id,
          kind: 'premium-scene',
          sceneType,
          name: def.name,
          start: Math.max(0, opts.start ?? s.time ?? 0),
          duration: Math.max(0.6, opts.duration ?? def.duration),
          hideCaptions: opts.hideCaptions ?? def.hideCaptions,
          props,
        }] }
      ),
    }), `scene: ${def.name}`);
    const track = get().tracks.find((t) => t.kind === 'overlay');
    set({ selection: { trackId: track?.id, clipId: id } });
    return id;
  },

  setBrand: (brandId) => {
    const brand = getBrand(brandId);
    get().commit((s) => ({
      project: {
        ...s.project,
        brand: brand.id,
        accent: brand.captionAccent || brand.primary || s.project.accent,
        background: brand.id === 'none' ? s.project.background : brand.background,
      },
    }), 'brand');
  },

  // Attach keyword emoji icons to emphasised caption words.
  addWordIcons: (opts = {}) => {
    const { attachIcons } = wordIconsMod;
    if (!attachIcons) return 0;
    let count = 0;
    get().commit((s) => {
      const words = attachIcons(s.captions.words, opts);
      count = words.filter((w) => w.icon).length;
      return { captions: { ...s.captions, words } };
    }, 'word icons');
    get().refreshDerived();
    return count;
  },
  clearWordIcons: () => {
    get().commit((s) => ({
      captions: { ...s.captions, words: s.captions.words.map((w) => ({ ...w, icon: undefined })) },
    }), 'clear icons');
    get().refreshDerived();
  },

  setAccent: (accent) =>
    get().commit((s) => ({ project: { ...s.project, accent } }), 'accent'),

  // Compact view of the project for the director to reason over.
  summary: () => {
    const s = get();
    const video = s.tracks.find((t) => t.kind === 'video');
    const overlay = s.tracks.find((t) => t.kind === 'overlay');
    return {
      project: {
        name: s.project.name, aspect: s.project.aspect,
        accent: s.project.accent, template: s.project.templateId,
        duration: +s.duration().toFixed(2),
      },
      assets: s.assets.map((a) => ({
        id: a.id, name: a.name, type: a.type,
        duration: +(a.duration || 0).toFixed(2),
      })),
      videoClips: (video?.clips || [])
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((c) => ({
          id: c.id, start: +c.start.toFixed(2), duration: +c.duration.toFixed(2),
          sourceIn: +(c.in || 0).toFixed(2), filter: c.filter,
          motion: c.motion?.type || 'none',
        })),
      textOverlays: (overlay?.clips || [])
        .filter((c) => c.kind === 'text')
        .map((c) => ({
          id: c.id, text: c.text, start: +c.start.toFixed(2),
          duration: +c.duration.toFixed(2),
        })),
      cardRows: (overlay?.clips || [])
        .filter((c) => c.kind === 'cards')
        .map((c) => ({
          id: c.id, labels: c.items.map((i) => i.label),
          start: +c.start.toFixed(2), duration: +c.duration.toFixed(2),
        })),
      premiumScenes: (overlay?.clips || [])
        .filter((c) => c.kind === 'premium-scene')
        .map((c) => ({
          id: c.id, type: c.sceneType, name: c.name,
          start: +c.start.toFixed(2), duration: +c.duration.toFixed(2),
        })),
      broll: (s.tracks.find((t) => t.kind === 'broll')?.clips || []).map((c) => ({
        id: c.id, name: c.name, start: +c.start.toFixed(2),
        duration: +c.duration.toFixed(2), frame: c.frame,
        placement: c.placement, behind: !!c.behind, anim: c.anim,
      })),
      transition: s.project.transition,
      finish: s.project.finish,
      captions: {
        enabled: s.captions.enabled, style: s.captions.styleId,
        wordsOnScreen: s.captions.groupSize, y: s.captions.y,
        wordCount: s.captions.words.length,
        emphasised: s.captions.words.filter((w) => w.emph).map((w) => w.text),
        transcript: s.captions.words.map((w) => w.text).join(' '),
      },
    };
  },

  /* ------------------------------------------------------ graphics & b-roll */

  setTransition: (transition) =>
    get().commit((s) => ({ project: { ...s.project, transition } }), 'transition'),

  setFinish: (finish) =>
    get().commit((s) => ({ project: { ...s.project, finish } }), 'finish'),

  // Background replacement. Kept out of undo-per-keystroke by using set() for
  // live tweaks; the mode switch itself is committed for undo.
  setBackgroundMode: (mode) =>
    get().commit((s) => ({ project: { ...s.project, background_mode: mode } }), 'background'),
  setBackground: (patch) =>
    set((s) => ({ project: { ...s.project, ...patch } })),

  // Drop a rendered audio bed (SFX or music) onto the music track. Tagged so a
  // re-run replaces its own previous pass instead of stacking beds.
  addAudioBed: (asset, tag) => {
    get().commit((s) => ({
      assets: [...s.assets, asset],
      tracks: s.tracks.map((t) =>
        t.kind !== 'audio' ? t : {
          ...t,
          clips: [
            ...t.clips.filter((c) => c.bed !== tag),
            {
              id: nanoid(8), assetId: asset.id, kind: 'audio', bed: tag,
              name: asset.name, start: 0, duration: asset.duration,
              in: 0, volume: tag === 'music' ? 0.5 : 0.9, speed: 1,
            },
          ],
        }
      ),
    }), tag);
  },

  // Framed stock footage over the main shot.
  addBrollClip: (assetId, opts = {}) => {
    const id = nanoid(8);
    const asset = get().assets.find((a) => a.id === assetId);
    // A placement preset supplies box, frame, animation and behind together;
    // any explicit field in opts still wins over it.
    const pl = BROLL_PLACEMENTS[opts.placement] || BROLL_PLACEMENTS.top;
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'broll' ? t : {
          ...t,
          clips: [...t.clips, {
            id, assetId, kind: 'video',
            name: asset?.name || 'B-roll',
            start: Math.max(0, opts.start ?? 0),
            duration: Math.max(0.4, opts.duration ?? 3),
            in: opts.in ?? 0,
            volume: 0, speed: 1, opacity: 1,
            frame: opts.frame ?? pl.frame,
            x: opts.x ?? pl.x,
            y: opts.y ?? pl.y,
            w: opts.w ?? pl.w,
            h: opts.h ?? pl.h,
            anim: opts.anim ?? pl.anim,
            behind: opts.behind ?? pl.behind,
            placement: opts.placement ?? 'top',
            zoom: opts.zoom ?? 1.04,
            label: opts.label ?? null,
            filter: opts.filter ?? 'none',
          }],
        }
      ),
    }), 'b-roll');
    return id;
  },

  // The icon-card row: a step sequence rendered over the shot.
  addCards: (items, opts = {}) => {
    const id = nanoid(8);
    // Sit the row above the caption band rather than on top of it. Captions
    // centre on their y and can wrap to two or three lines, so reserve room
    // for the block, not just the baseline.
    const cap = get().captions;
    const cardHalf = (0.86 / items.length) * 1.12 * 0.5 * (9 / 16);
    const autoY =
      cap.enabled && cap.words.length
        ? Math.min(0.6, cap.y - 0.1 * cap.scale - cardHalf - 0.03)
        : 0.55;
    get().commit((s) => ({
      tracks: s.tracks.map((t) =>
        t.kind !== 'overlay' ? t : {
          ...t,
          clips: [...t.clips, {
            id, kind: 'cards',
            name: 'Cards',
            text: items.map((i) => i.label).join(' / '),
            items,
            start: Math.max(0, opts.start ?? 0),
            duration: Math.max(0.6, opts.duration ?? 3),
            y: opts.y ?? Math.max(0.2, autoY),
            width: opts.width ?? 0.86,
            ratio: opts.ratio ?? 1.12,
            walk: opts.walk ?? true,
            active: opts.active ?? -1,
          }],
        }
      ),
    }), 'cards');
    return id;
  },

  // Swap the take's own audio for a cleaned-up render of it.
  useEnhancedAudio: (enhancedAsset) => {
    get().commit((s) => {
      const tracks = s.tracks.map((t) => {
        if (t.kind === 'video') return { ...t, muted: true };
        if (t.kind !== 'audio') return t;
        // Replace any previous enhanced pass rather than stacking them.
        const kept = t.clips.filter((c) => !c.enhanced);
        return {
          ...t,
          muted: false,
          clips: [...kept, {
            id: nanoid(8), assetId: enhancedAsset.id, kind: 'audio',
            enhanced: true, name: enhancedAsset.name,
            start: 0, duration: enhancedAsset.duration,
            in: 0, volume: 1, speed: 1,
          }],
        };
      });
      return { tracks, assets: [...s.assets, enhancedAsset] };
    }, 'enhanced audio');
  },

  /* ------------------------------------------------------------ captions */

  setCaptions: (patch) => {
    set((s) => ({ captions: { ...s.captions, ...patch } }));
    get().refreshDerived();
  },

  commitCaptions: (patch, label = 'captions') => {
    get().commit((s) => ({ captions: { ...s.captions, ...patch } }), label);
  },

  setWords: (words) => {
    get().commit((s) => ({ captions: { ...s.captions, words } }), 'transcribe');
    get().notify(`${words.length} words captioned`, 'good');
  },

  wordsFromScript: (text, start, end) =>
    get().setWords(timeWordsEvenly(text, start, end)),

  updateWord: (index, patch) => {
    set((s) => ({
      captions: {
        ...s.captions,
        words: s.captions.words.map((w, i) => (i === index ? { ...w, ...patch } : w)),
      },
    }));
    get().refreshDerived();
  },

  /* ------------------------------------------------------------ playhead */

  setTime: (t) => set({ time: Math.max(0, t) }),
  setPlaying: (p) => set({ playing: p }),
  select: (sel) => set({ selection: sel }),
  setZoom: (z) => set({ zoom: Math.max(20, Math.min(400, z)) }),

  // --- Edit Decision List -------------------------------------------------
  // The EDL is kept outside undo history on purpose: planning is a separate
  // act from editing, and re-planning should not consume undo steps.
  setEDL: (edl) => set({ edl }),
  updateSegment: (segId, patch) => set((s) => {
    if (!s.edl) return {};
    return {
      edl: {
        ...s.edl,
        segments: s.edl.segments.map((seg) =>
          seg.id === segId ? { ...seg, ...patch } : seg
        ),
      },
    };
  }),

  reset: () => set({ ...initial(), past: [], future: [] }),
}));

export const selectedClip = (s) => {
  if (!s.selection?.clipId) return null;
  const track = s.tracks.find((t) => t.id === s.selection.trackId);
  const clip = track?.clips.find((c) => c.id === s.selection.clipId);
  return clip ? { track, clip } : null;
};
