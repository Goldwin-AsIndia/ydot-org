import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATERMARK_ICONS, headerWatermarks } from './header-watermarks';

const APP_DIR = join(__dirname, '..', '..', '..');

function templates(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) templates(path, out);
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

describe('header watermarks', () => {
  it('maps every screen to exactly one icon from the curated set', () => {
    const curated = new Set<unknown>(Object.values(WATERMARK_ICONS));
    for (const [screen, icon] of Object.entries(headerWatermarks)) {
      expect(Array.isArray(icon), `${screen} must be one icon, not a list`).toBe(false);
      expect(curated.has(icon), `${screen} uses an icon outside WATERMARK_ICONS`).toBe(true);
    }
  });

  it('every icon is stroke path data on the 24 grid', () => {
    for (const [name, icon] of Object.entries(WATERMARK_ICONS)) {
      expect(icon.paths.length, name).toBeGreaterThan(0);
      for (const d of icon.paths) {
        expect(d, name).toMatch(/^M[-\d. ]/);
        expect(d, name).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('every <app-page-header> in a template names a registered screen', () => {
    const registered = new Set(Object.keys(headerWatermarks));
    const used = new Set<string>();
    for (const file of templates(APP_DIR)) {
      const html = readFileSync(file, 'utf8');
      for (const tag of html.match(/<app-page-header\b[^>]*>/g) ?? []) {
        const screen = /\bscreen="([^"]+)"/.exec(tag)?.[1];
        expect(screen, `${file}: <app-page-header> has no screen`).toBeTruthy();
        expect(registered.has(screen!), `${file}: "${screen}" is not in headerWatermarks`).toBe(true);
        used.add(screen!);
      }
    }
    // No dead entries either: the registry is exactly the set of screens.
    expect([...registered].filter((k) => !used.has(k))).toEqual([]);
  });

  it('a header carries no decoration of its own', () => {
    const html = readFileSync(join(__dirname, '..', 'page-header', 'page-header.html'), 'utf8');
    expect((html.match(/<svg\b/g) ?? []).length, 'the header template draws no SVG itself').toBe(0);
    expect((html.match(/<app-header-watermark\b/g) ?? []).length).toBe(1);
  });
});
