// @vitest-environment jsdom

/**
 * Deployment extensions (`extensions/`): the build-time selector and the 折序
 * ZHEXU extension's brand and workspace shell slots. Without an extension the
 * upstream shell and brand stay untouched.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentExtensions } from '@/extensions';
import { resolveDeploymentExtension } from '@/extensions/config';
import { deploymentMetadata } from '@/extensions/metadata';
import { ZHEXU_BRAND } from '@/extensions/zhexu/brand';
import { ZHEXU_ABOUT_VIEW, buildZhexuShellExtensions } from '@/extensions/zhexu/shell';
import { DEFAULT_BRAND, type BrandConfig } from '@/lib/brand/brand-config';
import { useBrand } from '@/lib/brand/brand-context';
import {
  WorkbenchShellExtensionsProvider,
  hostPageItems,
  useWorkbenchShellExtensions,
  type WorkbenchShellExtensions,
} from '@/lib/workbench/shell-extensions';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'zh-CN', setLocale: vi.fn() }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('resolveDeploymentExtension', () => {
  it('selects nothing when unset, empty or unknown', () => {
    expect(resolveDeploymentExtension(undefined)).toBeUndefined();
    expect(resolveDeploymentExtension('')).toBeUndefined();
    expect(resolveDeploymentExtension('   ')).toBeUndefined();
    expect(resolveDeploymentExtension('acme')).toBeUndefined();
  });

  it('accepts a known id regardless of case and surrounding spaces', () => {
    expect(resolveDeploymentExtension('zhexu')).toBe('zhexu');
    expect(resolveDeploymentExtension(' ZHEXU ')).toBe('zhexu');
  });

  it('renames the page only when an extension is active', () => {
    expect(deploymentMetadata(undefined)).toBeUndefined();
    expect(deploymentMetadata('zhexu')?.title).toBe(ZHEXU_BRAND.productName);
  });
});

describe('ZHEXU theme', () => {
  it('keeps the generated accent overrides in step with the upstream stylesheets', () => {
    // Fails after a rebase that changed a literal violet value upstream; the
    // script's message names the command that regenerates the file.
    const output = execFileSync(
      process.execPath,
      ['extensions/zhexu/scripts/sync-upstream-accent.mjs', '--check'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(output).toContain('is up to date');
  });
});

describe('ZHEXU shell slots', () => {
  it.each(['zh-CN', 'en-US'])('builds valid rail and menu entries for %s', (locale) => {
    const slots = buildZhexuShellExtensions(locale);
    for (const item of slots.navItems ?? []) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect([item.render, item.href, item.onSelect].filter(Boolean)).toHaveLength(1);
    }
    expect(hostPageItems(slots).has(ZHEXU_ABOUT_VIEW)).toBe(true);
    expect(slots.accountMenuItems?.every((item) => Boolean(item.href || item.onSelect))).toBe(true);
    expect(slots.homeSection).toBeTruthy();
  });

  it('uses Chinese for Chinese locales and English for the rest', () => {
    expect(buildZhexuShellExtensions('zh-CN').navItems?.[0]?.label).toBe('关于折序');
    expect(buildZhexuShellExtensions('zh-TW').navItems?.[0]?.label).toBe('关于折序');
    expect(buildZhexuShellExtensions('fr-FR').navItems?.[0]?.label).toBe('About ZHEXU');
  });

  it('ships every brand asset it references, with its provenance', () => {
    for (const src of [ZHEXU_BRAND.logoSrc, ZHEXU_BRAND.markSrc]) {
      expect(existsSync(join(process.cwd(), 'public', src))).toBe(true);
    }
    expect(existsSync(join(process.cwd(), 'public/extensions/zhexu/provenance.json'))).toBe(true);
  });
});

describe('DeploymentExtensions', () => {
  let root: Root | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  interface Seen {
    readonly pages: string[];
    readonly menuIds: string[];
    readonly brand: BrandConfig;
  }

  /** Renders what the shell would read from the providers, as JSON. */
  function Probe() {
    const slots: WorkbenchShellExtensions = useWorkbenchShellExtensions();
    const seen: Seen = {
      pages: [...hostPageItems(slots).keys()],
      menuIds: (slots.accountMenuItems ?? []).map((item) => item.id),
      brand: useBrand(),
    };
    return createElement('output', null, JSON.stringify(seen));
  }

  function capture(extension: 'zhexu' | null): Seen {
    const container = document.createElement('div');
    host = container;
    document.body.append(container);
    const target = createRoot(container);
    root = target;
    act(() => {
      target.render(
        createElement(
          WorkbenchShellExtensionsProvider,
          null,
          createElement(DeploymentExtensions, { extension }, createElement(Probe)),
        ),
      );
    });
    return JSON.parse(container.querySelector('output')?.textContent ?? '{}') as Seen;
  }

  it('leaves the upstream shell and brand untouched without an extension', () => {
    const seen = capture(null);
    expect(seen.pages).toEqual([]);
    expect(seen.menuIds).toEqual([]);
    expect(seen.brand).toEqual(DEFAULT_BRAND);
  });

  it('adds the ZHEXU brand and slots inside the upstream provider', () => {
    const seen = capture('zhexu');
    expect(seen.brand).toEqual(ZHEXU_BRAND);
    expect(seen.pages).toEqual([ZHEXU_ABOUT_VIEW]);
    expect(seen.menuIds).toEqual(['zhexu-about', 'zhexu-upstream']);
  });
});
