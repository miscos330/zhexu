import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import {
  getSessionMaterial,
  listSessionMaterials,
  resolveOwnedSession,
  resolveSessionMaterialRawAsset,
} from '@/lib/server/agent-runtime/session-materials';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { workbenchSessionTitle } from '@/lib/workbench/session-title';
import { zhexuImageAnnotationsEnabled } from '../annotations/enabled';
import {
  DELIVERABLE_FORMAT_MIME,
  DELIVERABLE_MAX_FILE_BYTES,
  DELIVERED_FILE_PROVENANCE,
} from './contract';
import { zhexuDeliverablesEnabled } from './enabled';
import {
  deliveredEntries,
  LIBRARY_ENTRY_LIMIT,
  LIBRARY_SESSION_LIMIT,
  libraryCursor,
  libraryOrder,
  parseLibraryCursor,
  sortDeliveredEntries,
  type DeliveredEntry,
  type DeliveredLibrary,
} from './library';
import { buildDeliverableTools } from './tools';

/**
 * The HTTP endpoints of the handout feature. The files under
 * `app/api/extensions/zhexu/` only forward to these, so the feature's behavior
 * stays in the extension.
 *
 * All answer 404 for anything the requesting owner may not see, including
 * "the feature is off": a caller learns nothing about other owners' sessions.
 */

const SESSION_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MATERIAL_ID = /^mat_[a-z0-9]{1,96}$/;
const SERVED_MIMES: ReadonlySet<string> = new Set(Object.values(DELIVERABLE_FORMAT_MIME));

/** Downloads serve the files of handouts and of image annotations; verification is for handouts. */
const downloadsAvailable = () =>
  isAgentRuntimeConfigured() && (zhexuDeliverablesEnabled() || zhexuImageAnnotationsEnabled());
const verificationAvailable = () => isAgentRuntimeConfigured() && zhexuDeliverablesEnabled();
const notFound = (headers?: Headers) => new Response('Not found', { status: 404, headers });

/**
 * Response headers of a private file: never cached, never sniffed, always a
 * download. The sandbox policy is a second guard only: the app-wide
 * `Content-Security-Policy` header of `next.config.ts` replaces it in the running
 * app, so nothing here relies on it.
 */
function fileHeaders(base: Headers, filename: string, mime: string, length: number): Headers {
  const headers = new Headers(base);
  headers.set('Content-Type', mime);
  headers.set('Content-Length', String(length));
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  return headers;
}

/** GET one file the extension delivered. Only the PDF, PNG and ZIP it produces are served. */
export async function downloadDeliverable(req: Request, materialId: string): Promise<Response> {
  if (!downloadsAvailable()) return notFound();
  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const sessionId = new URL(req.url).searchParams.get('sessionId') ?? '';
    if (!SESSION_ID.test(sessionId) || !MATERIAL_ID.test(materialId))
      return notFound(responseHeaders);
    const session = await resolveOwnedSession(sessionId, ownerId);
    if (!session || session.id !== sessionId || session.ownerId !== ownerId)
      return notFound(responseHeaders);
    const material = await getSessionMaterial(sessionId, materialId);
    if (!material?.rawAssetId || material.sessionId !== sessionId) return notFound(responseHeaders);
    // Only what the extension's own tools wrote carries this provenance. Other session
    // materials (uploads, web pages) are not downloadable through this route.
    if (!material.sourceUrl || !DELIVERED_FILE_PROVENANCE.test(material.sourceUrl))
      return notFound(responseHeaders);
    const raw = await resolveSessionMaterialRawAsset(sessionId, material.rawAssetId);
    if (!raw || !SERVED_MIMES.has(raw.mime) || raw.bytes.length > DELIVERABLE_MAX_FILE_BYTES)
      return notFound(responseHeaders);
    return new Response(new Uint8Array(raw.bytes), {
      headers: fileHeaders(
        responseHeaders,
        material.title ?? materialId,
        raw.mime,
        raw.bytes.length,
      ),
    });
  });
}

/**
 * GET the state of a saved handout: which of its files are still stored exactly
 * as written. Runs the read-only verify tool, so the answer is the same one the
 * agent would get, and `modelCalls: 0` states that no model was involved.
 */
export async function verifyDeliverable(req: Request): Promise<Response> {
  if (!verificationAvailable()) return notFound();
  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const query = new URL(req.url).searchParams;
    const sessionId = query.get('sessionId') ?? '';
    const sourceId = query.get('sourceId') ?? '';
    if (!SESSION_ID.test(sessionId) || !MATERIAL_ID.test(sourceId))
      return notFound(responseHeaders);
    const verify = buildDeliverableTools({ sessionId, ownerId, latestAnswer: () => '' }).find(
      (tool) => tool.name === 'verify_deliverable',
    );
    if (!verify) return notFound(responseHeaders);
    const result = await verify.execute('verify', { sourceId }, req.signal);
    const details = result.details as { sourceId?: string; deliveryState?: string } | undefined;
    if (details?.sourceId !== sourceId) return notFound(responseHeaders);
    const headers = new Headers(responseHeaders);
    headers.set('Cache-Control', 'private, no-store');
    return Response.json({ delivery: details, modelCalls: 0 }, { headers });
  });
}

/**
 * GET what the extension has delivered to the requesting owner, across their
 * conversations, newest first ("My files").
 *
 * The conversations come from the store's owner-only listing, so the answer
 * never holds a file of another owner. It is a view: nothing is written, and a
 * conversation whose materials cannot be read is left out, not an error for
 * the whole page. At most `LIBRARY_SESSION_LIMIT` conversations are looked at.
 */
export async function listDeliveredFiles(req: Request): Promise<Response> {
  if (!downloadsAvailable()) return notFound();
  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const after = new URL(req.url).searchParams.get('after');
    const cursor = after === null ? null : parseLibraryCursor(after);
    if (after !== null && !cursor) {
      const headers = new Headers(responseHeaders);
      headers.set('Cache-Control', 'private, no-store');
      return Response.json({ error: 'bad_cursor' }, { status: 400, headers });
    }
    const store = await getAgentSessionStore();
    const sessions = (await store.listSessionsByOwner(ownerId))
      .filter((session) => session.ownerId === ownerId)
      .toSorted(libraryOrder);
    // This page: the conversations after the cursor, at most a page of them,
    // and whole conversations only, so the next page starts where this one ends.
    const remaining = cursor
      ? sessions.filter((session) => libraryOrder(session, cursor) > 0)
      : sessions;
    const entries: DeliveredEntry[] = [];
    let included = 0;
    for (const session of remaining.slice(0, LIBRARY_SESSION_LIMIT)) {
      req.signal.throwIfAborted();
      const materials = await listSessionMaterials(session.id, { limit: 100 }).catch(() => []);
      const found = deliveredEntries(
        { id: session.id, title: workbenchSessionTitle(session) },
        materials.filter((material) => material.sessionId === session.id),
      );
      if (included > 0 && entries.length + found.length > LIBRARY_ENTRY_LIMIT) break;
      entries.push(...found);
      included += 1;
    }
    const sorted = sortDeliveredEntries(entries);
    const more = remaining.length > included;
    const body: DeliveredLibrary = {
      entries: sorted.slice(0, LIBRARY_ENTRY_LIMIT),
      truncated: more || sorted.length > LIBRARY_ENTRY_LIMIT,
      ...(more && included > 0 ? { next: libraryCursor(remaining[included - 1]!) } : {}),
    };
    const headers = new Headers(responseHeaders);
    headers.set('Cache-Control', 'private, no-store');
    return Response.json(body, { headers });
  });
}
