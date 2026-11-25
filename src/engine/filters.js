// Colour grades expressed as canvas filter strings so they cost nothing to apply.
export const FILTERS = [
  { id: 'none', name: 'Original', css: 'none' },
  { id: 'vivid', name: 'Vivid', css: 'saturate(1.35) contrast(1.12)' },
  { id: 'warm', name: 'Warm', css: 'sepia(.22) saturate(1.25) contrast(1.05) brightness(1.04)' },
  { id: 'cool', name: 'Cool', css: 'hue-rotate(-12deg) saturate(1.15) brightness(1.03)' },
  { id: 'film', name: 'Film', css: 'contrast(1.18) saturate(.88) sepia(.12)' },
  { id: 'mono', name: 'Mono', css: 'grayscale(1) contrast(1.15)' },
  { id: 'fade', name: 'Faded', css: 'contrast(.9) brightness(1.08) saturate(.85)' },
  { id: 'noir', name: 'Noir', css: 'grayscale(1) contrast(1.5) brightness(.92)' },
  { id: 'natural', name: 'Natural Rich', css: 'contrast(1.07) saturate(1.1) brightness(1.02)' },
  { id: 'luxe', name: 'Luxe', css: 'contrast(1.12) saturate(.82) sepia(.16) brightness(.96)' },
  { id: 'punch', name: 'Punch', css: 'saturate(1.6) contrast(1.25) brightness(1.02)' },
];

export const filterById = (id) => FILTERS.find((f) => f.id === id) || FILTERS[0];
