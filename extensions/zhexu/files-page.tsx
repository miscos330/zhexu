'use client';

/**
 * The extension's "My files" rail page (`/workspace?view=zhexu-files`): the
 * handouts and annotated images the assistant has delivered to this owner, in
 * every conversation. It reads the list from the extension's own endpoint and
 * stores nothing; the links are the same private download links the cards in a
 * conversation use. A page of the listing covers the most recent conversations;
 * "Load more" asks for the next page, after the last conversation shown.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { isDeliverableDownloadUrl } from './deliverables/contract';
import {
  parseLibraryCursor,
  type DeliveredEntry,
  type DeliveredLibrary,
} from './deliverables/library';
import { zhexuMessages } from './messages';

export const ZHEXU_FILES_ENDPOINT = '/api/extensions/zhexu/files';

type State =
  | { status: 'loading' }
  | {
      status: 'ready';
      entries: DeliveredEntry[];
      truncated: boolean;
      /** Where the next page starts, when there is one. */
      next?: string;
      /** The "Load more" request: none, running, or failed (pressing again retries). */
      more: 'idle' | 'loading' | 'error';
    }
  /** The endpoint answers 404 while the feature is switched off. */
  | { status: 'off' }
  | { status: 'error' };

/** Only well-formed entries with links this feature issued are shown. */
function readLibrary(
  value: unknown,
): { entries: DeliveredEntry[]; truncated: boolean; next?: string } | null {
  const library = value as Partial<DeliveredLibrary> | null;
  if (!library || !Array.isArray(library.entries)) return null;
  const entries = library.entries
    .filter(
      (entry): entry is DeliveredEntry =>
        Boolean(entry) &&
        typeof entry.key === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.sessionId === 'string' &&
        Array.isArray(entry.files),
    )
    .map((entry) => ({
      ...entry,
      files: entry.files.filter((file) => isDeliverableDownloadUrl(file?.download)),
    }))
    .filter((entry) => entry.files.length > 0);
  const next =
    typeof library.next === 'string' && parseLibraryCursor(library.next) ? library.next : undefined;
  return { entries, truncated: library.truncated === true, ...(next ? { next } : {}) };
}

/** One page of the listing, after `cursor` when given; null when the feature is off. */
async function fetchLibrary(signal: AbortSignal, cursor?: string) {
  const url = cursor
    ? `${ZHEXU_FILES_ENDPOINT}?after=${encodeURIComponent(cursor)}`
    : ZHEXU_FILES_ENDPOINT;
  const response = await fetch(url, { cache: 'no-store', signal });
  if (response.status === 404) return null;
  if (!response.ok) throw Error('files');
  const library = readLibrary(await response.json());
  if (!library) throw Error('files');
  return library;
}

export function ZhexuFilesPage() {
  const { locale } = useI18n();
  const m = zhexuMessages(locale);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const library = await fetchLibrary(controller.signal);
        if (!library) return setState({ status: 'off' });
        setState({ status: 'ready', ...library, more: 'idle' });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (state.status !== 'ready' || !state.next || state.more === 'loading') return;
    const cursor = state.next;
    setState({ ...state, more: 'loading' });
    try {
      const page = await fetchLibrary(new AbortController().signal, cursor);
      setState((current) => {
        if (current.status !== 'ready' || current.next !== cursor) return current;
        if (!page) return { status: 'off' };
        // A conversation already shown is not listed twice.
        const seen = new Set(current.entries.map((entry) => `${entry.sessionId}:${entry.key}`));
        const added = page.entries.filter((entry) => !seen.has(`${entry.sessionId}:${entry.key}`));
        return {
          status: 'ready',
          entries: [...current.entries, ...added],
          truncated: page.truncated,
          ...(page.next ? { next: page.next } : {}),
          more: 'idle',
        };
      });
    } catch {
      setState((current) =>
        current.status === 'ready' && current.next === cursor
          ? { ...current, more: 'error' }
          : current,
      );
    }
  }, [state]);

  const date = (iso: string | null) => {
    if (!iso) return null;
    const time = new Date(iso);
    return Number.isNaN(time.getTime())
      ? null
      : time.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <section
      aria-labelledby="zhexu-files-title"
      className="mx-auto w-full max-w-3xl px-6 py-10"
      data-testid="zhexu-files-page"
      data-state={state.status}
    >
      <h1 id="zhexu-files-title" className="text-2xl font-semibold text-foreground">
        {m.filesTitle}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{m.filesLead}</p>

      {state.status === 'loading' ? (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          {m.filesLoading}
        </p>
      ) : null}
      {state.status === 'off' ? (
        <p className="mt-8 text-sm text-muted-foreground" role="status">
          {m.filesOff}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="mt-8" role="alert">
          <p className="text-sm text-foreground">{m.filesError}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {m.filesRetry}
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && state.entries.length === 0 ? (
        <p className="mt-8 text-sm leading-6 text-muted-foreground" role="status">
          {m.filesEmpty}
        </p>
      ) : null}
      {state.status === 'ready' && state.entries.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {state.entries.map((entry) => (
            <li
              key={`${entry.sessionId}:${entry.key}`}
              className="rounded-lg border border-border bg-card p-4"
              data-testid="zhexu-files-entry"
              data-kind={entry.kind}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="text-sm font-medium text-foreground">{entry.title}</p>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {entry.kind === 'annotation' ? m.filesAnnotation : m.filesHandout}
                </span>
                {date(entry.createdAt) ? (
                  <time
                    dateTime={entry.createdAt ?? undefined}
                    className="text-xs text-muted-foreground"
                  >
                    {date(entry.createdAt)}
                  </time>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {m.filesFrom}{' '}
                <Link
                  href={`/workspace?session=${encodeURIComponent(entry.sessionId)}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {entry.sessionTitle || m.filesUntitledChat}
                </Link>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {entry.files.map((file) => (
                  <a
                    key={file.download}
                    href={file.download}
                    download={file.filename}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Download className="size-3.5" aria-hidden />
                    {file.format.toUpperCase()}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {state.status === 'ready' && state.next ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={state.more === 'loading'}
            aria-busy={state.more === 'loading'}
            data-testid="zhexu-files-more"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
          >
            {state.more === 'loading' ? m.filesLoading : m.filesMore}
          </button>
          {state.more === 'error' ? (
            <p className="mt-2 text-xs text-foreground" role="alert">
              {m.filesMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
      {state.status === 'ready' && state.truncated && !state.next ? (
        <p className="mt-4 text-xs text-muted-foreground">{m.filesTruncated}</p>
      ) : null}
    </section>
  );
}
