export interface ThemeColorPreset {
  /** Accessible name — a swatch is never identified by its colour alone. */
  name: string;
  hex: string;
}

/**
 * Curated presets, dark to light across the hue wheel. The page header follows the pick literally (deep picks
 * give a deep header, pastels a pastel one, mid tones stay mid tones; only its text flips between white and
 * near-black), so the palette runs from deep to airy rather than being all dark. The rest of the app (sidebar,
 * buttons, links) is derived from the same pick but is always kept dark enough for white text, and forest is the
 * app's existing default.
 */
export const THEME_COLOR_PRESETS: readonly ThemeColorPreset[] = [
  // deep
  { name: 'Deep forest', hex: '#315746' },
  { name: 'Sapphire', hex: '#1f4a8a' },
  { name: 'Aubergine', hex: '#4a2a55' },
  { name: 'Oxblood', hex: '#6b1f2a' },
  { name: 'Deep teal', hex: '#125c63' },
  { name: 'Onyx', hex: '#2a2d33' },
  // bright / mid
  { name: 'Emerald', hex: '#2e9e6b' },
  { name: 'Ocean', hex: '#2f80c9' },
  { name: 'Violet', hex: '#7c5cd6' },
  { name: 'Crimson', hex: '#c73a4d' },
  { name: 'Amber', hex: '#e0a02b' },
  { name: 'Coral', hex: '#f0745a' },
  // light
  { name: 'Sky', hex: '#8ec1ea' },
  { name: 'Mint', hex: '#9bd7b8' },
  { name: 'Lavender', hex: '#b9aaf0' },
  { name: 'Rose', hex: '#eba9bd' },
  { name: 'Butter', hex: '#f3e08e' },
  { name: 'Pearl', hex: '#e4e8ec' },
];
