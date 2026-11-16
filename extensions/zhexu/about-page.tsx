'use client';

/**
 * The extension's rail page (`/workspace?view=zhexu-about`): what this edition
 * is, the upstream it is built on, and its links.
 */

import { ExternalLink } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { ZHEXU_BRAND, ZHEXU_LINKS } from './brand';
import { zhexuMessages } from './messages';

export function ZhexuAboutPage() {
  const { locale } = useI18n();
  const m = zhexuMessages(locale);
  const links = [
    { href: ZHEXU_LINKS.upstream, label: m.upstreamLink },
    ...(ZHEXU_LINKS.source ? [{ href: ZHEXU_LINKS.source, label: m.sourceLink }] : []),
  ];

  return (
    <section aria-labelledby="zhexu-about-title" className="mx-auto w-full max-w-2xl px-6 py-10">
      {/* A static SVG from public/; next/image adds nothing for it. */}
      <img
        src={ZHEXU_BRAND.logoSrc}
        alt={ZHEXU_BRAND.productName}
        width={176}
        height={64}
        className="h-14 w-auto"
      />
      <h1 id="zhexu-about-title" className="mt-6 text-2xl font-semibold text-foreground">
        {m.aboutTitle}
      </h1>
      <p className="mt-2 text-base text-foreground">{m.aboutLead}</p>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{m.aboutCredit}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{m.aboutLicense}</p>
      <h2 className="mt-8 text-sm font-medium text-foreground">{m.linksHeading}</h2>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {link.label}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
