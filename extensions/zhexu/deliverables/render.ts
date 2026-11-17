import path from 'node:path';
import {
  DELIVERABLE_FORMAT_MIME,
  DELIVERABLE_MAX_FILE_BYTES,
  deliverableSourceSchema,
  type DeliverableFormat,
  type DeliverableSource,
} from './contract';
import { wrapDeliverableText } from './text-layout';

/**
 * Draws a handout: A4 pages at 150 dpi, as one PDF, the first page as a PNG and,
 * for more than one page, a ZIP of every page image. No model is involved: the
 * same source always gives the same pages, and text that does not fit goes to
 * the next page instead of being cut.
 */

export interface RenderedDeliverable {
  format: DeliverableFormat;
  mime: string;
  bytes: Buffer;
  pages: number;
}

const PAGE = { width: 1240, height: 1754 } as const;
const MARGIN = 80;
const MAX_PAGES = 16;
const PALETTE = { paper: '#FFFFFF', accent: '#14554E', ink: '#172824', muted: '#60716C' } as const;

/** Upstream ships the text fonts for its video export; the handwriting face is ours. */
const FONTS: ReadonlyArray<readonly [file: string, family: string]> = [
  [
    'public/vendor/video-export/fonts/noto-sans-sc-chinese-simplified-400-normal.woff2',
    'ZhexuDocument',
  ],
  ['public/vendor/video-export/fonts/noto-sans-arabic-arabic-400-normal.woff2', 'ZhexuDocumentAR'],
  ['public/vendor/video-export/fonts/noto-sans-kr-korean-400-normal.woff2', 'ZhexuDocumentKR'],
  ['public/vendor/video-export/fonts/noto-sans-cyrillic-400-normal.woff2', 'ZhexuDocumentCY'],
  // Greek letters and the common math signs (√ ≤ → ∠) that the text fonts above lack.
  ['public/vendor/video-export/fonts/KaTeX_Main-Regular.woff2', 'ZhexuDocumentMath'],
  ['public/vendor/video-export/fonts/KaTeX_Math-Italic.woff2', 'ZhexuDocumentGreek'],
  ['public/extensions/zhexu/fonts/LongCang-Regular.ttf', 'ZhexuHandwriting'],
];

/** The printed face and its fallbacks, in order; a character is drawn by the first font that has it. */
export const TEXT_FAMILY =
  'ZhexuDocument, ZhexuDocumentAR, ZhexuDocumentKR, ZhexuDocumentCY, ZhexuDocumentMath, ZhexuDocumentGreek';

let fontsReady = false;
/** Register the extension's fonts with the canvas once per process. */
export async function registerFonts(): Promise<void> {
  const { GlobalFonts } = await import('@napi-rs/canvas');
  if (fontsReady) return;
  for (const [file, family] of FONTS) {
    if (!GlobalFonts.registerFromPath(path.join(process.cwd(), file), family))
      throw Error('deliverable_font_unavailable');
  }
  fontsReady = true;
}

export async function renderDeliverable(
  value: DeliverableSource,
  signal?: AbortSignal,
): Promise<RenderedDeliverable[]> {
  const source = deliverableSourceSchema.parse(value);
  signal?.throwIfAborted();
  await registerFonts();
  const { createCanvas } = await import('@napi-rs/canvas');
  const { PDFDocument } = await import('pdf-lib');

  const { width, height } = PAGE;
  const bodyWidth = width - MARGIN * 2;
  const bodyFamily = (source.style === 'handwriting' ? 'ZhexuHandwriting, ' : '') + TEXT_FAMILY;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const pdf = await PDFDocument.create();
  pdf.setCreator('ZHEXU deterministic deliverables');
  pdf.setTitle(source.title);
  const pageImages: Buffer[] = [];

  const wrap = (text: string, size: number, maxWidth: number, family: string) => {
    ctx.font = `${size}px ${family}, sans-serif`;
    return wrapDeliverableText(text, (part) => ctx.measureText(part).width, maxWidth);
  };

  /** The title shrinks until it fits in three lines; a fourth is allowed, a fifth is not. */
  const heading = (() => {
    let size = 40;
    let lines = wrap(source.title, size, width - MARGIN - 100, TEXT_FAMILY);
    while (lines.length > 3 && size > 24) {
      size -= 2;
      lines = wrap(source.title, size, width - MARGIN - 100, TEXT_FAMILY);
    }
    if (lines.length > 4) throw Error('deliverable_title_overflow');
    const lineHeight = Math.ceil(size * 1.2);
    return {
      lines,
      size,
      lineHeight,
      bodyTop: Math.max(220, 100 + (lines.length - 1) * lineHeight + 70),
    };
  })();

  const bodySize = source.style === 'handwriting' ? 38 : 30;
  const bodyLineHeight = Math.ceil(bodySize * 1.65);
  const bodyLines = wrap(source.body, bodySize, bodyWidth, bodyFamily);
  const linesPerPage = Math.floor((height - heading.bodyTop - 90) / bodyLineHeight);
  if (Math.ceil(bodyLines.length / linesPerPage) > MAX_PAGES) throw Error('deliverable_page_limit');

  for (let start = 0; start < bodyLines.length; start += linesPerPage) {
    signal?.throwIfAborted();
    const index = pageImages.length;
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = PALETTE.accent;
    ctx.fillRect(MARGIN - 16, 60, 7, 54);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `${heading.size}px ${TEXT_FAMILY}, sans-serif`;
    heading.lines.forEach((line, i) =>
      ctx.fillText(line, MARGIN + 10, 100 + i * heading.lineHeight),
    );
    ctx.font = `${bodySize}px ${bodyFamily}, sans-serif`;
    bodyLines
      .slice(start, start + linesPerPage)
      .forEach((line, i) => ctx.fillText(line, MARGIN, heading.bodyTop + i * bodyLineHeight));
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '21px ZhexuDocument, sans-serif';
    ctx.fillText(`ZHEXU · ${index + 1}`, MARGIN, height - 48);

    const png = await canvas.encode('png');
    if (png.length > 12 * 1024 * 1024) throw Error('deliverable_size');
    pageImages.push(png);
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(await pdf.embedPng(png), {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  }

  signal?.throwIfAborted();
  const file = (format: DeliverableFormat, bytes: Buffer, pages: number): RenderedDeliverable => ({
    format,
    mime: DELIVERABLE_FORMAT_MIME[format],
    bytes,
    pages,
  });
  const out = [
    file('pdf', Buffer.from(await pdf.save()), pageImages.length),
    file('png', pageImages[0]!, 1),
  ];
  if (pageImages.length > 1) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    pageImages.forEach((bytes, i) => zip.file(`page-${String(i + 1).padStart(2, '0')}.png`, bytes));
    out.push(
      file(
        'zip',
        await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
        pageImages.length,
      ),
    );
  }
  signal?.throwIfAborted();
  if (out.some((item) => item.bytes.length > DELIVERABLE_MAX_FILE_BYTES))
    throw Error('deliverable_size');
  return out;
}
