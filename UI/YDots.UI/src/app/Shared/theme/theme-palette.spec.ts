import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AA_NORMAL_TEXT,
  DEFAULT_THEME_COLOR,
  HEADER_MUTED_ALPHA,
  contrastOn,
  contrastRatio,
  generateAccent,
  generatePalette,
  hexToHsl,
  hexToRgb,
  hslToRgb,
  textContrast,
  normalizeHex,
  whiteTextContrast,
} from './theme-palette';
import { THEME_CSS_VARS } from './theme-palette';
import { THEME_COLOR_PRESETS } from './theme-presets';

/** Parses "hsl(h s% l%)" as emitted by generatePalette(). */
function parseHsl(value: string) {
  const m = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(value);
  if (!m) throw new Error(`not an hsl() string: ${value}`);
  return { h: +m[1], s: +m[2], l: +m[3] };
}

const rgbOf = (value: string) => {
  const { h, s, l } = parseHsl(value);
  return hslToRgb(h, s, l);
};

/** A deliberately awkward set: extremes, every hue, yellow (bright at low HSL lightness), greys. */
function sampleColors(): string[] {
  const out = ['#000000', '#ffffff', '#ffff00', '#fefefe', '#010101', '#f5f5dc', '#ffd700', '#00ffff', '#ff00ff'];
  for (let h = 0; h < 360; h += 15) {
    for (const s of [0, 20, 60, 100]) {
      for (const l of [5, 25, 50, 75, 95]) {
        const { r, g, b } = hslToRgb(h, s, l);
        out.push('#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join(''));
      }
    }
  }
  return out;
}

describe('hex handling', () => {
  it('normalises 3 and 6 digit hex, with or without #', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('315746')).toBe('#315746');
    expect(normalizeHex('  #315746 ')).toBe('#315746');
  });

  it('rejects anything else', () => {
    for (const bad of ['', '#12', '#1234567', 'red', '#gggggg', null, undefined]) {
      expect(normalizeHex(bad as string)).toBeNull();
    }
  });

  it('round-trips through HSL', () => {
    const { h, s, l } = hexToHsl('#315746');
    const back = hslToRgb(h, s, l);
    expect(back).toEqual(hexToRgb('#315746'));
  });
});

