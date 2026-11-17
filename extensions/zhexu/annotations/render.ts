import { registerFonts, TEXT_FAMILY } from '../deliverables/render';
import { wrapDeliverableText } from '../deliverables/text-layout';
import {
  ANNOTATION_MAX_SOURCE_BYTES,
  ANNOTATION_MAX_SOURCE_PIXELS,
  FULL_IMAGE_FRAME,
  imageAnnotationsSchema,
  imageCropPixels,
  type ImageAnnotation,
  type ImageCrop,
} from './contract';

/**
 * Image work of the annotation feature: the bounded preview the model is shown
 * and the A4 page with numbered labels. Everything is drawn from the original's
 * real pixels; no image model is called and the original is never rewritten.
 */

/** A preview must fit this, so one look cannot crowd the model's context. */
export const IMAGE_PREVIEW_MAX_BYTES = 32 * 1024;

const PAGE = { width: 1600, height: 2263 } as const;
const MARGIN = 64;
const IMAGE_TOP = 110;
const IMAGE_BOX = { width: PAGE.width - MARGIN * 2, height: 1450 } as const;
const PALETTE = { accent: '#14554E', mark: '#B42335', ink: '#172022', muted: '#50605C' } as const;

function sniffedMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

export interface ImagePreview {
  bytes: Buffer;
  width: number;
  height: number;
  /** The part of the original the preview shows, after rounding to pixels. */
  frame: ImageCrop;
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * A JPEG preview of the whole image or of one crop, small enough for the model.
 * The stored type must match what the bytes really are. The image is turned
 * upright first, so a crop is always given in what a person would see.
 */
export async function prepareImagePreview(
  bytes: Buffer,
  mime: string,
  signal?: AbortSignal,
  crop?: ImageCrop,
): Promise<ImagePreview> {
  signal?.throwIfAborted();
  if (!bytes.length || bytes.length > ANNOTATION_MAX_SOURCE_BYTES) throw Error('image_size');
  if (!sniffedMime(bytes) || sniffedMime(bytes) !== mime.toLowerCase()) throw Error('image_format');
  const { default: sharp } = await import('sharp');
  const input = { limitInputPixels: ANNOTATION_MAX_SOURCE_PIXELS, failOn: 'warning' as const };
  const metadata = await sharp(bytes, input).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
    throw Error('image_format');
  const turned = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const sourceWidth = turned ? metadata.height : metadata.width;
  const sourceHeight = turned ? metadata.width : metadata.height;
  const region = crop ? imageCropPixels(crop, sourceWidth, sourceHeight) : undefined;
  for (const [edge, quality] of [
    [1536, 76],
    [1280, 62],
    [1024, 48],
    [768, 40],
    [640, 36],
    [512, 32],
    [384, 28],
  ] as const) {
    signal?.throwIfAborted();
    let pipeline = sharp(bytes, input).rotate();
    if (region)
      pipeline = pipeline.extract({
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
      });
    const output = await pipeline
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    signal?.throwIfAborted();
    if (output.data.byteLength <= IMAGE_PREVIEW_MAX_BYTES)
      return {
        bytes: output.data,
        width: output.info.width,
        height: output.info.height,
        frame: region?.frame ?? FULL_IMAGE_FRAME,
        sourceWidth,
        sourceHeight,
      };
  }
  throw Error('image_preview_size');
}

/** The original as an upright, opaque PNG that fits the page's image area. */
async function pageImage(bytes: Buffer, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (!bytes.length || bytes.length > ANNOTATION_MAX_SOURCE_BYTES) throw Error('image_size');
  const { default: sharp } = await import('sharp');
  const source = sharp(bytes, {
    limitInputPixels: ANNOTATION_MAX_SOURCE_PIXELS,
    failOn: 'warning',
  });
  const metadata = await source.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
    throw Error('image_format');
  const result = await source
    .rotate()
    .resize({ ...IMAGE_BOX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png()
    .timeout({ seconds: 5 })
    .toBuffer();
  signal?.throwIfAborted();
  return result;
}

export interface RenderedAnnotation {
  png: Buffer;
  pdf: Buffer;
}

/**
 * One A4 page: the image, a numbered marker with an arrow at every point, and
 * the labels listed under the image. Points are fractions of the original.
 */
export async function renderAnnotatedImage(
  bytes: Buffer,
  annotations: ImageAnnotation[],
  title: string,
  signal?: AbortSignal,
): Promise<RenderedAnnotation> {
  const labels = imageAnnotationsSchema.parse(annotations);
  const normalized = await pageImage(bytes, signal);
  await registerFonts();
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const canvas = createCanvas(PAGE.width, PAGE.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE.width, PAGE.height);

  ctx.fillStyle = PALETTE.accent;
  ctx.fillRect(MARGIN - 16, 30, 7, 46);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `34px ${TEXT_FAMILY}, sans-serif`;
  const heading = wrapDeliverableText(title, (part) => ctx.measureText(part).width, 1400);
  ctx.fillText(heading.length > 1 ? `${heading[0]}…` : heading[0]!, MARGIN + 8, 66);

  const image = await loadImage(normalized);
  const left = (PAGE.width - image.width) / 2;
  ctx.drawImage(image, left, IMAGE_TOP);

  ctx.font = `26px ${TEXT_FAMILY}, sans-serif`;
  const markers: Array<{ x: number; y: number }> = [];
  for (const [index, label] of labels.entries()) {
    const x = left + label.x * image.width;
    const y = IMAGE_TOP + label.y * image.height;
    // The marker sits beside the point, on the side that has room, and an arrow
    // leads from it to the point itself. When two points are close, the later
    // marker takes the first free place around its point so neither hides the other.
    const side = label.x > 0.8 ? -48 : 48;
    const place = ([dx, dy]: readonly [number, number]) => ({
      x: Math.min(1530, Math.max(70, x + dx)),
      y: Math.min(PAGE.height - 120, Math.max(95, y + dy)),
    });
    const places = (
      [
        [side, -40],
        [side, 40],
        [-side, -40],
        [-side, 40],
        [0, -66],
        [0, 66],
      ] as const
    ).map(place);
    const marker =
      places.find((spot) =>
        markers.every((other) => Math.hypot(other.x - spot.x, other.y - spot.y) >= 46),
      ) ?? places[0]!;
    markers.push(marker);
    const markerX = marker.x;
    const markerY = marker.y;
    const angle = Math.atan2(y - markerY, x - markerX);
    ctx.strokeStyle = PALETTE.mark;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(markerX, markerY);
    ctx.lineTo(x, y);
    ctx.moveTo(x - 13 * Math.cos(angle - 0.5), y - 13 * Math.sin(angle - 0.5));
    ctx.lineTo(x, y);
    ctx.lineTo(x - 13 * Math.cos(angle + 0.5), y - 13 * Math.sin(angle + 0.5));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(markerX, markerY, 20, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.mark;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), markerX, markerY + 9);
    ctx.textAlign = 'left';

    ctx.fillStyle = PALETTE.ink;
    const column = index % 2;
    const row = Math.floor(index / 2);
    wrapDeliverableText(`${index + 1}. ${label.label}`, (part) => ctx.measureText(part).width, 695)
      .slice(0, 2)
      .forEach((line, i) =>
        ctx.fillText(
          line,
          MARGIN + column * 750,
          IMAGE_TOP + image.height + 60 + row * 70 + i * 30,
        ),
      );
  }

  ctx.fillStyle = PALETTE.muted;
  ctx.font = `18px ${TEXT_FAMILY}, sans-serif`;
  ctx.fillText('标注由 AI 辅助生成，使用前请核对位置；原图未改动。', MARGIN, 2190);
  ctx.fillText(
    'AI-assisted labels: check the positions before use. The original image is unchanged.',
    MARGIN,
    2214,
  );
  ctx.fillText('ZHEXU', MARGIN, 2238);

  signal?.throwIfAborted();
  const png = await canvas.encode('png');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setCreator('ZHEXU image annotations');
  pdf.setTitle(title);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(await pdf.embedPng(png), {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });
  signal?.throwIfAborted();
  return { png, pdf: Buffer.from(await pdf.save()) };
}
