import path from 'node:path';
import { isConcreteMediaAddress } from '@openmaic/dsl';
import {
  DELIVERABLE_FORMAT_MIME,
  DELIVERABLE_MAX_FILE_BYTES,
  deliverableSourceSchema,
  type DeliverableFormat,
  type DeliverableSource,
} from './contract';
import { IMAGE_ROW, layoutBody, plainLineAbove, type BodyLine } from './body-layout';
import { KATEX_FONTS, typesetFormula, type FormulaPainter } from './formula';
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
/** Formulas are set at KaTeX's usual 1.2 times the printed text, whatever the body face. */
const FORMULA_SIZE = 36;
const PALETTE = {
  paper: '#FFFFFF',
  accent: '#14554E',
  ink: '#172824',
  muted: '#60716C',
  /** A table's header row. */
  shade: '#E6EFED',
} as const;

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
  // Formulas are typeset with KaTeX's fonts, which upstream ships alongside.
  ...KATEX_FONTS,
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
    // Read at run time from `public/`, which a deployment ships as it is. The
    // comment keeps the build from tracing every file under the project root.
    if (
      !GlobalFonts.registerFromPath(
        path.join(/* turbopackIgnore: true */ process.cwd(), file),
        family,
      )
    )
      throw Error('deliverable_font_unavailable');
  }
  fontsReady = true;
}

/**
 * Reads a picture a handout names, as the handout's owner may read it; null
 * when there is none. `maxBytes` is a cap the reader enforces before reading.
 */
export type DeliverableImageReader = (
  ref: string,
  maxBytes: number,
) => Promise<{ bytes: Uint8Array } | null>;

/** Bounds on the pictures of one handout. */
export const IMAGE_LIMITS = {
  count: 24,
  bytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  pixels: 40_000_000,
} as const;

/**
 * The pixel size a PNG, JPEG, WebP or GIF declares in its header, or null for
 * any other file. Read before decoding, so a small file that declares a huge
 * picture is refused without allocating it.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (offset: number, text: string) =>
    bytes.length >= offset + text.length &&
    bytes.toString('latin1', offset, offset + text.length) === text;
  const size = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  if (ascii(0, '\x89PNG\r\n\x1a\n') && ascii(12, 'IHDR') && bytes.length >= 24)
    return size(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  if ((ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) && bytes.length >= 10)
    return size(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP') && bytes.length >= 30) {
    if (ascii(12, 'VP8 ') && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
      return size(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
    if (ascii(12, 'VP8L') && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (ascii(12, 'VP8X')) return size(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the JPEG segments to the first start-of-frame marker.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      const frame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame) return size(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

export async function renderDeliverable(
  value: DeliverableSource,
  signal?: AbortSignal,
  options: { readImage?: DeliverableImageReader } = {},
): Promise<RenderedDeliverable[]> {
  const source = deliverableSourceSchema.parse(value);
  signal?.throwIfAborted();
  await registerFonts();
  const { createCanvas, Path2D, loadImage } = await import('@napi-rs/canvas');
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
  const bodyFont = `${bodySize}px ${bodyFamily}, sans-serif`;
  const linesPerPage = Math.floor((height - heading.bodyTop - 90) / bodyLineHeight);
  const room = linesPerPage * bodyLineHeight;
  const plainAbove = plainLineAbove(bodyLineHeight);
  const measureIn = (font: string) => (text: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  // Pictures are read and decoded before the layout, which needs their size.
  // Only an asset id is read: a URL (web or data) is never fetched.
  const pictures = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
  if (options.readImage) {
    let total = 0;
    for (const row of source.body.split(/\r?\n/)) {
      const ref = IMAGE_ROW.exec(row)?.[2];
      // Upstream's own test: a URL, a data URL or a path is not an asset id.
      if (!ref || pictures.has(ref) || isConcreteMediaAddress(ref)) continue;
      if (pictures.size >= IMAGE_LIMITS.count) break;
      signal?.throwIfAborted();
      const read = await options
        .readImage(ref, Math.min(IMAGE_LIMITS.bytes, IMAGE_LIMITS.totalBytes - total))
        .catch(() => null);
      if (!read) continue;
      const declared = imageSize(read.bytes);
      if (!declared || declared.width * declared.height > IMAGE_LIMITS.pixels) continue;
      total += read.bytes.byteLength;
      const picture = await loadImage(Buffer.from(read.bytes)).catch(() => null);
      // The decoder must agree with the header that was checked.
      if (!picture || picture.width !== declared.width || picture.height !== declared.height)
        continue;
      pictures.set(ref, picture);
    }
  }
  const body = layoutBody(source.body, {
    width: bodyWidth,
    lineHeight: bodyLineHeight,
    measure: measureIn(bodyFont),
    typeset: (latex, display, scale) =>
      typesetFormula(latex, {
        display,
        size: FORMULA_SIZE * scale,
        color: PALETTE.ink,
        fallback: TEXT_FAMILY,
        measure: (text, font) => measureIn(font)(text),
      }),
    image: (ref) => {
      const picture = pictures.get(ref);
      return picture ? { width: picture.width, height: picture.height } : null;
    },
    // At most half a page, so a picture leaves room for what explains it.
    imageHeight: Math.floor((height - heading.bodyTop - 90) / 2),
  });
  // A page break in the text starts a new page; text that does not fit a page
  // runs on to the next one. A break with nothing after it adds no empty page.
  // Plain lines are one line height apart, their first baseline at the top of
  // the body; a line with a tall formula takes the room it needs.
  const pages: Array<Array<{ line: BodyLine; baseline: number }>> = [];
  for (const lines of body.sections) {
    let page: Array<{ line: BodyLine; baseline: number }> = [];
    let used = 0;
    const place = (line: BodyLine) => {
      page.push({ line, baseline: heading.bodyTop + used + (line.above - plainAbove) });
      used += line.above + line.below;
    };
    for (const line of lines) {
      const pitch = line.above + line.below;
      if (page.length && used + pitch > room + 0.001) {
        pages.push(page);
        page = [];
        used = 0;
        // A table that runs on to this page shows its header row again.
        if (line.repeat) place(line.repeat);
      }
      place(line);
    }
    if (page.length) pages.push(page);
  }
  if (pages.length > MAX_PAGES) throw Error('deliverable_page_limit');
  const painter: FormulaPainter = {
    text(text, font, x, baseline, color) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(text, x, baseline);
    },
    rect(x, y, width, rectHeight, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, rectHeight);
    },
    path(d, matrix, clip, color) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
      ctx.transform(...matrix);
      ctx.fillStyle = color;
      ctx.fill(new Path2D(d));
      ctx.restore();
    },
    line(from, to, lineWidth, clip, color) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.width, clip.height);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    },
  };

  for (const pageLines of pages) {
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
    for (const { line, baseline } of pageLines)
      for (const item of line.items) {
        const x = MARGIN + item.x;
        const y = baseline + (item.y ?? 0);
        if (item.kind === 'formula') item.formula.paint(painter, x, y);
        else if (item.kind === 'image') {
          const picture = pictures.get(item.ref);
          if (picture) ctx.drawImage(picture, x, y, item.width, item.height);
        } else if (item.kind === 'rule' || item.kind === 'shade') {
          ctx.fillStyle = item.kind === 'rule' ? PALETTE.muted : PALETTE.shade;
          ctx.fillRect(x, y, item.width, item.height);
        } else {
          ctx.font = bodyFont;
          ctx.fillStyle = PALETTE.ink;
          ctx.fillText(item.text, x, y);
        }
      }
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
