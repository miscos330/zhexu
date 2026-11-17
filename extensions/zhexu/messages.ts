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
  readonly deliveryLabel: string;
  readonly deliverySaved: string;
  readonly deliveryVerified: string;
  readonly deliveryPartial: string;
  readonly deliveryMissing: string;
  readonly deliveryVerifyFailed: string;
  readonly deliveryVerify: string;
  readonly deliveryChecking: string;
  readonly deliveryPages: (pages: number) => string;
  readonly annotationLabel: string;
  readonly annotationReview: string;
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
  deliveryLabel: '讲义文件',
  deliverySaved: '文件已保存，可以下载。',
  deliveryVerified: '已重新核对，文件完好。',
  deliveryPartial: '有文件缺失，下面是还能下载的部分。',
  deliveryMissing: '文件已经不在了。可以让助手用同一份内容重新导出。',
  deliveryVerifyFailed: '这次没能核对，请稍后再试。',
  deliveryVerify: '核对文件',
  deliveryChecking: '正在核对…',
  deliveryPages: (pages) => `${pages} 页`,
  annotationLabel: '图片标注文件',
  annotationReview: '标注由 AI 辅助生成，使用前请核对位置。原图没有改动。',
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
  deliveryLabel: 'Handout files',
  deliverySaved: 'The files are saved and ready to download.',
  deliveryVerified: 'Checked again: the files are intact.',
  deliveryPartial: 'A file is missing. The ones below can still be downloaded.',
  deliveryMissing: 'The files are gone. Ask the assistant to export the same content again.',
  deliveryVerifyFailed: 'The check did not go through. Try again in a moment.',
  deliveryVerify: 'Check files',
  deliveryChecking: 'Checking…',
  deliveryPages: (pages) => (pages === 1 ? '1 page' : `${pages} pages`),
  annotationLabel: 'Annotated image files',
  annotationReview:
    'The labels are AI-assisted: check the positions before use. The original image is unchanged.',
};

export function zhexuMessages(locale: string): ZhexuMessages {
  return locale.toLowerCase().startsWith('zh') ? ZH : EN;
}
