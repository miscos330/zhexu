import { DELIVERABLE_FORMATS, deliverableDownloadUrl, type DeliverableFormat } from './contract';

/**
 * "My files": what the extension has delivered across an owner's
 * conversations, read from the session materials that carry its provenance.
 * This file is shared by the route and the page, so it holds no Node or
 * browser code. Nothing is stored for the page: it is a view of what exists.
 */

export interface DeliveredFileLink {
  format: DeliverableFormat;
  filename: string;
  materialId: string;
  download: string;
}

export interface DeliveredEntry {
  /** Stable across requests: the kind and the hash of what the files were made from. */
  key: string;
  kind: 'handout' | 'annotation';
  title: string;
  sessionId: string;
  sessionTitle: string | null;
  /** ISO-8601 time of the earliest file, when the store records one. */
  createdAt: string | null;
  files: DeliveredFileLink[];
}

export interface DeliveredLibrary {
  entries: DeliveredEntry[];
  /** True when the owner has more conversations or files than one answer lists. */
  truncated: boolean;
  /** Where the next page starts (`?after=`), when there are more conversations. */
  next?: string;
}

/** Conversations looked at for one listing, newest first. */
export const LIBRARY_SESSION_LIMIT = 50;
/** Entries one listing returns. */
export const LIBRARY_ENTRY_LIMIT = 200;

interface Ordered {
  id: string;
  updatedAt: number;
}

/** The listing's order: most recently active conversation first, then by id. */
export function libraryOrder(a: Ordered, b: Ordered): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const CURSOR = /^(\d{1,16})~([^\s~]{1,200})$/;

/**
 * A page of the listing ends after a conversation; the next page starts after
 * it in the listing's order. A position, not a page number: a conversation that
 * becomes active meanwhile moves to the front instead of shifting later pages.
 */
export function libraryCursor(session: Ordered): string {
  return `${Math.max(0, Math.trunc(session.updatedAt))}~${session.id}`;
}

/** The position a cursor names, or null for anything that is not one. */
export function parseLibraryCursor(value: string): Ordered | null {
  const match = CURSOR.exec(value);
  return match ? { updatedAt: Number(match[1]), id: match[2]! } : null;
}

const PROVENANCE = /^urn:zhexu:(deliverable|annotation):([^:]{1,128}):(pdf|png|zip):[a-f0-9]{64}$/;
const MATERIAL_ID = /^mat_[a-z0-9]{1,96}$/;

export interface LibraryMaterial {
  id: string;
  title: string | null;
  sourceUrl: string | null;
  createdAt?: string | null;
}

/** The handout title a file name was built from: without the hash and the extension. */
function titleOf(filename: string): string {
  return (
    filename
      .replace(/\.(pdf|png|zip)$/i, '')
      .replace(/-annotated-[a-f0-9]{12}$/, '')
      .replace(/-[a-f0-9]{12}$/, '')
      .trim() || filename
  );
}

/**
 * The delivered entries of one conversation: its materials that the extension
 * wrote, with the files of one handout or one annotated image put together.
 * Uploads, web pages and anything else in the conversation are left out.
 */
export function deliveredEntries(
  session: { id: string; title: string | null },
  materials: readonly LibraryMaterial[],
): DeliveredEntry[] {
  const byKey = new Map<string, DeliveredEntry>();
  for (const material of materials) {
    const match = material.sourceUrl ? PROVENANCE.exec(material.sourceUrl) : null;
    if (!match || !MATERIAL_ID.test(material.id)) continue;
    const kind = match[1] === 'annotation' ? 'annotation' : 'handout';
    const key = `${kind}:${match[2]}`;
    const filename = material.title ?? material.id;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        kind,
        title: titleOf(filename),
        sessionId: session.id,
        sessionTitle: session.title,
        createdAt: null,
        files: [],
      };
      byKey.set(key, entry);
    }
    const format = match[3] as DeliverableFormat;
    // A file written twice for the same source keeps its first copy.
    if (entry.files.some((file) => file.format === format)) continue;
    entry.files.push({
      format,
      filename,
      materialId: material.id,
      download: deliverableDownloadUrl(session.id, material.id),
    });
    if (material.createdAt && (!entry.createdAt || material.createdAt < entry.createdAt))
      entry.createdAt = material.createdAt;
  }
  const order = (format: DeliverableFormat) => DELIVERABLE_FORMATS.indexOf(format);
  for (const entry of byKey.values()) entry.files.sort((a, b) => order(a.format) - order(b.format));
  return [...byKey.values()];
}

/** Newest first; entries without a time go last, in a stable order. */
export function sortDeliveredEntries(entries: DeliveredEntry[]): DeliveredEntry[] {
  return entries.toSorted(
    (a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.key.localeCompare(b.key),
  );
}
