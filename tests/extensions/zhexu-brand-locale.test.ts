import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { brandLocaleResource } from '@/extensions/locale';
import { deploymentMetadata } from '@/extensions/metadata';
import { ZHEXU_BRAND } from '@/extensions/zhexu/brand';
import { workbenchResourceFor } from '@/lib/i18n/workbench';

type Resource = Record<string, unknown>;

const LOCALES = readdirSync(resolve(__dirname, '../../lib/i18n/locales'))
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length));

async function upstreamBundle(locale: string): Promise<Resource> {
  const json = (await import(`@/lib/i18n/locales/${locale}.json`)) as { default: Resource };
  return { ...json.default, workbench: workbenchResourceFor(locale) };
}

function at(resource: Resource, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Resource | undefined)?.[key], resource);
}

function strings(resource: unknown, path = ''): Array<[string, string]> {
  if (typeof resource === 'string') return [[path, resource]];
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return [];
  return Object.entries(resource).flatMap(([key, child]) =>
    strings(child, path ? `${path}.${key}` : key),
  );
}

describe('brand names in upstream strings', () => {
  it('leaves every bundle untouched without an extension', async () => {
    const bundle = await upstreamBundle('en-US');
    expect(brandLocaleResource(bundle, undefined)).toBe(bundle);
  });

  it('names the product in the strings that show it', async () => {
    const zh = brandLocaleResource(await upstreamBundle('zh-CN'), 'zhexu');
    expect(at(zh, 'workspace.account.about')).toBe(`关于 ${ZHEXU_BRAND.productName}`);
    expect(at(zh, 'workspace.tour.welcome.title')).toBe(`欢迎来到 ${ZHEXU_BRAND.productName}`);
    const en = brandLocaleResource(await upstreamBundle('en-US'), 'zhexu');
    expect(at(en, 'workspace.account.about')).toBe(`About ${ZHEXU_BRAND.productName}`);
  });

  it('keeps the strings that name upstream itself, in every locale', async () => {
    for (const locale of LOCALES) {
      const bundle = await upstreamBundle(locale);
      const branded = brandLocaleResource(bundle, 'zhexu');
      for (const path of [
        'settings.skills.builtinDetailNote',
        'workbench.skill.settings.officialDownload',
      ]) {
        expect(at(branded, path), `${locale} ${path}`).toBe(at(bundle, path));
      }
      const left = strings(branded).filter(([, text]) => text.includes('OpenMAIC'));
      for (const [path] of left) {
        expect(
          ['settings.skills.builtinDetailNote', 'workbench.skill.settings.officialDownload'],
          `${locale} ${path}`,
        ).toContain(path);
      }
    }
  });

  it('changes nothing but the name', async () => {
    const bundle = await upstreamBundle('en-US');
    const branded = brandLocaleResource(bundle, 'zhexu');
    const before = strings(bundle);
    const after = new Map(strings(branded));
    expect(after.size).toBe(before.length);
    for (const [path, text] of before) {
      expect(after.get(path)?.replaceAll(ZHEXU_BRAND.productName, 'OpenMAIC')).toBe(text);
    }
  });

  it('gives the browser tab the brand mark', () => {
    expect(deploymentMetadata('zhexu')?.icons).toEqual({
      icon: { url: ZHEXU_BRAND.markSrc, type: 'image/svg+xml' },
    });
  });
});
