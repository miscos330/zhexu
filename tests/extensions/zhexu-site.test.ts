/**
 * The 折序 ZHEXU showcase page (`extensions/zhexu/site/`). It is a static page with
 * no build step, so these checks stand in for what a build would catch: every
 * marked string has an English version, every file the page refers to exists, the
 * page loads nothing from another host, and the two dark-theme blocks agree.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SITE = join(ROOT, 'extensions', 'zhexu', 'site');
const read = (name: string) => readFileSync(join(SITE, name), 'utf8');

const html = read('index.html');
const css = read('site.css');
const script = read('site.js');

interface Strings {
  zh: Record<string, string>;
  en: Record<string, string>;
}

function loadStrings(): Strings {
  const sandbox: { window: { ZX_STRINGS?: Strings } } = { window: {} };
  runInNewContext(read('site.strings.js'), sandbox);
  if (!sandbox.window.ZX_STRINGS) throw new Error('site.strings.js did not set ZX_STRINGS');
  return sandbox.window.ZX_STRINGS;
}

const all = (text: string, pattern: RegExp) => Array.from(text.matchAll(pattern), (m) => m[1]);
const unique = (values: string[]) => [...new Set(values)].sort();

/** Keys the page marks, on text (`data-i18n`) and on attributes (`data-i18n-attr`). */
const pageKeys = unique([
  ...all(html, /data-i18n="([^"]+)"/g),
  ...all(html, /data-i18n-attr="([^"]+)"/g).flatMap((pairs) =>
    pairs.split(';').map((pair) => pair.split(':')[1].trim()),
  ),
]);

/** Keys of states the page is not in when it loads; the script switches to them. */
const STATE_KEYS = ['copy.done', 'copy.failed', 'cta.source', 'theme.toDark', 'theme.toLight'];

function block(source: string, selector: RegExp): string[] {
  const match = source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`No rule for ${selector.source}`);
  return match[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('showcase page strings', () => {
  const strings = loadStrings();

  it('has English for every marked string, and nothing left over', () => {
    expect(pageKeys.length).toBeGreaterThan(90);
    expect(unique(Object.keys(strings.en))).toEqual(unique([...pageKeys, ...STATE_KEYS]));
  });

  it('keeps Chinese in the script only for states the page does not start in', () => {
    expect(unique(Object.keys(strings.zh))).toEqual(unique(STATE_KEYS));
    for (const key of STATE_KEYS) expect(pageKeys).not.toContain(key);
  });

  it('has no empty string', () => {
    for (const [key, value] of [...Object.entries(strings.en), ...Object.entries(strings.zh)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});

describe('showcase page files', () => {
  it('refers only to files that exist', () => {
    const references = unique([
      ...all(html, /\s(?:src|href)="([^"#][^"]*)"/g).filter((value) => !/^https?:/.test(value)),
      ...all(css, /url\(\s*['"]?([^'")]+)['"]?\s*\)/g),
    ]);
    expect(references).toContain('assets/shots/classroom-light.webp');
    for (const reference of references) {
      expect(existsSync(join(SITE, reference)), reference).toBe(true);
    }
  });

  it('loads nothing from another host', () => {
    // Links a visitor follows may leave the site; what the page loads may not.
    const loaded = [
      ...all(html, /\ssrc="([^"]+)"/g),
      ...all(html, /<link\b[^>]*\shref="([^"]+)"/g),
      ...all(css, /url\(\s*['"]?([^'")]+)['"]?\s*\)/g),
    ];
    expect(loaded.length).toBeGreaterThan(8);
    for (const reference of loaded) expect(reference).not.toMatch(/^(?:[a-z]+:)?\/\//i);
    expect(css).not.toContain('@import');
  });

  it('gives every screenshot its size and a description', () => {
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    expect(images).toHaveLength(4);
    for (const image of images) {
      expect(image).toMatch(/\swidth="2400"/);
      expect(image).toMatch(/\sheight="1500"/);
      expect(image).toMatch(/\salt="[^"]+"/);
    }
  });

  it('finds every element and class the script looks for', () => {
    const ids = unique(all(script, /getElementById\('([^']+)'\)/g));
    expect(ids).toContain('zx-source');
    for (const id of ids) expect(html, id).toContain(`id="${id}"`);

    const classes = unique(
      all(script, /querySelector(?:All)?\(\s*'([^']+)'/g).flatMap((selector) =>
        all(selector, /\.(zx-[\w-]+)/g),
      ),
    );
    expect(classes).toContain('zx-copy');
    for (const name of classes) expect(html, name).toMatch(new RegExp(`class="[^"]*\\b${name}\\b`));
  });

  it('draws the brand from the extension’s own assets', () => {
    const brand = join(ROOT, 'public', 'extensions', 'zhexu');
    const paths = all(readFileSync(join(brand, 'zhexu-signature.svg'), 'utf8'), /\sd="([^"]+)"/g);
    expect(paths.length).toBeGreaterThan(5);
    for (const path of paths) expect(html).toContain(path);
    expect(read('assets/zhexu-mark.svg')).toBe(readFileSync(join(brand, 'zhexu-mark.svg'), 'utf8'));
    expect(existsSync(join(SITE, 'assets', 'fonts', 'OFL.txt'))).toBe(true);
  });
});

describe('showcase page theme', () => {
  const isColor = (declaration: string) => /^--zx-(?:bg|text|border|brand)-/.test(declaration);
  const names = (declarations: string[]) => declarations.map((d) => d.split(':')[0]).sort();

  it('defines the same dark colours for the system theme and for the toggle', () => {
    const fromSystem = block(css, /:root:not\(\[data-theme='light'\]\)/);
    const fromToggle = block(css, /:root\[data-theme='dark'\]/);
    expect(fromSystem).toEqual(fromToggle);
    expect(fromToggle).toContain('color-scheme: dark');
  });

  it('gives every light colour a dark counterpart', () => {
    const light = block(css, /:root/).filter(isColor);
    const dark = block(css, /:root\[data-theme='dark'\]/).filter(isColor);
    expect(light.length).toBe(14);
    expect(names(dark)).toEqual(names(light));
  });
});
