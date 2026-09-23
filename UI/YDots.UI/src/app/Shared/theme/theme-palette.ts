/**
 * Pure colour maths for the app theme. Nothing here touches the DOM, so it is trivially testable and
 * everything else (ThemeColorService, the boot cache in index.html, the picker's contrast readout)
 * consumes the one function, generatePalette().
 *
 * Two deliberate departures from a naive "pick white or black by luminance" approach:
 *
 *  1. contrastOn() picks whichever of white / near-black has the HIGHER measured contrast ratio.
 *     A fixed luminance cut-off cannot be AA-correct for both sides: white only reaches 4.5:1 while
 *     the background's luminance is at or below ~0.18, and near-black only from ~0.18 upwards, so the
 *     crossover sits near 0.18, not 0.35 (at 0.35 white text is 2.6:1).
 *
 *  2. The APP-WIDE primary (--theme-primary*: sidebar, buttons, links) is always drawn dark (lightness clamped
 *     to 22-34) whatever swatch was picked, so its text colour must be judged against its own gradient stops,
 *     not against the raw pick. Judging the raw pick would put near-black text on a dark panel for any light
 *     custom colour. That gradient is therefore also darkened, where needed, so that 78%-white text reaches
 *     4.5:1 on the primary stop and half-way to the light stop, and full white reaches 4.5:1 on the light stop.
 *
 * The PAGE HEADER is the exception to (2): it has its own header* entries (generateHeader) that follow the pick
 * literally, light picks giving a light header with dark text, and only nudge the pick as far as its text needs.
 */

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface ThemePalette {
  /**
   * Hue of the base colour as a bare number of degrees (0-359). Component CSS builds its hue-tinted greys and
   * washes from it, `hsl(calc(var(--theme-hue) - 13) 28% 27%)`, so one pick recolours every screen.
   */
  hue: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  onPrimary: string;
  accent: string;
  accentInk: string;
  surfaceTint: string;
  ring: string;
  /** Deepest tone of the theme hue: sidebar and other large dark surfaces. Always AA with white text. */
  deep: string;
  /** Slightly lighter than `deep`, for the bottom of a vertical gradient. */
  deep2: string;
  /** Lighter and darker steps of the accent, for a metallic gradient on the accent CTA. */
  accentLight: string;
  accentDark: string;
  /** Hue-tinted near-black for card titles and values; AA on white. */
  ink: string;
  /** Hue-tinted grey for captions and helper text; AA on white and on the surface tint. */
  muted: string;
  /** Hue-tinted hairline for card and table borders. */
  border: string;
  /**
   * Six harmonised tones for card washes and icons: the base hue and its analogues, plus the accent's
   * family. Each is dark enough to read as an icon on white (>= 3.4:1), and each pairs with the accent.
   */
  tone1: string;
  tone2: string;
  tone3: string;
  tone4: string;
  tone5: string;
  tone6: string;
  /**
   * The PAGE HEADER's own colours. Unlike everything above (which is kept dark enough to carry white text and
   * white-on-colour buttons app-wide), the header follows the pick literally: a deep pick gives a deep header, a
   * pastel pick gives a pastel header, a mid tone stays a mid tone. Only the text colour flips (white or
   * near-black), and the stops are nudged just far enough for that text to stay AA. See generateHeader().
   */
  headerDark: string;
  header: string;
  headerLight: string;
  /** Text colour on the header: white or near-black, whichever needs the smaller change to the pick. */
  headerInk: string;
  /** The ring, the glow, the hairline and the watermark opacity, tuned to the text colour above. */
  headerRing: string;
  headerGlow: string;
  headerEdge: string;
  headerMark: string;
  /**
   * The header's primary (call-to-action) button: the app's gold on a deep header, and a deep tone of the pick on a
   * light or mid-tone one, where gold would melt into an amber, coral or butter header.
   */
  headerCta: string;
  headerCtaInk: string;
  headerCtaHover: string;
  headerCtaEdge: string;
  /**
   * Page (screen) background behind every card. The default theme gives exactly #e9e9e9; any other pick gives a
   * soft tint of its own hue at the same lightness as #e9e9e9, so the page keeps that weight whatever the colour.
   */
  pageBg: string;
}

