/**
 * "My files" of the ZHEXU extension: the listing of what was delivered to an
 * owner (`extensions/zhexu/deliverables/library.ts` and `listDeliveredFiles`
 * in `routes.ts`). It is a view over session materials, scoped to the owner.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Session {
  id: string;
  ownerId: string;
  title?: string;
  prompt: string;
  updatedAt: number;
}

const state = vi.hoisted(() => ({
  runtime: true,
  enabled: true,
  annotations: false,
  ownerId: 'user:one',
  /** What the store's owner listing returns, whatever owner is asked for. */
  listed: [] as Session[],
  materials: [] as Array<Record<string, unknown>>,
  unreadable: new Set<string>(),
  listedFor: [] as string[],
}));

vi.mock('@/lib/config/feature-flags', () => ({
  isAgentRuntimeConfigured: () => state.runtime,
}));
vi.mock('@/extensions/zhexu/deliverables/enabled', () => ({
  zhexuDeliverablesEnabled: () => state.enabled,
}));
vi.mock('@/extensions/zhexu/annotations/enabled', () => ({
  zhexuImageAnnotationsEnabled: () => state.annotations,
}));
vi.mock('@/lib/server/identity/with-owner', () => ({
  withRequestOwner: (
    _req: unknown,
    handler: (principal: { ownerId: string }, headers: Headers) => Promise<Response>,
  ) => handler({ ownerId: state.ownerId }, new Headers({ 'Set-Cookie': 'owner=kept' })),
}));
vi.mock('@/lib/server/agent-runtime/store', () => ({
  getAgentSessionStore: async () => ({
    listSessionsByOwner: async (ownerId: string) => {
      state.listedFor.push(ownerId);
      return state.listed;
    },
  }),
}));
vi.mock('@/lib/server/agent-runtime/session-materials', () => ({
  listSessionMaterials: async (sessionId: string) => {
    if (state.unreadable.has(sessionId)) throw new Error('store down');
    return state.materials.filter((material) => material.sessionId === sessionId);
  },
  resolveOwnedSession: vi.fn(),
  getSessionMaterial: vi.fn(),
  resolveSessionMaterialRawAsset: vi.fn(),
  storeSessionMaterialRawAsset: vi.fn(),
  removeSessionMaterialRawAsset: vi.fn(),
  getAgentSessionMaterialStore: vi.fn(),
}));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: vi.fn(),
}));

import {
  deliveredEntries,
  LIBRARY_ENTRY_LIMIT,
  LIBRARY_SESSION_LIMIT,
  sortDeliveredEntries,
  type DeliveredLibrary,
} from '@/extensions/zhexu/deliverables/library';
import { isDeliverableDownloadUrl } from '@/extensions/zhexu/deliverables/contract';
import { listDeliveredFiles } from '@/extensions/zhexu/deliverables/routes';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const SHA = 'c'.repeat(64);
const handout = (id: string, format: string, hash = HASH, title = '光的折射') => ({
  id,
  title: `${title}-${hash.slice(0, 12)}.${format}`,
  sourceUrl: `urn:zhexu:deliverable:${hash}:${format}:${SHA}`,
});

