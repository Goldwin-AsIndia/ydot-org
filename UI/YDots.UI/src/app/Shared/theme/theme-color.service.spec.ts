import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_CLASS, PERSIST_DELAY_MS, ThemeColorService } from './theme-color.service';
import { generatePalette, hexToHsl, legacyPrimaryVars } from './theme-palette';

/**
 * <meta name="theme-color"> is the browser chrome on mobile and in an installed PWA. It cannot resolve a CSS
 * var(), so ThemeColorService writes the derived primary as a hex, and it has to move with the theme.
 */
describe('ThemeColorService browser chrome colour', () => {
  const meta = () => document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  beforeEach(() => {
    localStorage.clear();
    meta()?.remove();
    TestBed.resetTestingModule();
  });

  it('creates the meta tag when the document has none, on the default theme', () => {
    TestBed.inject(ThemeColorService);
    expect(meta()?.content).toBe(legacyPrimaryVars('#315746')['--primary']);
  });

  it('follows the theme colour', () => {
    const service = TestBed.inject(ThemeColorService);
    service.setThemeColor('#5b2a86');
    const purple = meta()!.content;
    expect(purple).toBe(legacyPrimaryVars('#5b2a86')['--primary']);
    expect(purple).toBe(document.documentElement.style.getPropertyValue('--primary'));

    service.resetThemeColor();
    expect(meta()!.content).toBe(legacyPrimaryVars('#315746')['--primary']);
  });

  it('reuses the tag from index.html instead of adding a second one', () => {
    const existing = document.createElement('meta');
    existing.name = 'theme-color';
    existing.content = '#000000';
    document.head.appendChild(existing);

    TestBed.inject(ThemeColorService).setThemeColor('#5b2a86');

    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(existing.content).not.toBe('#000000');
  });

  it('tracks the picked hue, not just any colour', () => {
    TestBed.inject(ThemeColorService).setThemeColor('#5b2a86');
    expect(Math.abs(hexToHsl(meta()!.content).h - hexToHsl('#5b2a86').h)).toBeLessThan(6);
  });
});

/** The page header follows the pick: every colour change rewrites the --theme-header* variables, light or dark. */
describe('ThemeColorService page header colours', () => {
  const v = (name: string) => document.documentElement.style.getPropertyValue(name);

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('writes the header variables for the pick', () => {
    const service = TestBed.inject(ThemeColorService);
    service.setThemeColor('#1f4a8a');
    expect(v('--theme-header')).toBe(generatePalette('#1f4a8a').header);
    expect(v('--theme-header-ink')).toBe('#FFFFFF');
  });

  it('turns light, with dark text, when a light colour is picked, and back again', () => {
    const service = TestBed.inject(ThemeColorService);
    service.setThemeColor('#1f4a8a');
    const deep = v('--theme-header');
    service.setThemeColor('#e4e8ec');
    expect(v('--theme-header')).not.toBe(deep);
    expect(v('--theme-header-ink')).toBe('#151915');
    service.setThemeColor('#1f4a8a');
    expect(v('--theme-header')).toBe(deep);
    expect(v('--theme-header-ink')).toBe('#FFFFFF');
  });

  it('caches the header variables so the first paint after a reload is right', () => {
    TestBed.inject(ThemeColorService).setThemeColor('#f3e08e');
    const cache = JSON.parse(localStorage.getItem('theme:palette')!);
    expect(cache.v).toBe(6);
    expect(cache.vars['--theme-header']).toBe(generatePalette('#f3e08e').header);
    expect(cache.vars['--theme-header-ink']).toBe('#151915');
  });
});

/**
 * Dragging in the native colour picker fires an event for every mouse move. The live path must repaint at once but
 * must not touch storage per event, and the final colour must still be saved.
 */
describe('ThemeColorService live preview', () => {
  const v = (name: string) => document.documentElement.style.getPropertyValue(name);

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  it('repaints immediately but does not write storage per event', () => {
    const service = TestBed.inject(ThemeColorService);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    for (const hex of ['#112233', '#223344', '#334455', '#445566']) service.previewThemeColor(hex);
    expect(v('--theme-header')).toBe(generatePalette('#445566').header);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });

  it('saves the last colour once the drag has been quiet', () => {
    const service = TestBed.inject(ThemeColorService);
    service.previewThemeColor('#112233');
    service.previewThemeColor('#445566');
    vi.advanceTimersByTime(PERSIST_DELAY_MS + 10);
    expect(localStorage.getItem('theme:color')).toBe('#445566');
    expect(JSON.parse(localStorage.getItem('theme:palette')!).color).toBe('#445566');
  });

  it('saves immediately when the picker commits, and the pending save does not overwrite it', () => {
    const service = TestBed.inject(ThemeColorService);
    service.previewThemeColor('#112233');
    service.setThemeColor('#5b2a86');
    expect(localStorage.getItem('theme:color')).toBe('#5b2a86');
    vi.advanceTimersByTime(PERSIST_DELAY_MS + 10);
    expect(localStorage.getItem('theme:color')).toBe('#5b2a86');
  });

  it('suspends colour transitions while dragging and restores them when it settles or commits', () => {
    const service = TestBed.inject(ThemeColorService);
    const live = () => document.documentElement.classList.contains(LIVE_CLASS);
    service.previewThemeColor('#112233');
    expect(live()).toBe(true);
    vi.advanceTimersByTime(PERSIST_DELAY_MS + 10);
    expect(live()).toBe(false);
    service.previewThemeColor('#223344');
    expect(live()).toBe(true);
    service.setThemeColor('#445566');
    expect(live()).toBe(false);
  });

  it('ignores an invalid colour', () => {
    const service = TestBed.inject(ThemeColorService);
    expect(service.previewThemeColor('nope')).toBe(false);
  });
});