/** ThemePalette key -> CSS custom property, applied 1:1 onto :root. */
export const THEME_CSS_VARS: Readonly<Record<keyof ThemePalette, string>> = {
  hue: '--theme-hue',
  primary: '--theme-primary',
  primaryDark: '--theme-primary-dark',
  primaryLight: '--theme-primary-light',
  onPrimary: '--theme-on-primary',
  accent: '--theme-accent',
  accentInk: '--theme-accent-ink',
  surfaceTint: '--theme-surface-tint',
  ring: '--theme-ring',
  deep: '--theme-deep',
  deep2: '--theme-deep-2',
  accentLight: '--theme-accent-light',
  accentDark: '--theme-accent-dark',
  ink: '--theme-ink',
  muted: '--theme-muted',
  border: '--theme-border',
  tone1: '--theme-tone-1',
  tone2: '--theme-tone-2',
  tone3: '--theme-tone-3',
  tone4: '--theme-tone-4',
  tone5: '--theme-tone-5',
  tone6: '--theme-tone-6',
  headerDark: '--theme-header-dark',
  header: '--theme-header',
  headerLight: '--theme-header-light',
  headerInk: '--theme-header-ink',
  headerRing: '--theme-header-ring',
  headerGlow: '--theme-header-glow',
  headerEdge: '--theme-header-edge',
  headerMark: '--theme-header-mark',
  headerCta: '--theme-header-cta',
  headerCtaInk: '--theme-header-cta-ink',
  headerCtaHover: '--theme-header-cta-hover',
  headerCtaEdge: '--theme-header-cta-edge',
  pageBg: '--theme-page-bg',
};

export const DEFAULT_THEME_COLOR = '#315746';

const INK = '#151915';
const WHITE = '#FFFFFF';

