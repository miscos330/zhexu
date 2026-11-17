/**
 * The two HTTP endpoints of the ZHEXU handout feature
 * (`extensions/zhexu/deliverables/routes.ts`): off by default, scoped to the
 * requesting owner, and limited to the files a handout itself produced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  runtime: true,
  enabled: true,
  annotations: false,
  ownerId: 'user:one',
  sessions: new Map<string, { id: string; ownerId: string }>(),
  materials: new Map<string, Record<string, unknown>>(),
  objects: new Map<string, { bytes: Buffer; mime: string }>(),
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
vi.mock('@/lib/server/agent-runtime/session-materials', () => ({
  resolveOwnedSession: async (sessionId: string, ownerId: string) => {
    const session = state.sessions.get(sessionId);
    return session && session.ownerId === ownerId ? session : null;
  },
  getSessionMaterial: async (sessionId: string, id: string) => {
    const material = state.materials.get(id);
    return material && material.sessionId === sessionId ? material : null;
  },
  listSessionMaterials: async (sessionId: string) =>
    [...state.materials.values()].filter((material) => material.sessionId === sessionId),
  resolveSessionMaterialRawAsset: async (_sessionId: string, key: string) =>
    state.objects.get(key) ?? null,
  storeSessionMaterialRawAsset: vi.fn(),
  removeSessionMaterialRawAsset: vi.fn(),
  getAgentSessionMaterialStore: vi.fn(),
}));

import { createHash } from 'node:crypto';
import {
  DELIVERABLE_MIME,
  deliverableDownloadUrl,
  deliverableVerifyUrl,
} from '@/extensions/zhexu/deliverables/contract';
import { downloadDeliverable, verifyDeliverable } from '@/extensions/zhexu/deliverables/routes';

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const PDF = Buffer.from('%PDF handout');
const PNG = Buffer.from('PNG handout');

function put(
  id: string,
  sessionId: string,
  title: string,
  bytes: Buffer,
  mime: string,
  sourceUrl?: string,
) {
  const rawAssetId = `${sessionId}/${id}`;
  state.materials.set(id, { id, sessionId, title, rawAssetId, sourceUrl });
  state.objects.set(rawAssetId, { bytes, mime });
}

/** One finished handout in session `s1` of `user:one`, plus an ordinary upload. */
function seed() {
  const source = { kind: 'document', title: '讲义', body: '正文', style: 'standard' };
  const sourceHash = sha(JSON.stringify(source));
  const provenance = (format: string, bytes: Buffer) =>
    `urn:zhexu:deliverable:${sourceHash}:${format}:${sha(bytes)}`;
  put('mat_pdf', 's1', '讲义.pdf', PDF, 'application/pdf', provenance('pdf', PDF));
  put('mat_png', 's1', '讲义.png', PNG, 'image/png', provenance('png', PNG));
  put('mat_upload', 's1', 'notes.pdf', Buffer.from('%PDF upload'), 'application/pdf');
  const file = (format: string, materialId: string, bytes: Buffer, mime: string) => ({
    format,
    filename: `讲义.${format}`,
    mime,
    bytes: bytes.length,
    sha256: sha(bytes),
    materialId,
    pages: 1,
  });
  const record = {
    version: 1,
    source,
    sourceHash,
    files: [
      file('pdf', 'mat_pdf', PDF, 'application/pdf'),
      file('png', 'mat_png', PNG, 'image/png'),
    ],
  };
  put(
    'mat_rec',
    's1',
    `zhexu-deliverable-${sourceHash}.json`,
    Buffer.from(JSON.stringify(record)),
    DELIVERABLE_MIME,
  );
}

const get = (path: string) => new Request(`http://localhost${path}`);
const download = (sessionId: string, materialId: string) =>
  downloadDeliverable(get(deliverableDownloadUrl(sessionId, materialId)), materialId);
const verify = (sessionId: string, sourceId: string) =>
  verifyDeliverable(get(deliverableVerifyUrl(sessionId, sourceId)));

