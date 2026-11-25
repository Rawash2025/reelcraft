/**
 * Editing intensity.
 *
 * A preset is just a set of defaults for the individual knobs; every knob stays
 * independently adjustable, so "VIRAL but with calm captions" is expressible.
 * Knobs are 0-100 to match the UI.
 */

export const KNOBS = [
  { id: 'caption', name: 'Caption intensity', hint: 'How hard words animate' },
  { id: 'zoom', name: 'Zoom intensity', hint: 'Strength of camera moves' },
  { id: 'broll', name: 'B-roll frequency', hint: 'How often cutaways appear' },
  { id: 'graphics', name: 'Graphic frequency', hint: 'Cards, icons, counters' },
  { id: 'sfx', name: 'SFX frequency', hint: 'Whooshes and impacts' },
  { id: 'transition', name: 'Transition intensity', hint: 'Whips and cuts' },
  { id: 'brand', name: 'Brand strength', hint: 'How present the branding is' },
  { id: 'creativity', name: 'AI creativity', hint: 'How far the director strays from the safe choice' },
];

export const PRESETS = {
  CLEAN: {
    name: 'Clean',
    blurb: 'Minimal motion, professional captions, few cutaways. For a serious talking head.',
    knobs: { caption: 30, zoom: 20, broll: 15, graphics: 20, sfx: 10, transition: 10, brand: 40, creativity: 25 },
    targets: { eventsPerMinute: 30, majorEvery: [4.5, 7], threshold: 0.55, strong: 0.78 },
  },
  BALANCED: {
    name: 'Balanced',
    blurb: 'Moderate visual change. The default for most business content.',
    knobs: { caption: 55, zoom: 45, broll: 40, graphics: 45, sfx: 35, transition: 35, brand: 55, creativity: 50 },
    targets: { eventsPerMinute: 50, majorEvery: [3, 5], threshold: 0.45, strong: 0.7 },
  },
  VIRAL: {
    name: 'Viral',
    blurb: 'Frequent change, stronger text, more cutaways and pattern interrupts.',
    knobs: { caption: 78, zoom: 70, broll: 65, graphics: 65, sfx: 60, transition: 60, brand: 60, creativity: 70 },
    targets: { eventsPerMinute: 70, majorEvery: [2, 3.5], threshold: 0.38, strong: 0.62 },
  },
  AGGRESSIVE: {
    name: 'Aggressive',
    blurb: 'Maximum short-form pacing. Use deliberately — it can read as frantic.',
    knobs: { caption: 92, zoom: 88, broll: 80, graphics: 80, sfx: 78, transition: 80, brand: 65, creativity: 85 },
    targets: { eventsPerMinute: 90, majorEvery: [1.4, 2.6], threshold: 0.3, strong: 0.55 },
  },
};

export const presetIds = () => Object.keys(PRESETS);

/** Resolve a preset plus any overrides into a concrete settings object. */
export function resolveIntensity(presetId = 'BALANCED', overrides = {}) {
  const preset = PRESETS[presetId] || PRESETS.BALANCED;
  const knobs = { ...preset.knobs };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in knobs && Number.isFinite(v)) knobs[k] = Math.max(0, Math.min(100, v));
  }
  return {
    preset: presetId,
    name: preset.name,
    knobs,
    targets: { ...preset.targets },
    // Convenience 0..1 views, since every consumer wants fractions.
    f: Object.fromEntries(Object.entries(knobs).map(([k, v]) => [k, v / 100])),
  };
}
