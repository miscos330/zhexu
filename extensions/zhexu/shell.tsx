'use client';

/**
 * The 折序 ZHEXU deployment extension: brand, theme tokens and the workspace
 * shell's host slots. Everything here adds to the upstream shell through
 * `WorkbenchShellExtensionsProvider` and `BrandProvider`; no upstream
 * component is edited.
 */

import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { BookOpen, FolderDown, Info } from 'lucide-react';
import { BrandProvider } from '@/lib/brand/brand-context';
import {
  WorkbenchShellExtensionsProvider,
  type WorkbenchShellExtensions,
} from '@/lib/workbench/shell-extensions';
import { useI18n } from '@/lib/hooks/use-i18n';
import { ZhexuAboutPage } from './about-page';
import { ZHEXU_BRAND, ZHEXU_LINKS } from './brand';
import { ZhexuFilesPage } from './files-page';
import { zhexuMessages } from './messages';
import './theme.css';
// Generated: upstream's literal violet values, repeated under the brand scope.
import './theme-upstream-literals.css';

/** The rail page id; the page is addressable as `/workspace?view=zhexu-about`. */
export const ZHEXU_ABOUT_VIEW = 'zhexu-about';
/** The rail page of delivered files, addressable as `/workspace?view=zhexu-files`. */
export const ZHEXU_FILES_VIEW = 'zhexu-files';

const ABOUT_HREF = `/workspace?view=${ZHEXU_ABOUT_VIEW}`;

export function buildZhexuShellExtensions(locale: string): WorkbenchShellExtensions {
  const m = zhexuMessages(locale);
  return {
    navItems: [
      {
        id: ZHEXU_FILES_VIEW,
        label: m.filesNav,
        icon: FolderDown,
        render: () => <ZhexuFilesPage />,
      },
      { id: ZHEXU_ABOUT_VIEW, label: m.aboutNav, icon: Info, render: () => <ZhexuAboutPage /> },
    ],
    accountMenuItems: [
      { id: 'zhexu-about', label: m.menuAbout, icon: Info, href: ABOUT_HREF },
      {
        id: 'zhexu-upstream',
        label: m.menuUpstream,
        icon: BookOpen,
        href: ZHEXU_LINKS.upstream,
        external: true,
      },
    ],
    homeSection: (
      <p className="mx-auto mt-4 max-w-xl text-center text-xs text-muted-foreground">
        {m.homeNote}
        {' · '}
        <Link href={ABOUT_HREF} className="text-primary underline-offset-4 hover:underline">
          {m.homeLink}
        </Link>
      </p>
    ),
  };
}

export function ZhexuExtension({ children }: { readonly children: ReactNode }) {
  const { locale } = useI18n();
  const value = useMemo(() => buildZhexuShellExtensions(locale), [locale]);
  return (
    <BrandProvider brand={ZHEXU_BRAND}>
      <WorkbenchShellExtensionsProvider value={value}>{children}</WorkbenchShellExtensionsProvider>
    </BrandProvider>
  );
}