beforeEach(() => {
  state.runtime = true;
  state.enabled = true;
  state.annotations = false;
  state.ownerId = 'user:one';
  state.sessions.clear();
  state.materials.clear();
  state.objects.clear();
  state.sessions.set('s1', { id: 's1', ownerId: 'user:one' });
  state.sessions.set('s2', { id: 's2', ownerId: 'user:two' });
  seed();
});

describe('handout download', () => {
  it('serves a handout file to its owner as a private attachment', async () => {
    const response = await download('s1', 'mat_pdf');
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PDF)).toBe(true);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('讲义.pdf')}`,
    );
    expect(response.headers.get('Set-Cookie')).toBe('owner=kept');
  });

  it('answers 404 while the feature or the agent runtime is off', async () => {
    state.enabled = false;
    expect((await download('s1', 'mat_pdf')).status).toBe(404);
    state.enabled = true;
    state.runtime = false;
    expect((await download('s1', 'mat_pdf')).status).toBe(404);
  });

  it('answers 404 to another owner, and for a file asked through another session', async () => {
    state.ownerId = 'user:two';
    expect((await download('s1', 'mat_pdf')).status).toBe(404);
    expect((await download('s2', 'mat_pdf')).status).toBe(404);
  });

  it('serves an annotated image with only the annotation switch on, and no handout check', async () => {
    put(
      'mat_note',
      's1',
      'cell-annotated.png',
      PNG,
      'image/png',
      `urn:zhexu:annotation:${'b'.repeat(64)}:png:${sha(PNG)}`,
    );
    state.enabled = false;
    expect((await download('s1', 'mat_note')).status).toBe(404);
    state.annotations = true;
    const response = await download('s1', 'mat_note');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect((await download('s1', 'mat_upload')).status).toBe(404);
    expect((await verify('s1', 'mat_rec')).status).toBe(404);
  });

  it('does not serve session materials that are not handout files', async () => {
    expect((await download('s1', 'mat_upload')).status).toBe(404);
    expect((await download('s1', 'mat_rec')).status).toBe(404);
  });

  it('does not serve a handout row whose stored bytes are not a handout type', async () => {
    state.objects.get('s1/mat_png')!.mime = 'text/html';
    expect((await download('s1', 'mat_png')).status).toBe(404);
  });

  it('rejects malformed ids', async () => {
    expect((await downloadDeliverable(get('/x?sessionId=s1'), '../mat_pdf')).status).toBe(404);
    expect((await downloadDeliverable(get('/x?sessionId=s%2F1'), 'mat_pdf')).status).toBe(404);
    expect((await downloadDeliverable(get('/x'), 'mat_pdf')).status).toBe(404);
  });
});

describe('handout verification', () => {
  it('reports an intact handout without calling a model', async () => {
    const response = await verify('s1', 'mat_rec');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await response.json()) as {
      modelCalls: number;
      delivery: Record<string, unknown>;
    };
    expect(body.modelCalls).toBe(0);
    expect(body.delivery).toMatchObject({
      status: 'saved',
      deliveryState: 'delivered',
      sourceId: 'mat_rec',
      sessionId: 's1',
      readOnly: true,
    });
    expect(body.delivery.files).toHaveLength(2);
  });

  it('reports a missing file as partial and keeps the intact one', async () => {
    state.objects.delete('s1/mat_pdf');
    const body = (await (await verify('s1', 'mat_rec')).json()) as {
      delivery: Record<string, unknown>;
    };
    expect(body.delivery).toMatchObject({ deliveryState: 'partial', missingFormats: ['pdf'] });
    expect(body.delivery.files).toHaveLength(1);
  });

  it('answers 404 to another owner, for an unknown record and while off', async () => {
    expect((await verify('s1', 'mat_nope')).status).toBe(404);
    expect((await verify('s1', 'mat_pdf')).status).toBe(404);
    state.ownerId = 'user:two';
    expect((await verify('s1', 'mat_rec')).status).toBe(404);
    expect((await verify('s2', 'mat_rec')).status).toBe(404);
    state.ownerId = 'user:one';
    state.enabled = false;
    expect((await verify('s1', 'mat_rec')).status).toBe(404);
  });
});
