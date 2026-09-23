import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_THEME_COLOR,
  THEME_CSS_VARS,
  ThemePalette,
  generatePalette,
  legacyPrimaryVars,
  normalizeHex,
} from './theme-palette';

/** Persisted colour: the single hex the whole theme is derived from. */
export const THEME_COLOR_KEY = 'theme:color';

/**
 * Derived CSS variables, cached next to the colour so the blocking script in index.html can paint the
 * right theme on first frame without shipping a second copy of the palette algorithm. `v` invalidates
 * the cache if generatePalette() ever changes; a stale or missing cache only costs one unthemed frame.
 */
export const THEME_PALETTE_CACHE_KEY = 'theme:palette';
const PALETTE_CACHE_VERSION = 7;

/** How long a live-dragged colour must sit still before it is written to storage. */
export const PERSIST_DELAY_MS = 400;

/** Class on <html> while a colour is being dragged; styles/ydot-theme.css turns transitions off under it. */
export const LIVE_CLASS = 'theme-live';

/** The customizer's own storage, read once so a colour picked before this service existed carries over. */
const LEGACY_SETTINGS_KEY = 'app-theme-settings';

/**
 * Single source of truth for the app theme colour. Holds the hex, derives the palette, and writes it
 * onto :root as --theme-* custom properties, so every themed component just reads variables and a change
 * lands on the next paint everywhere with no re-render and no prop passing.
 */
@Injectable({ providedIn: 'root' })
export class ThemeColorService {
  private readonly document = inject(DOCUMENT);

  private readonly color = signal<string>(this.readInitialColor());

  readonly themeColor = this.color.asReadonly();
  readonly palette = computed<ThemePalette>(() => generatePalette(this.color()));

  constructor() {
    this.apply(this.color());

    // Another tab changed the colour: follow it, without writing back (which would ping-pong).
    this.document.defaultView?.addEventListener('storage', event => {
      if (event.key !== THEME_COLOR_KEY) return;
      const next = normalizeHex(event.newValue) ?? DEFAULT_THEME_COLOR;
      if (next === this.color()) return;
      this.color.set(next);
      this.apply(next);
    });
  }

  /** Returns false, leaving the theme untouched, when `hex` is not a valid colour. */
  setThemeColor(hex: string): boolean {
    const next = normalizeHex(hex);
    if (!next) return false;
    this.cancelPendingPersist();
    if (next !== this.color()) {
      this.color.set(next);
      this.apply(next);
    }
    this.persist(next);
    return true;
  }

  /**
   * Live preview while the colour is being dragged (the native picker fires an event for every mouse move): the
   * page repaints at once, but nothing is written to storage per event. The colour is saved once the drag has
   * been quiet for PERSIST_DELAY_MS, or immediately by setThemeColor() when the picker commits. Callers should
   * still rate-limit how often they call this (the picker does), because every call restyles the whole app.
   */
  previewThemeColor(hex: string): boolean {
    const next = normalizeHex(hex);
    if (!next) return false;
    if (next !== this.color()) {
      this.color.set(next);
      this.apply(next);
    }
    this.cancelPendingPersist();
    // While the colour is being dragged, colour transitions across the app would keep restarting on every update
    // (buttons, cards, rows all ease their colours), so they are switched off until the drag settles.
    this.document.documentElement.classList.add(LIVE_CLASS);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.document.documentElement.classList.remove(LIVE_CLASS);
      this.persist(next);
    }, PERSIST_DELAY_MS);
    return true;
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPalette: { hex: string; palette: ThemePalette } | null = null;

  private cancelPendingPersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.document.documentElement.classList.remove(LIVE_CLASS);
  }

  resetThemeColor(): void {
    this.setThemeColor(DEFAULT_THEME_COLOR);
  }

  private apply(hex: string): void {
    const palette = generatePalette(hex);
    this.lastPalette = { hex, palette };
    const style = this.document.documentElement.style;
    for (const key of Object.keys(THEME_CSS_VARS) as (keyof ThemePalette)[]) {
      style.setProperty(THEME_CSS_VARS[key], palette[key]);
    }
    const legacy = legacyPrimaryVars(hex);
    for (const [name, value] of Object.entries(legacy)) {
      style.setProperty(name, value);
    }
    this.syncBrowserChrome(legacy['--primary']);
  }

  /**
   * Keeps <meta name="theme-color"> (mobile browser chrome, PWA title bar) on the theme's derived primary.
   * It needs a resolved colour, not a var(), so it takes the hex from legacyPrimaryVars(), the same value
   * --theme-primary resolves to.
   */
  private syncBrowserChrome(color: string): void {
    const head = this.document.head;
    let meta = head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = this.document.createElement('meta');
      meta.name = 'theme-color';
      head.appendChild(meta);
    }
    meta.content = color;
  }

  private persist(hex: string): void {
    try {
      // apply() has just derived this palette for the same colour: reuse it rather than deriving it again
      const palette = this.lastPalette?.hex === hex ? this.lastPalette.palette : generatePalette(hex);
      const vars: Record<string, string> = {};
      for (const key of Object.keys(THEME_CSS_VARS) as (keyof ThemePalette)[]) {
        vars[THEME_CSS_VARS[key]] = palette[key];
      }
      Object.assign(vars, legacyPrimaryVars(hex));
      localStorage.setItem(THEME_COLOR_KEY, hex);
      localStorage.setItem(THEME_PALETTE_CACHE_KEY, JSON.stringify({ v: PALETTE_CACHE_VERSION, color: hex, vars }));
    } catch {
      // storage can be blocked or full; the theme still applies for this session
    }
  }

  private readInitialColor(): string {
    try {
      const stored = normalizeHex(localStorage.getItem(THEME_COLOR_KEY));
      if (stored) return stored;

      const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (legacy) {
        const fromCustomizer = normalizeHex(JSON.parse(legacy)?.primaryColor);
        if (fromCustomizer) return fromCustomizer;
      }
    } catch {
      // unreadable storage or malformed JSON: fall through to the default
    }
    return DEFAULT_THEME_COLOR;
  }
}