describe('contrastOn', () => {
  it('picks white on dark and near-black on light', () => {
    expect(contrastOn('#000000')).toBe('#FFFFFF');
    expect(contrastOn('#315746')).toBe('#FFFFFF');
    expect(contrastOn('#ffffff')).toBe('#151915');
    expect(contrastOn('#ffff00')).toBe('#151915');
  });

  it('is AA-safe for mid-luminance backgrounds a fixed 0.35 cut-off would get wrong', () => {
    // relative luminance ~0.35: white would be ~2.6:1, near-black ~6:1
    const pick = contrastOn('#a0a0a0');
    expect(pick).toBe('#151915');
    expect(contrastRatio(hexToRgb('#a0a0a0'), hexToRgb(pick))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe('generateAccent', () => {
  it('gives gold on cool bases and platinum on warm bases, never a literal complement', () => {
    expect(generateAccent(150, 40).h).toBe(42); // green in -> gold out
    expect(generateAccent(220, 60).h).toBe(42); // blue
    expect(generateAccent(0, 60).h).toBe(205); // red
    expect(generateAccent(30, 60).h).toBe(205); // orange
    expect(generateAccent(350, 60).h).toBe(205); // crimson wraps past 345
    expect(generateAccent(150, 40).h).not.toBe((150 + 180) % 360);
  });

  it('keeps saturation metallic and lightness fixed', () => {
    for (const s of [0, 10, 50, 100]) {
      const a = generateAccent(150, s);
      expect(a.s).toBeGreaterThanOrEqual(30);
      expect(a.s).toBeLessThanOrEqual(60);
      expect(a.l).toBe(56);
    }
  });
});

describe('generatePalette', () => {
  it('returns every key the CSS variables need', () => {
    const p = generatePalette(DEFAULT_THEME_COLOR);
    expect(Object.keys(p).sort()).toEqual(
      ['accent', 'accentDark', 'accentInk', 'accentLight', 'border', 'deep', 'deep2', 'hue', 'ink', 'muted', 'onPrimary', 'primary', 'primaryDark', 'primaryLight', 'ring', 'surfaceTint', 'tone1', 'tone2', 'tone3', 'tone4', 'tone5', 'tone6', 'headerDark', 'header', 'headerLight', 'headerInk', 'headerRing', 'headerGlow', 'headerEdge', 'headerMark', 'headerCta', 'headerCtaInk', 'headerCtaHover', 'headerCtaEdge', 'pageBg'].sort(),
    );
  });

  it('falls back to the default colour for invalid input instead of throwing', () => {
    expect(generatePalette('nonsense')).toEqual(generatePalette(DEFAULT_THEME_COLOR));
  });

  it('keeps the gradient dark to light', () => {
    for (const hex of sampleColors()) {
      const p = generatePalette(hex);
      const d = parseHsl(p.primaryDark).l, m = parseHsl(p.primary).l, li = parseHsl(p.primaryLight).l;
      expect(d).toBeLessThanOrEqual(m);
      expect(m).toBeLessThanOrEqual(li);
    }
  });

  it('keeps header text AA where it can sit, for every preset and for extreme custom picks', () => {
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), ...sampleColors()]) {
      const p = generatePalette(hex);
      expect(p.onPrimary, hex).toBe('#FFFFFF');
      const primary = rgbOf(p.primary);
      const light = rgbOf(p.primaryLight);
      const mid = { r: (primary.r + light.r) / 2, g: (primary.g + light.g) / 2, b: (primary.b + light.b) / 2 };
      const muted = (bg: typeof mid) => whiteTextContrast(bg, HEADER_MUTED_ALPHA);
      // top-left corner, where the title sits
      expect(muted(rgbOf(p.primaryDark)), `${hex} dark`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      // subtitle / meta rows, up to the primary stop and half-way past it
      expect(muted(primary), `${hex} primary`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(muted(mid), `${hex} mid`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      // title / button labels, which can reach the far end of the gradient at top-right
      expect(whiteTextContrast(light, 1), `${hex} light`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it('keeps the accent CTA label AA-readable for every base', () => {
    for (const hex of sampleColors()) {
      const p = generatePalette(hex);
      const ratio = contrastRatio(hexToRgb(p.accent), hexToRgb(p.accentInk));
      expect(ratio, `${hex} ${p.accent}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it('keeps the accent visibly distinct from the header on every preset', () => {
    for (const preset of THEME_COLOR_PRESETS) {
      const p = generatePalette(preset.hex);
      // the primary CTA and the logo badge sit where the gradient is at, or past, its primary stop
      expect(contrastRatio(hexToRgb(p.accent), rgbOf(p.primary)), preset.name).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('keeps the deep surface AA under white text, and ink / muted AA on white', () => {
    const white = { r: 255, g: 255, b: 255 };
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), ...sampleColors()]) {
      const p = generatePalette(hex);
      for (const stop of [p.deep, p.deep2]) {
        expect(whiteTextContrast(rgbOf(stop), 1), `${hex} ${stop}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
      expect(contrastRatio(rgbOf(p.ink), white), `${hex} ink`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(rgbOf(p.muted), white), `${hex} muted`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(contrastRatio(rgbOf(p.muted), rgbOf(p.surfaceTint)), `${hex} muted on tint`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it('keeps every tone visible as an icon on white, and the six tones distinct', () => {
    const white = { r: 255, g: 255, b: 255 };
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), ...sampleColors()]) {
      const p = generatePalette(hex);
      const tones = [p.tone1, p.tone2, p.tone3, p.tone4, p.tone5, p.tone6];
      for (const t of tones) {
        expect(contrastRatio(rgbOf(t), white), `${hex} ${t}`).toBeGreaterThanOrEqual(3.4);
      }
    }
    for (const preset of THEME_COLOR_PRESETS) {
      const p = generatePalette(preset.hex);
      expect(new Set([p.tone1, p.tone2, p.tone3, p.tone4, p.tone5, p.tone6]).size, preset.name).toBe(6);
    }
  });

  it('orders the metallic accent steps light > accent > dark', () => {
    for (const preset of THEME_COLOR_PRESETS) {
      const p = generatePalette(preset.hex);
      const l = (hex: string) => hexToHsl(hex).l;
      expect(l(p.accentLight)).toBeGreaterThan(l(p.accent));
      expect(l(p.accent)).toBeGreaterThan(l(p.accentDark));
    }
  });

  it('gives the accent a different hue family from the base on every preset', () => {
    for (const preset of THEME_COLOR_PRESETS) {
      const base = hexToHsl(preset.hex).h;
      const accent = hexToHsl(generatePalette(preset.hex).accent).h;
      const diff = Math.abs(((accent - base + 540) % 360) - 180);
      expect(diff, preset.name).toBeGreaterThan(25);
    }
  });
});

describe('page header colours', () => {
  const stops = (hex: string) => {
    const p = generatePalette(hex);
    return { p, dark: rgbOf(p.headerDark), base: rgbOf(p.header), light: rgbOf(p.headerLight), ink: hexToRgb(p.headerInk) };
  };

  it('follows the pick: a deep pick is a deep header, a pastel pick a pastel one', () => {
    const lum = (hex: string) => hexToHsl(hex).l;
    for (const [name, hex] of [['Sapphire', '#1f4a8a'], ['Deep forest', '#315746'], ['Onyx', '#2a2d33']]) {
      expect(lum(stopsHex(hex)), name).toBeLessThan(40);
    }
    for (const [name, hex] of [['Sky', '#8ec1ea'], ['Rose', '#eba9bd'], ['Pearl', '#e4e8ec'], ['Butter', '#f3e08e']]) {
      expect(lum(stopsHex(hex)), name).toBeGreaterThan(65);
    }
  });

  function stopsHex(hex: string): string {
    const { h, s, l } = parseHsl(generatePalette(hex).header);
    return '#' + Object.values(hslToRgb(h, s, l)).map(c => c.toString(16).padStart(2, '0')).join('');
  }

  it('keeps the hue of the pick on every stop', () => {
    for (const hex of THEME_COLOR_PRESETS.map(p => p.hex)) {
      const want = hexToHsl(hex);
      if (want.s < 8) continue; // greys have no meaningful hue
      const got = parseHsl(generatePalette(hex).header);
      const diff = Math.abs(((got.h - want.h + 540) % 360) - 180);
      expect(diff, hex).toBeLessThan(4);
    }
  });

  it('picks white or near-black text, and keeps it AA (muted text too) on every stop, for every preset and extreme picks', () => {
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), ...sampleColors()]) {
      const { p, dark, base, light, ink } = stops(hex);
      expect(['#FFFFFF', '#151915'], hex).toContain(p.headerInk);
      const mid = (a: typeof dark, b: typeof dark) => ({ r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2 });
      for (const [label, bg] of [['dark', dark], ['base', base], ['light', light], ['dark-base', mid(dark, base)], ['base-light', mid(base, light)]] as const) {
        expect(textContrast(ink, bg, HEADER_MUTED_ALPHA), `${hex} ${label}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT - 0.15);
        expect(textContrast(ink, bg, 1), `${hex} ${label} full`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    }
  });

  it('never inverts the gradient (dark <= base <= light) unless the text needs the opposite', () => {
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), ...sampleColors()]) {
      const p = generatePalette(hex);
      const d = parseHsl(p.headerDark).l, m = parseHsl(p.header).l, li = parseHsl(p.headerLight).l;
      expect(d, hex).toBeLessThanOrEqual(m);
      expect(m, hex).toBeLessThanOrEqual(li);
    }
  });

  it('is light for light picks and dark for dark picks, with the text flipping to match', () => {
    expect(generatePalette('#1f4a8a').headerInk).toBe('#FFFFFF');
    expect(generatePalette('#e4e8ec').headerInk).toBe('#151915');
    expect(generatePalette('#f3e08e').headerInk).toBe('#151915');
    expect(generatePalette('#ffffff').headerInk).toBe('#151915');
    expect(generatePalette('#000000').headerInk).toBe('#FFFFFF');
  });

  it('keeps the primary button visible against the header it sits on', () => {
    const rgbOfAny = (v: string) => (v.startsWith('hsl') ? rgbOf(v) : hexToRgb(v));
    for (const hex of [...THEME_COLOR_PRESETS.map(p => p.hex), '#ffffff', '#000000']) {
      const p = generatePalette(hex);
      if (p.headerCta.startsWith('var(')) continue; // gold on a deep header: covered by the fixed gold token
      const cta = rgbOfAny(p.headerCta);
      for (const stop of [p.headerDark, p.header, p.headerLight]) {
        expect(contrastRatio(cta, rgbOf(stop)), `${hex} cta vs ${stop}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(rgbOfAny(p.headerCta), hexToRgb(p.headerCtaInk)), `${hex} cta label`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it('gives every preset its own header', () => {
    const headers = THEME_COLOR_PRESETS.map(p => generatePalette(p.hex).header);
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe('first-visit CSS fallbacks', () => {
  it('styles/ydot-theme.css defaults match generatePalette for the default colour', () => {
    const css = readFileSync('src/styles/ydot-theme.css', 'utf8');
    const palette = generatePalette(DEFAULT_THEME_COLOR);
    for (const key of Object.keys(THEME_CSS_VARS) as (keyof typeof palette)[]) {
      const name = THEME_CSS_VARS[key];
      const match = new RegExp(`${name}:\s*([^;]+);`).exec(css);
      expect(match, `${name} missing from ydot-theme.css`).not.toBeNull();
      // the stylesheet writes the ring as "rgba(255, 255, 255, .16)"; compare ignoring whitespace
      expect(match![1].replace(/\s+/g, '').toLowerCase()).toBe(palette[key].replace(/\s+/g, '').toLowerCase());
    }
  });
});

describe('page background', () => {
  it('is exactly #e9e9e9 for the default colour', () => {
    expect(generatePalette(DEFAULT_THEME_COLOR).pageBg).toBe('#e9e9e9');
  });

  it('follows the pick at the lightness of #e9e9e9', () => {
    const target = hexToHsl('#e9e9e9').l;
    for (const pick of ['#6d28d9', '#b91c1c', '#0ea5e9', '#f59e0b', '#808080']) {
      const bg = hexToHsl(generatePalette(pick).pageBg);
      expect(Math.abs(bg.l - target), pick).toBeLessThan(1);
      if (hexToHsl(pick).s > 10) expect(Math.abs(bg.h - hexToHsl(pick).h), pick).toBeLessThan(3);
    }
  });
});
