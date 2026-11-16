/**
 * The front page of the ZHEXU repository: `.github/README.md` and its Chinese
 * version. GitHub shows a README under `.github/` in place of the one at the
 * root, which leaves upstream's README untouched. These checks keep the page
 * true as upstream moves: every path it points to exists, every anchor is a
 * heading of the file it names, the two languages give the same commands, and
 * the variables it tells people to set are still the documented ones.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZHEXU_LINKS } from '@/extensions/zhexu/brand';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const FILES = { en: '.github/README.md', zh: '.github/README-zh.md' } as const;

/** Links and images that point into the repository: `](/path#anchor)`. */
function repositoryLinks(markdown: string) {
  return Array.from(markdown.matchAll(/\]\((\/[^)\s#]*)(?:#([^)\s]*))?\)/g), (match) => ({
    path: match[1],
    anchor: match[2] === undefined ? undefined : decodeURIComponent(match[2]),
  }));
}

/** The id GitHub gives a heading: lower case, punctuation and emoji dropped, spaces to hyphens. */
function slug(heading: string) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function headingSlugs(markdown: string) {
  return Array.from(markdown.matchAll(/^#{1,6}\s+(.+)$/gm), (match) => slug(match[1]));
}

/** Fenced code with its comments removed, so that the two languages can be compared. */
function commands(markdown: string) {
  return Array.from(markdown.matchAll(/```\w*\n([\s\S]*?)```/g), (match) =>
    match[1]
      .split('\n')
      .map((line) => line.replace(/\s+#.*$/, '').trimEnd())
      .filter(Boolean)
      .join('\n'),
  );
}

describe.each(Object.entries(FILES))('repository front page (%s)', (_language, file) => {
  const links = repositoryLinks(read(file));

  it('points only at paths that exist', () => {
    expect(links.length).toBeGreaterThan(10);
    for (const { path } of links) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it('points only at headings that exist', () => {
    const anchored = links.filter((link) => link.anchor !== undefined);
    expect(anchored.length).toBeGreaterThan(1);
    for (const { path, anchor } of anchored) {
      expect(headingSlugs(read(path)), `${path}#${anchor}`).toContain(anchor);
    }
  });
});

describe('repository front page', () => {
  const english = read(FILES.en);
  const chinese = read(FILES.zh);

  it('links the two languages to each other', () => {
    expect(english).toContain(`(/${FILES.zh})`);
    expect(chinese).toContain(`(/${FILES.en})`);
  });

  it('gives the same commands in both languages', () => {
    expect(commands(english).length).toBe(3);
    expect(commands(chinese)).toEqual(commands(english));
  });

  it('clones from the repository the app names', () => {
    expect(ZHEXU_LINKS.source).toBeDefined();
    expect(commands(english)[0]).toContain(`git clone ${ZHEXU_LINKS.source}.git `);
  });

  it('turns the extension on with variables that are still documented', () => {
    const documented = read('.env.example');
    const lines = commands(english)[1].split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(documented, line).toContain(`# ${line.split('=')[0]}=`);
    }
  });
});