/** Alpha of the faintest white text on the header (the meta row). */
export const HEADER_MUTED_ALPHA = 0.78;
/** The accent must stay this distinct from the app-wide primary (the CTA badge sits against it). */
const ACCENT_MIN_CONTRAST = 2.6;
const ACCENT_MAX_L = 66;
export const AA_NORMAL_TEXT = 4.5;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Accepts #rgb or #rrggbb (with or without #); returns lowercase #rrggbb, or null when invalid. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  let v = input.trim().toLowerCase();
  if (v.startsWith('#')) v = v.slice(1);
  if (/^[0-9a-f]{3}$/.test(v)) v = v.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/.test(v) ? `#${v}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex) ?? DEFAULT_THEME_COLOR;
  const v = parseInt(n.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const hn = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Inverse of hsl(): "hsl(153 25% 29%)" -> "#xxxxxx". Returns null for anything else. */
export function hslStringToHex(value: string): string | null {
  const m = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(value);
  return m ? hslToHex(+m[1], +m[2], +m[3]) : null;
}

/** CSS hsl() string. Values are rounded to whole numbers, so what is measured is what is emitted. */
export function hsl(h: number, s: number, l: number): string {
  const hue = ((Math.round(h) % 360) + 360) % 360; // analogous tones can dip below 0
  return `hsl(${hue} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`;
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Near-black or white, whichever reads better on `hex`. */
export function contrastOn(hex: string): string {
  const bg = hexToRgb(hex);
  return contrastRatio(bg, hexToRgb(WHITE)) >= contrastRatio(bg, hexToRgb(INK)) ? WHITE : INK;
}

/** Contrast of white text at `alpha` composited over `bg`, measured against `bg`. */
export function whiteTextContrast(bg: Rgb, alpha = 1): number {
  const mix = (c: number) => Math.round(255 * alpha + c * (1 - alpha));
  return contrastRatio({ r: mix(bg.r), g: mix(bg.g), b: mix(bg.b) }, bg);
}

/**
 * Curated luxury contrast accent: warm base -> cool platinum, cool base -> warm gold. Deliberately not
 * a 180-degree complement (that reads garish): the hue is anchored in the gold (~42) or platinum (~205)
 * family, with saturation and lightness pulled into a metallic range however saturated the base is.
 */
export function generateAccent(baseH: number, baseS: number): Hsl {
  const isWarm = baseH >= 345 || baseH < 75; // reds, oranges, yellows
  return {
    h: isWarm ? 205 : 42,
    s: clamp(baseS * 0.55 + 22, 30, 60), // metallic, never neon
    l: 56,
  };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b) };
}

/** Lower `l` until white text at the header's faintest alpha reaches AA on this hue/saturation. */
function darkenUntilReadable(h: number, s: number, l: number): number {
  let ln = Math.round(l);
  while (ln > 8 && whiteTextContrast(hslToRgb(h, s, ln), HEADER_MUTED_ALPHA) < AA_NORMAL_TEXT) ln -= 1;
  return ln;
}

/** The light stop is judged on itself (full white) and on its blend with the primary stop (muted white). */
function lightStopReadable(h: number, s: number, l: number, primary: Rgb): boolean {
  const light = hslToRgb(h, s, l);
  return (
    whiteTextContrast(light, 1) >= AA_NORMAL_TEXT &&
    whiteTextContrast(mixRgb(primary, light, 0.5), HEADER_MUTED_ALPHA) >= AA_NORMAL_TEXT
  );
}

/** Contrast of `fg` at `alpha` composited over `bg`, measured against `bg`. */
export function textContrast(fg: Rgb, bg: Rgb, alpha = 1): number {
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return contrastRatio({ r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) }, bg);
}

interface HeaderStops {
  dark: Hsl;
  base: Hsl;
  light: Hsl;
  ink: string;
}

/**
 * Header colours from the pick itself. The pick's hue and saturation are kept as chosen (a grey stays grey);
 * lightness is kept too, except for the minimum change that lets the text on it reach AA. That text is either
 * white or near-black. Both candidates are worked out and the one that moves the pick least wins, so a deep
 * colour keeps white text, a pastel keeps dark text, and a mid tone lands on whichever side is closer instead of
 * being forced dark.
 *
 * Three stops, dark corner (top-left, where the title sits) -> base -> light corner. The stops are moved away
 * from the text's direction of trouble only as far as needed, and never past the base, so the gradient cannot
 * invert. Faintest text on the header is the meta row at HEADER_MUTED_ALPHA; every stop, and the blend of
 * neighbouring stops, is held to AA for it.
 */
function generateHeaderStops(hex: string): HeaderStops {
  const { h: hRaw, s, l } = hexToHsl(normalizeHex(hex) ?? DEFAULT_THEME_COLOR);
  // measure exactly what hsl() will emit: whole-number hue and saturation
  const h = ((Math.round(hRaw) % 360) + 360) % 360;
  const sat = Math.round(clamp(s, 0, 100));
  const lightSat = Math.round(clamp(s * 0.9, 0, 100));
  const rgbAt = (sa: number, ln: number) => hslToRgb(h, sa, ln);
  const white = hexToRgb(WHITE);
  const ink = hexToRgb(INK);
  const start = Math.round(clamp(l, 0, 100));
  const readable = (fg: Rgb, bg: Rgb) => textContrast(fg, bg, HEADER_MUTED_ALPHA) >= AA_NORMAL_TEXT;

  // WHITE text: darken the base until it reads, then the dark stop is simply deeper, and the light stop climbs
  // only while white still reads on it and on its blend with the base.
  let whiteBase = start;
  while (whiteBase > 0 && !readable(white, rgbAt(sat, whiteBase))) whiteBase -= 1;
  // INK text: lighten the base until it reads; the light stop is simply lighter, and the dark stop sinks only
  // while ink still reads on it and on its blend with the base.
  let inkBase = start;
  while (inkBase < 100 && !readable(ink, rgbAt(sat, inkBase))) inkBase += 1;

  const useWhite = start - whiteBase <= inkBase - start;
  const base = useWhite ? whiteBase : inkBase;
  const fg = useWhite ? white : ink;
  const baseRgb = rgbAt(sat, base);

  // The gradient always spans about SPREAD points of lightness. The side the text cannot go towards is found
  // first (it climbs / sinks only while the text still reads); the other side takes up the rest, so a pick that
  // had to be nudged still shows a visible gradient instead of a flat end.
  const SPREAD = 20;
  let darkL: number;
  let lightL: number;
  if (useWhite) {
    lightL = base;
    for (let ln = Math.min(100, base + 10); ln > base; ln -= 1) {
      const stop = rgbAt(lightSat, ln);
      const mid = mixRgb(baseRgb, stop, 0.5);
      if (readable(fg, stop) && readable(fg, mid)) { lightL = ln; break; }
    }
    darkL = Math.max(0, base - (SPREAD - (lightL - base)));
  } else {
    darkL = base;
    for (let ln = Math.max(0, base - 10); ln < base; ln += 1) {
      const stop = rgbAt(sat, ln);
      const mid = mixRgb(baseRgb, stop, 0.5);
      if (readable(fg, stop) && readable(fg, mid)) { darkL = ln; break; }
    }
    lightL = Math.min(100, base + (SPREAD - (base - darkL)));
  }

  return {
    dark: { h, s: sat, l: darkL },
    base: { h, s: sat, l: base },
    light: { h, s: lightSat, l: lightL },
    ink: useWhite ? WHITE : INK,
  };
}

/** The header's palette entries: the three stops, the text colour, and the decoration tuned to that text. */
function generateHeader(hex: string): Pick<
  ThemePalette,
  | 'headerDark' | 'header' | 'headerLight' | 'headerInk' | 'headerRing' | 'headerGlow' | 'headerEdge' | 'headerMark'
  | 'headerCta' | 'headerCtaInk' | 'headerCtaHover' | 'headerCtaEdge'
> {
  const stops = generateHeaderStops(hex);
  const onDark = stops.ink === WHITE;
  return {
    headerDark: hsl(stops.dark.h, stops.dark.s, stops.dark.l),
    header: hsl(stops.base.h, stops.base.s, stops.base.l),
    headerLight: hsl(stops.light.h, stops.light.s, stops.light.l),
    headerInk: stops.ink,
    // white ring and soft white glow on a deep header; a dark hairline ring and a brighter glow on a light one
    headerRing: onDark ? 'rgba(255,255,255,.16)' : 'rgba(21,25,21,.14)',
    headerGlow: onDark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.55)',
    // a hairline only where the panel could melt into a white page
    headerEdge: onDark ? 'transparent' : 'rgba(21,25,21,.1)',
    headerMark: onDark ? '0.1' : '0.09',
    // gold (the app's fixed CTA colour, read from ydot-premium.css) on a deep header; a deep tone of the pick
    // with white text on a light one
    headerCta: onDark ? 'var(--lx-gold,#c1a466)' : hsl(stops.base.h, clamp(stops.base.s * 0.5, 10, 40), 15),
    headerCtaInk: onDark ? 'var(--lx-gold-ink,#1e1907)' : WHITE,
    headerCtaHover: onDark ? 'var(--lx-gold-dark,#a98c4d)' : hsl(stops.base.h, clamp(stops.base.s * 0.5, 10, 40), 25),
    headerCtaEdge: onDark ? 'var(--lx-gold-dark,#a98c4d)' : hsl(stops.base.h, clamp(stops.base.s * 0.5, 10, 40), 15),
  };
}

/** Contrast an icon needs against white to stay clearly visible (WCAG non-text contrast is 3:1). */
export const ICON_CONTRAST = 3.4;

/** Darken a hue until it reaches ICON_CONTRAST on white. */
function iconTone(hRaw: number, sRaw: number, l: number): string {
  // measure exactly what hsl() will emit: whole-number hue and saturation
  const h = ((Math.round(hRaw) % 360) + 360) % 360;
  const s = Math.round(clamp(sRaw, 0, 100));
  let ln = Math.round(l);
  while (ln > 18 && contrastRatio(hslToRgb(h, s, ln), { r: 255, g: 255, b: 255 }) < ICON_CONTRAST) ln -= 1;
  return hsl(h, s, ln);
}

export function generatePalette(baseHex: string): ThemePalette {
  const { h, s, l } = hexToHsl(normalizeHex(baseHex) ?? DEFAULT_THEME_COLOR);
  const baseL = clamp(l, 22, 34); // keep the header dark and readable whichever swatch is picked

  const pS = clamp(s * 0.9, 25, 70);
  const lS = clamp(s * 0.75, 20, 60);

  // Gradient stops: dark corner top-left -> primary -> lighter bottom-right. Warm/yellow hues are bright at
  // the same HSL lightness, so the stops are capped until white text stays AA on them (see the note at the
  // top of this file). The light stop is never allowed below the primary stop, so the gradient cannot invert.
  const primaryL = darkenUntilReadable(h, pS, baseL + 2);
  const primaryRgb = hslToRgb(h, pS, primaryL);
  let lightL = Math.round(baseL + 16);
  while (lightL > primaryL && !lightStopReadable(h, lS, lightL, primaryRgb)) lightL -= 1;
  lightL = Math.max(lightL, primaryL);
  const darkL = Math.max(6, Math.min(baseL - 9, primaryL - 8));

  // Sidebar / table-head tone: darker than the header's dark stop, so it reads as the deepest surface.
  const deepL = Math.max(6, darkL - 6);
  const deepS = clamp(pS * 0.85, 20, 60);

  const toneS = clamp(s * 0.9 + 6, 30, 62);
  const accent = generateAccent(h, s);
  // A warm base (orange, amber, coral) gets the cool platinum accent, and a dark warm primary is bright enough
  // that the standard-lightness accent sinks into it. Lift the accent only as far as it needs to stay visibly
  // distinct from the primary; picks that already clear the bar keep the exact accent they had.
  const primaryForAccent = hslToRgb(h, pS, primaryL);
  let accentL = accent.l;
  while (accentL < ACCENT_MAX_L && contrastRatio(hslToRgb(accent.h, accent.s, accentL), primaryForAccent) < ACCENT_MIN_CONTRAST) {
    accentL += 1;
  }
  const accentHex = hslToHex(accent.h, accent.s, accentL);
  const lightRgb = hslToRgb(h, lS, lightL);

  return {
    hue: String(((Math.round(h) % 360) + 360) % 360),
    primary: hsl(h, pS, primaryL),
    primaryDark: hsl(h, pS, darkL),
    primaryLight: hsl(h, lS, lightL),
    // Judged on the lightest gradient stop, not on baseHex: see the note at the top of this file.
    onPrimary: contrastOn(rgbToHex(lightRgb)),
    accent: accentHex,
    accentInk: contrastOn(accentHex),
    surfaceTint: hsl(h, clamp(s * 0.4, 10, 40), 92), // very light tint for icon discs, badges, backgrounds
    ring: 'rgba(255,255,255,.16)',
    deep: hsl(h, deepS, deepL),
    deep2: hsl(h, deepS, deepL + 6),
    accentLight: hslToHex(accent.h, accent.s, Math.max(68, accentL + 6)),
    accentDark: hslToHex(accent.h, clamp(accent.s + 6, 0, 70), 44),
    ink: hsl(h, clamp(s * 0.35, 10, 30), 14),
    muted: hsl(h, clamp(s * 0.15, 6, 14), 38),
    border: hsl(h, clamp(s * 0.25, 8, 20), 90),
    tone1: iconTone(h, toneS, 40),
    tone2: iconTone(h + 34, toneS, 40),
    tone3: iconTone(h - 34, toneS, 40),
    tone4: iconTone(h + 68, toneS, 40),
    tone5: iconTone(accent.h, clamp(accent.s + 4, 30, 64), 42),
    tone6: iconTone(h - 68, toneS, 40),
    ...generateHeader(baseHex),
    pageBg: pageBackground(baseHex),
  };
}

/** Neutral page background of the default theme; other picks tint it with their own hue at this lightness. */
export const PAGE_BG_DEFAULT = '#e9e9e9';

function pageBackground(baseHex: string): string {
  const hex = normalizeHex(baseHex) ?? DEFAULT_THEME_COLOR;
  if (hex.toLowerCase() === DEFAULT_THEME_COLOR.toLowerCase()) return PAGE_BG_DEFAULT;
  const { h, s } = hexToHsl(hex);
  const { l } = hexToHsl(PAGE_BG_DEFAULT); // ~91.4%
  return hslToHex(h, clamp(s * 0.4, 0, 32), l);
}

/**
 * Bootstrap-era variables (buttons, links, focus rings, active tabs, the ones app.min.css and the vendor
 * bootstrap.min.css read). They follow the theme's DERIVED primary rather than the raw pick, so they stay
 * in the same dark, AA-safe family as the header and a very light pick cannot produce a white-on-white
 * button. ThemeColorService writes them for every screen, so pages without the customiser (sign-in and the
 * other auth screens) follow the pick too.
 */
export function legacyPrimaryVars(baseHex: string): Record<string, string> {
  const derived = hslStringToHex(generatePalette(baseHex).primary) ?? normalizeHex(baseHex) ?? DEFAULT_THEME_COLOR;
  const { r, g, b } = hexToRgb(derived);
  const rgb = `${r}, ${g}, ${b}`;
  return {
    '--primary': derived,
    '--color-primary': derived,
    '--primary-rgb': rgb,
    '--pe-primary': derived,
    '--pe-primary-rgb': rgb,
    '--pe-primary-text-emphasis': derived,
    '--pe-primary-bg-subtle': `rgba(${rgb}, 0.1)`,
    '--pe-primary-border-subtle': `rgba(${rgb}, 0.5)`,
    '--pe-link-color-rgb': rgb,
    '--accent': derived,
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
