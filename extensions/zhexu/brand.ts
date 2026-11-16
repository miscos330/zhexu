import type { BrandConfig } from '@/lib/brand/brand-config';

/**
 * 折序 ZHEXU brand. The assets live in `public/extensions/zhexu/`; their
 * origin, generator and hashes are recorded in `provenance.json` there.
 */
export const ZHEXU_BRAND: BrandConfig = {
  productName: '折序 ZHEXU',
  shortName: 'ZHEXU',
  logoSrc: '/extensions/zhexu/zhexu-signature.svg',
  logoHasWordmark: true,
  markSrc: '/extensions/zhexu/zhexu-mark.svg',
  themeColor: '#275d56',
};

/** Links shown by the extension. `source` stays unset until the public repository exists. */
export const ZHEXU_LINKS: { readonly upstream: string; readonly source?: string } = {
  upstream: 'https://github.com/THU-MAIC/OpenMAIC',
};
