// @vitest-environment jsdom

/**
 * The handout card of the ZHEXU extension, and the seam that puts an extension's
 * card under a finished tool call (`extensions/tool-cards.tsx`).
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeploymentToolCard } from '@/extensions/tool-cards';
import { deliverableDownloadUrl } from '@/extensions/zhexu/deliverables/contract';
import type { ChatNode } from '@/lib/workbench/session-store';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en-US', setLocale: vi.fn() }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const file = (format: string, materialId: string) => ({
  format,
  filename: `Refraction.${format}`,
  mime: format === 'pdf' ? 'application/pdf' : 'image/png',
  bytes: 20480,
  sha256: 'a'.repeat(64),
  materialId,
  pages: 2,
  download: deliverableDownloadUrl('s1', materialId),
});

const details = (extra: Record<string, unknown> = {}) => ({
  status: 'saved',
  deliveryState: 'delivered',
  sessionId: 's1',
  sourceId: 'mat_rec',
  title: 'Refraction',
  files: [file('pdf', 'mat_pdf'), file('png', 'mat_png')],
  ...extra,
});

function node(toolName: string, toolDetails: unknown): ChatNode {
  return {
    key: 'k1',
    kind: 'tool',
    text: '',
    toolName,
    toolState: 'done',
    toolDetails,
  } as ChatNode;
}

function mount(chatNode: ChatNode, extension: 'zhexu' | null | undefined = 'zhexu') {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(DeploymentToolCard, { node: chatNode, extension })));
  return host;
}

const card = (host: HTMLElement) => host.querySelector('[data-testid="zhexu-deliverable-card"]');

describe('tool card seam', () => {
  it('renders nothing without an extension', () => {
    expect(mount(node('create_deliverable', details()), null).innerHTML).toBe('');
  });

  it('renders nothing for a tool that is not the extension’s own', () => {
    expect(mount(node('web_search', details())).innerHTML).toBe('');
    expect(mount(node('read_deliverable', details())).innerHTML).toBe('');
  });
});

describe('handout card', () => {
  it('shows the preview and a download link per file', () => {
    const host = mount(node('create_deliverable', details()));
    expect(card(host)?.getAttribute('data-delivery-state')).toBe('delivered');
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      deliverableDownloadUrl('s1', 'mat_png'),
    );
    const links = [...host.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      deliverableDownloadUrl('s1', 'mat_pdf'),
      deliverableDownloadUrl('s1', 'mat_png'),
    ]);
    expect(links[0]!.getAttribute('download')).toBe('Refraction.pdf');
    expect(links[0]!.textContent).toContain('PDF');
    expect(links[0]!.textContent).toContain('2 pages, 20 KB');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'The files are saved and ready to download.',
    );
  });

  it('drops files whose link this feature did not issue', () => {
    const host = mount(
      node(
        'export_deliverable',
        details({
          files: [
            { ...file('pdf', 'mat_pdf'), download: 'https://example.com/evil.pdf' },
            { ...file('png', 'mat_png'), download: 'javascript:alert(1)' },
            file('pdf', 'mat_ok'),
          ],
        }),
      ),
    );
    expect([...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      deliverableDownloadUrl('s1', 'mat_ok'),
    ]);
    expect(host.querySelector('img')).toBeNull();
  });

  it('renders nothing for a failed call', () => {
    const host = mount(
      node('create_deliverable', { deliveryState: 'failed', reason: 'deliverable_page_limit' }),
    );
    expect(host.innerHTML).toBe('');
  });

  it('says so when a file is missing', () => {
    const host = mount(
      node(
        'verify_deliverable',
        details({ deliveryState: 'partial', files: [file('png', 'mat_png')] }),
      ),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain('A file is missing');
    expect(host.querySelectorAll('a')).toHaveLength(1);
  });

  it('checks the files again on request and shows the server’s answer', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        modelCalls: 0,
        delivery: details({ deliveryState: 'partial', files: [file('png', 'mat_png')] }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const host = mount(node('create_deliverable', details()));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/extensions/zhexu/deliverables?sessionId=s1&sourceId=mat_rec',
    );
    expect(card(host)?.getAttribute('data-delivery-state')).toBe('partial');
    expect(host.querySelectorAll('a')).toHaveLength(1);
  });

  it('keeps the saved links and reports it when the check fails or its receipt is wrong', async () => {
    for (const response of [
      { ok: false, json: async () => ({}) },
      { ok: true, json: async () => ({ modelCalls: 1, delivery: details() }) },
      {
        ok: true,
        json: async () => ({ modelCalls: 0, delivery: details({ sourceId: 'mat_other' }) }),
      },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      const host = mount(node('create_deliverable', details()));
      await act(async () => host.querySelector('button')!.click());
      await act(async () => {});
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        'The check did not go through. Try again in a moment.',
      );
      expect(host.querySelectorAll('a')).toHaveLength(2);
    }
  });
});
