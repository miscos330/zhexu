'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ChatNode } from '@/lib/workbench/session-store';
import { zhexuMessages } from '../messages';
import {
  DELIVERABLE_FORMATS,
  deliverableVerifyUrl,
  isDeliverableDownloadUrl,
  type DeliverableFormat,
} from './contract';

interface CardFile {
  format: DeliverableFormat;
  filename: string;
  download: string;
  bytes: number;
  pages: number;
}

interface CardDetails {
  status?: string;
  title?: string;
  sourceId?: string;
  sessionId?: string;
  deliveryState?: string;
  files?: unknown[];
}

/** Only files with a link this feature issued are shown; anything else in the result is ignored. */
function shownFiles(details: CardDetails): CardFile[] {
  if (!Array.isArray(details.files)) return [];
  return details.files.filter((file): file is CardFile => {
    if (!file || typeof file !== 'object') return false;
    const candidate = file as Partial<CardFile>;
    return (
      DELIVERABLE_FORMATS.includes(candidate.format as DeliverableFormat) &&
      isDeliverableDownloadUrl(candidate.download) &&
      Number.isSafeInteger(candidate.bytes) &&
      (candidate.bytes ?? 0) > 0
    );
  });
}

/**
 * The handout a tool call produced: a preview of the first page, its download
 * links and whether the files are still intact. "Check files" asks the server
 * to verify the saved bytes again; it calls no model.
 */
export function DeliverableCard({ node }: { node: ChatNode }) {
  const { locale } = useI18n();
  const m = zhexuMessages(locale);
  const [verified, setVerified] = useState<CardDetails | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    setVerified(null);
    setFailed(false);
    setChecking(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [node.toolDetails]);

  const details = (verified ?? node.toolDetails) as CardDetails | undefined;
  if (!details || typeof details !== 'object') return null;
  if (!['saved', 'missing'].includes(details.status ?? '')) return null;
  const files = shownFiles(details);
  const sourceId =
    typeof details.sourceId === 'string' && /^mat_[a-z0-9]+$/.test(details.sourceId)
      ? details.sourceId
      : null;
  if (!files.length && !sourceId) return null;

  const state = details.deliveryState ?? (files.length ? 'delivered' : 'missing');
  const preview = files.find((file) => file.format === 'png');
  const status = failed
    ? m.deliveryVerifyFailed
    : !files.length
      ? m.deliveryMissing
      : state === 'partial'
        ? m.deliveryPartial
        : verified
          ? m.deliveryVerified
          : m.deliverySaved;

  const verify = async () => {
    if (request.current || !sourceId) return;
    const sessionId =
      details.sessionId ??
      (files[0]
        ? new URL(files[0].download, window.location.origin).searchParams.get('sessionId')
        : null);
    if (!sessionId) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setFailed(false);
    try {
      const response = await fetch(deliverableVerifyUrl(sessionId, sourceId), {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw Error('verification');
      const value = (await response.json()) as { modelCalls?: number; delivery?: CardDetails };
      if (
        value.modelCalls !== 0 ||
        value.delivery?.sourceId !== sourceId ||
        !['delivered', 'partial'].includes(value.delivery?.deliveryState ?? '')
      )
        throw Error('receipt');
      if (!controller.signal.aborted) setVerified(value.delivery ?? null);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setChecking(false);
      }
    }
  };

  return (
    <section
      aria-label={m.deliveryLabel}
      className="mx-3 mb-3 rounded-lg border border-border p-3"
      data-testid="zhexu-deliverable-card"
      data-delivery-state={state}
    >
      <p className="text-sm font-medium text-foreground">{details.title}</p>
      {preview ? (
        // Served by the extension's own route with the owner's session; next/image cannot fetch it.
        <img
          src={preview.download}
          width={310}
          height={438}
          alt={details.title ?? m.deliveryLabel}
          className="mt-2 h-auto max-h-72 w-auto max-w-full rounded border border-border object-contain"
        />
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        {status}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {files.map((file) => (
          <a
            key={file.download}
            href={file.download}
            download={file.filename}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Download className="size-3.5" aria-hidden />
            {file.format.toUpperCase()}
            <span className="text-xs text-muted-foreground">
              {m.deliveryPages(file.pages)}, {Math.ceil(file.bytes / 1024)} KB
            </span>
          </a>
        ))}
        {sourceId ? (
          <button
            type="button"
            disabled={checking}
            onClick={verify}
            className="rounded-md px-3 py-1.5 text-sm text-primary underline-offset-4 hover:underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {checking ? m.deliveryChecking : m.deliveryVerify}
          </button>
        ) : null}
      </div>
    </section>
  );
}
