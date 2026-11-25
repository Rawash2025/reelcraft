/**
 * Brand configuration.
 *
 * Kept entirely out of the renderer: the renderer only ever sees resolved
 * colours and sizes. Adding a brand is adding an entry here.
 */

export const BRANDS = {
  none: {
    id: 'none',
    name: 'No branding',
    primary: '#7c5cff',
    secondary: '#ff3d68',
    background: '#0b0b0f',
    text: '#ffffff',
    captionAccent: '#ffe600',
    heading: 'Archivo Black',
    body: 'Inter',
    radius: 0.16,
    transition: 'whip',
    logo: null,
    cta: { label: 'Follow for more', style: 'badge' },
  },

  olive: {
    id: 'olive',
    name: 'Olive & Gold',
    // Olive palette from the brief.
    primary: '#5c6454',
    secondary: '#808000',
    tertiary: '#9aad00',
    deep: '#6b6b00',
    background: '#0e100d',
    text: '#f4f6f1',
    captionAccent: '#9aad00',
    gold: '#d6b35a',
    cream: '#f5f1e8',
    heading: 'Archivo Black',
    body: 'Inter',
    radius: 0.12,
    transition: 'whip',
    logo: null,
    cta: { label: 'Apply now', url: 'yourwebsite.com', style: 'badge' },
    // Domain vocabulary the classifier and B-roll engine can lean on.
    vocabulary: {
      terms: [
        'mortgage', 'pre-approval', 'pre approval', 'ltv', 'emi', 'down payment',
        'salary', 'self-employed', 'expat', 'uae national', 'bank', 'rate',
        'property', 'dubai', 'abu dhabi', 'valuation', 'eligibility', 'deposit',
      ],
      brollQueries: [
        'dubai skyline property', 'signing mortgage documents', 'bank advisor meeting',
        'modern apartment interior dubai', 'handing over house keys',
        'calculator financial paperwork', 'abu dhabi real estate',
      ],
    },
  },
};

// The Signature look: olive room, cream paper, champagne accent, matte panels.
// `surface: 'matte'` tells the scene renderer to draw cloth-like panels with a
// hairline instead of glowing glass.
BRANDS.signature = {
  ...BRANDS.olive,
  id: 'signature',
  name: 'Signature',
  primary: '#5F6750',
  secondary: '#444B3B',
  tertiary: '#C7B995',
  deep: '#444B3B',
  background: '#1c2018',
  text: '#F3EBDD',
  captionAccent: '#C7B995',
  gold: '#C7B995',
  cream: '#F3EBDD',
  heading: 'Montserrat',
  body: 'Montserrat',
  radius: 0.03,
  transition: 'none',
  surface: 'matte',
  cta: { label: 'Talk to a mortgage expert', url: 'yourwebsite.com', style: 'badge' },
};

export const brandIds = () => Object.keys(BRANDS);
export const getBrand = (id) => BRANDS[id] || BRANDS.none;

/**
 * Brand-aware project settings. `strength` (0..1) controls how far the brand
 * overrides the template's own look — at 0 only the accent moves.
 */
export function applyBrandToProject(project, brandId, strength = 1) {
  const b = getBrand(brandId);
  if (b.id === 'none') return project;
  const s = Math.max(0, Math.min(1, strength));
  return {
    ...project,
    accent: b.captionAccent || b.primary,
    background: s > 0.6 ? b.background : project.background,
    brand: b.id,
    brandStrength: s,
  };
}
