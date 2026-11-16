/**
 * The extension's own strings. They live here rather than in the upstream
 * locale bundles so rebasing on upstream never conflicts with them. Chinese
 * locales get Chinese; every other locale falls back to English.
 */

export interface ZhexuMessages {
  readonly aboutNav: string;
  readonly aboutTitle: string;
  readonly aboutLead: string;
  readonly aboutCredit: string;
  readonly aboutLicense: string;
  readonly linksHeading: string;
  readonly upstreamLink: string;
  readonly sourceLink: string;
  readonly menuAbout: string;
  readonly menuUpstream: string;
  readonly homeNote: string;
  readonly homeLink: string;
}

const ZH: ZhexuMessages = {
  aboutNav: '关于折序',
  aboutTitle: '折序 ZHEXU',
  aboutLead: '基于 OpenMAIC 的开源 AI 互动课堂。',
  aboutCredit:
    '本版本以 THU-MAIC/OpenMAIC 为底座构建，在其之上加入折序的品牌、主题和扩展功能；通用改进会提交回上游。',
  aboutLicense: '遵循 MIT 许可，保留 THU-MAIC 原版权声明。',
  linksHeading: '相关链接',
  upstreamLink: 'OpenMAIC 上游项目',
  sourceLink: '本项目源代码',
  menuAbout: '关于折序',
  menuUpstream: 'OpenMAIC 上游项目',
  homeNote: '折序 ZHEXU · 基于 OpenMAIC 的开源 AI 课堂',
  homeLink: '了解更多',
};

const EN: ZhexuMessages = {
  aboutNav: 'About ZHEXU',
  aboutTitle: 'ZHEXU',
  aboutLead: 'An open-source AI interactive classroom built on OpenMAIC.',
  aboutCredit:
    'This edition is built on THU-MAIC/OpenMAIC and adds the ZHEXU brand, theme and extensions on top; general improvements go back upstream.',
  aboutLicense: 'MIT licensed; the original THU-MAIC copyright notice is kept.',
  linksHeading: 'Links',
  upstreamLink: 'OpenMAIC upstream',
  sourceLink: 'Source code',
  menuAbout: 'About ZHEXU',
  menuUpstream: 'OpenMAIC upstream',
  homeNote: 'ZHEXU · an open-source AI classroom built on OpenMAIC',
  homeLink: 'Learn more',
};

export function zhexuMessages(locale: string): ZhexuMessages {
  return locale.toLowerCase().startsWith('zh') ? ZH : EN;
}
