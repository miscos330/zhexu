import { z } from 'zod';

/**
 * Image annotations: numbered labels the agent puts on an image the user
 * attached, delivered as an A4 PNG and PDF. The original image is never
 * changed. Shared by the server tools and the tests, so this file holds no Node
 * or browser code.
 */

export const IMAGE_VIEW_TOOL_NAME = 'view_material_image';
export const IMAGE_ANNOTATE_TOOL_NAME = 'annotate_image';

/** Image types that can be viewed and annotated. */
export const ANNOTATION_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Largest original that is read, and the pixel count beyond which it is refused. */
export const ANNOTATION_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const ANNOTATION_MAX_SOURCE_PIXELS = 20_000_000;

/** A label and the point it names, as fractions of the image's width and height. */
export const imageAnnotationsSchema = z
  .array(
    z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        label: z.string().trim().min(1).max(48),
      })
      .strict(),
  )
  .min(1)
  .max(12);
export type ImageAnnotation = z.infer<typeof imageAnnotationsSchema>[number];

/** A rectangle of the original, as fractions of its width and height. */
export const imageCropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.02).max(1),
    height: z.number().min(0.02).max(1),
  })
  .strict()
  .refine(
    (value) => value.x + value.width <= 1 && value.y + value.height <= 1,
    'Crop must stay inside the original',
  );
export type ImageCrop = z.infer<typeof imageCropSchema>;

export const FULL_IMAGE_FRAME: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

/** One look the model took at an image: which part of which bytes it was shown. */
export interface MaterialImageView {
  viewId: string;
  materialId: string;
  sourceSha256: string;
  frame: ImageCrop;
}

/**
 * The pixel rectangle of a crop. Points are mapped back through the rectangle
 * that was actually cut, after rounding, not through the fractions requested.
 */
export function imageCropPixels(input: ImageCrop, width: number, height: number) {
  const crop = imageCropSchema.parse(input);
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0))
    throw Error('image_dimensions');
  const left = Math.floor(crop.x * width);
  const top = Math.floor(crop.y * height);
  const right = Math.min(width, Math.ceil((crop.x + crop.width) * width));
  const bottom = Math.min(height, Math.ceil((crop.y + crop.height) * height));
  if (right <= left || bottom <= top) throw Error('image_crop');
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    frame: {
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
    } satisfies ImageCrop,
  };
}

/** A point given relative to a view, as a point of the original. */
export function imageViewPoint(point: { x: number; y: number }, frame: ImageCrop) {
  imageCropSchema.parse(frame);
  if (![point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
    throw Error('image_point');
  return {
    x: Math.min(1, frame.x + point.x * frame.width),
    y: Math.min(1, frame.y + point.y * frame.height),
  };
}