describe('delivered entries of a conversation', () => {
  it('puts the files of one handout together, PDF first, and names it without the hash', () => {
    const entries = deliveredEntries({ id: 's1', title: '物理' }, [
      { ...handout('mat_png', 'png'), createdAt: '2026-11-19T10:00:02.000Z' },
      { ...handout('mat_zip', 'zip'), createdAt: '2026-11-19T10:00:03.000Z' },
      { ...handout('mat_pdf', 'pdf'), createdAt: '2026-11-19T10:00:01.000Z' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: `handout:${HASH}`,
      kind: 'handout',
      title: '光的折射',
      sessionId: 's1',
      sessionTitle: '物理',
      createdAt: '2026-11-19T10:00:01.000Z',
    });
    expect(entries[0].files.map((file) => file.format)).toEqual(['pdf', 'png', 'zip']);
    expect(entries[0].files.every((file) => isDeliverableDownloadUrl(file.download))).toBe(true);
  });

  it('keeps handouts and annotated images apart and leaves everything else out', () => {
    const entries = deliveredEntries({ id: 's1', title: null }, [
      handout('mat_a', 'pdf'),
      handout('mat_b', 'pdf', OTHER, '第二份'),
      {
        id: 'mat_c',
        title: `细胞-annotated-${HASH.slice(0, 12)}.png`,
        sourceUrl: `urn:zhexu:annotation:${HASH}:png:${SHA}`,
      },
      // An upload, a web page, the handout's own source record, a made-up provenance.
      { id: 'mat_upload', title: 'photo.png', sourceUrl: null },
      { id: 'mat_web', title: 'page', sourceUrl: 'https://example.com/a.pdf' },
      { id: 'mat_record', title: `zhexu-deliverable-${HASH}.json`, sourceUrl: null },
      { id: 'mat_fake', title: 'x.exe', sourceUrl: `urn:zhexu:deliverable:${HASH}:exe:${SHA}` },
      { id: 'not-a-material-id', title: 'y.pdf', sourceUrl: handout('x', 'pdf').sourceUrl },
    ]);
    expect(entries.map((entry) => [entry.kind, entry.title])).toEqual([
      ['handout', '光的折射'],
      ['handout', '第二份'],
      ['annotation', '细胞'],
    ]);
  });

  it('keeps the first copy when a file was written twice for the same source', () => {
    const [entry] = deliveredEntries({ id: 's1', title: null }, [
      handout('mat_first', 'pdf'),
      handout('mat_second', 'pdf'),
    ]);
    expect(entry.files.map((file) => file.materialId)).toEqual(['mat_first']);
  });

  it('sorts newest first, with entries without a time last', () => {
    const at = (key: string, createdAt: string | null) => ({
      key,
      kind: 'handout' as const,
      title: key,
      sessionId: 's1',
      sessionTitle: null,
      createdAt,
      files: [],
    });
    expect(
      sortDeliveredEntries([
        at('old', '2026-11-01T00:00:00.000Z'),
        at('none', null),
        at('new', '2026-11-19T00:00:00.000Z'),
      ]).map((entry) => entry.key),
    ).toEqual(['new', 'old', 'none']);
  });
});

describe('listing delivered files', () => {
  const request = () => new Request('http://localhost/api/extensions/zhexu/files');
  const session = (id: string, ownerId: string, updatedAt: number, title?: string): Session => ({
    id,
    ownerId,
    updatedAt,
    prompt: `prompt of ${id}`,
    ...(title ? { title } : {}),
  });

  beforeEach(() => {
    Object.assign(state, { runtime: true, enabled: true, annotations: false, ownerId: 'user:one' });
    state.listed = [];
    state.materials = [];
    state.unreadable.clear();
    state.listedFor = [];
  });

  it('answers 404 while the features are off, without looking at any conversation', async () => {
    state.enabled = false;
    expect((await listDeliveredFiles(request())).status).toBe(404);
    state.enabled = true;
    state.runtime = false;
    expect((await listDeliveredFiles(request())).status).toBe(404);
    expect(state.listedFor).toEqual([]);
    // The annotation switch alone is enough: its files are listed too.
    Object.assign(state, { runtime: true, enabled: false, annotations: true });
    expect((await listDeliveredFiles(request())).status).toBe(200);
  });

  it('lists the owner’s files across conversations, newest first, and is never cached', async () => {
    state.listed = [session('s1', 'user:one', 1, '物理'), session('s2', 'user:one', 2)];
    state.materials = [
      { sessionId: 's1', ...handout('mat_a', 'pdf'), createdAt: '2026-11-18T00:00:00.000Z' },
      { sessionId: 's1', ...handout('mat_b', 'png'), createdAt: '2026-11-18T00:00:01.000Z' },
      {
        sessionId: 's2',
        ...handout('mat_c', 'pdf', OTHER, '第二份'),
        createdAt: '2026-11-19T00:00:00.000Z',
      },
    ];
    const response = await listDeliveredFiles(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Set-Cookie')).toBe('owner=kept');
    const body = (await response.json()) as DeliveredLibrary;
    expect(state.listedFor).toEqual(['user:one']);
    expect(body.truncated).toBe(false);
    expect(body.entries.map((entry) => [entry.title, entry.sessionId, entry.sessionTitle])).toEqual(
      [
        ['第二份', 's2', 'prompt of s2'],
        ['光的折射', 's1', '物理'],
      ],
    );
    expect(body.entries[1].files.map((file) => file.format)).toEqual(['pdf', 'png']);
  });

  it('leaves out a conversation of another owner even if the store returned it', async () => {
    state.listed = [session('mine', 'user:one', 1), session('theirs', 'user:two', 2)];
    state.materials = [
      { sessionId: 'mine', ...handout('mat_a', 'pdf') },
      { sessionId: 'theirs', ...handout('mat_b', 'pdf', OTHER, '别人的') },
    ];
    const body = (await (await listDeliveredFiles(request())).json()) as DeliveredLibrary;
    expect(body.entries.map((entry) => entry.sessionId)).toEqual(['mine']);
  });

  it('skips a conversation whose materials cannot be read instead of failing the page', async () => {
    state.listed = [session('s1', 'user:one', 1), session('s2', 'user:one', 2)];
    state.materials = [
      { sessionId: 's1', ...handout('mat_a', 'pdf') },
      { sessionId: 's2', ...handout('mat_b', 'pdf', OTHER, '读不到') },
    ];
    state.unreadable.add('s2');
    const response = await listDeliveredFiles(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as DeliveredLibrary;
    expect(body.entries.map((entry) => entry.sessionId)).toEqual(['s1']);
  });

  it('looks at the most recent conversations only and says when there are more', async () => {
    state.listed = Array.from({ length: LIBRARY_SESSION_LIMIT + 1 }, (_, index) =>
      session(`s${index}`, 'user:one', index),
    );
    // Only the oldest conversation, the one past the limit, has a file.
    state.materials = [{ sessionId: 's0', ...handout('mat_old', 'pdf') }];
    const body = (await (await listDeliveredFiles(request())).json()) as DeliveredLibrary;
    expect(body).toEqual({ entries: [], truncated: true });
    expect(LIBRARY_ENTRY_LIMIT).toBeGreaterThan(0);
  });
});
