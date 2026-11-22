import { z } from 'zod';

/**
 * A4 handouts: what the agent hands over as real files (a PDF and page images)
 * instead of text to copy out of the conversation. This file is shared by the
 * server tools, the download routes and the chat card, so it holds no Node or
 * browser code.
 */

/** Media type of the saved source a handout is rendered from. */
export const DELIVERABLE_MIME = 'application/vnd.zhexu.deliverable+json';

/** Largest file a handout may produce or serve. */
export const DELIVERABLE_MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * A form feed in the body of a handout: what follows starts on a new page. A
 * worksheet uses it to keep its answers off the page of questions.
 */
export const DELIVERABLE_PAGE_BREAK = '\f';

export const deliverableSourceSchema = z
  .object({
    kind: z.literal('document'),
    title: z.string().trim().min(1).max(160),
    body: z.string().max(20000),
    style: z.enum(['standard', 'handwriting']).default('standard'),
    /**
     * False when the body is text to print as it is, not Markdown: a course's
     * own text, where a `*` or a leading `-` is what the course says. Absent
     * (never defaulted, so a saved source keeps its hash) means Markdown.
     */
    markdown: z.literal(false).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.body.trim()) ctx.addIssue({ code: 'custom', message: 'Document body is required' });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32000)
      ctx.addIssue({ code: 'custom', message: 'Split this document into smaller parts' });
  });
export type DeliverableSource = z.infer<typeof deliverableSourceSchema>;

export const DELIVERABLE_FORMATS = ['pdf', 'png', 'zip'] as const;
export type DeliverableFormat = (typeof DELIVERABLE_FORMATS)[number];

export const DELIVERABLE_FORMAT_MIME: Record<DeliverableFormat, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  zip: 'application/zip',
};

export interface DeliverableFile {
  format: DeliverableFormat;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  materialId: string;
  download: string;
  pages: number;
}

export const DELIVERABLE_TOOL_NAMES = [
  'create_deliverable',
  'create_course_handout',
  'export_deliverable',
  'read_deliverable',
  'verify_deliverable',
] as const;

/**
 * The tools whose result the chat shows as a file card: the handout tools and
 * the image annotation tool, which delivers its files the same way.
 */
export const DELIVERABLE_CARD_TOOL_NAMES: readonly string[] = [
  'create_deliverable',
  'create_course_handout',
  'export_deliverable',
  'verify_deliverable',
  'annotate_image',
];

/**
 * What the extension records in a material's `sourceUrl` for a file it made.
 * Only materials carrying it are served by the download endpoint.
 */
export const DELIVERED_FILE_PROVENANCE = /^urn:zhexu:(deliverable|annotation):/;

const DOWNLOAD_BASE = '/api/extensions/zhexu/deliverables';

/** Where the owner downloads one file of a handout. */
export function deliverableDownloadUrl(sessionId: string, materialId: string): string {
  return `${DOWNLOAD_BASE}/${encodeURIComponent(materialId)}?sessionId=${encodeURIComponent(sessionId)}`;
}

/** Where the chat card re-checks a saved handout without calling a model. */
export function deliverableVerifyUrl(sessionId: string, sourceId: string): string {
  return `${DOWNLOAD_BASE}?sessionId=${encodeURIComponent(sessionId)}&sourceId=${encodeURIComponent(sourceId)}`;
}

/** True for a download link this feature issued; the card shows nothing else. */
export function isDeliverableDownloadUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\/api\/extensions\/zhexu\/deliverables\/mat_[a-z0-9]+\?sessionId=[a-zA-Z0-9%_-]+$/.test(value)
  );
}
