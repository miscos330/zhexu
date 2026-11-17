/**
 * Image annotations of the ZHEXU extension (`extensions/zhexu/annotations/`):
 * the geometry that maps a point seen in a crop back to the original, the
 * preview and page rendering on real pixels, the two agent tools against an
 * in-memory session, and when the tools are offered at all.
 */

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FULL_IMAGE_FRAME,
  imageCropPixels,
  imageViewPoint,
} from '@/extensions/zhexu/annotations/contract';
import {
  IMAGE_PREVIEW_MAX_BYTES,
  prepareImagePreview,
  renderAnnotatedImage,
} from '@/extensions/zhexu/annotations/render';
import { buildImageAnnotationTools } from '@/extensions/zhexu/annotations/tools';
import { isDeliverableDownloadUrl } from '@/extensions/zhexu/deliverables/contract';

/** A real 800×400 PNG: left half blue, right half green, so a crop is recognisable. */
async function picture(width = 800, height = 400): Promise<Buffer> {
  const half = Math.floor(width / 2);
  const left = await sharp({
    create: { width: half, height, channels: 3, background: '#2040c0' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#20a040' } })
    .composite([{ input: left, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(png)
    .extract({ left: x, top: y, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

describe('annotation geometry', () => {
  it('cuts whole pixels and reports the rectangle that was really cut', () => {
    const region = imageCropPixels({ x: 0.333, y: 0.25, width: 0.333, height: 0.5 }, 1000, 400);
    expect(region).toMatchObject({ left: 333, top: 100, width: 333, height: 200 });
    expect(region.frame).toEqual({ x: 0.333, y: 0.25, width: 0.333, height: 0.5 });
    const uneven = imageCropPixels({ x: 0.1, y: 0.1, width: 0.25, height: 0.25 }, 333, 333);
    expect(uneven.left / 333).toBe(uneven.frame.x);
    expect(uneven.width / 333).toBe(uneven.frame.width);
  });

  it('maps a point in a view back to the original', () => {
    expect(imageViewPoint({ x: 0.5, y: 0.5 }, FULL_IMAGE_FRAME)).toEqual({ x: 0.5, y: 0.5 });
    expect(imageViewPoint({ x: 0.5, y: 1 }, { x: 0.5, y: 0.2, width: 0.4, height: 0.3 })).toEqual({
      x: 0.7,
      y: 0.5,
    });
    expect(() => imageViewPoint({ x: 1.2, y: 0 }, FULL_IMAGE_FRAME)).toThrow('image_point');
  });

  it('rejects a crop that leaves the image', () => {
    expect(() => imageCropPixels({ x: 0.8, y: 0, width: 0.5, height: 1 }, 100, 100)).toThrow();
  });
});

describe('image preview', () => {
  it('returns a bounded JPEG of the whole image', async () => {
    const preview = await prepareImagePreview(await picture(3000, 1500), 'image/png');
    expect(preview.bytes.length).toBeLessThanOrEqual(IMAGE_PREVIEW_MAX_BYTES);
    expect((await sharp(preview.bytes).metadata()).format).toBe('jpeg');
    expect(preview.frame).toEqual(FULL_IMAGE_FRAME);
    expect([preview.sourceWidth, preview.sourceHeight]).toEqual([3000, 1500]);
    expect(preview.width).toBeLessThanOrEqual(1536);
  });

  it('returns only the requested part for a crop', async () => {
    const preview = await prepareImagePreview(await picture(), 'image/png', undefined, {
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(preview.frame).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    const [r, g, b] = await pixel(await sharp(preview.bytes).png().toBuffer(), 10, 10);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('refuses bytes that are not the stored type, and what is not an image', async () => {
    await expect(prepareImagePreview(await picture(), 'image/jpeg')).rejects.toThrow(
      'image_format',
    );
    await expect(prepareImagePreview(Buffer.from('<svg/>'), 'image/png')).rejects.toThrow(
      'image_format',
    );
  });
});

describe('annotated page', () => {
  it('draws an A4 page with a marker beside each point and keeps the image itself', async () => {
    const source = await picture();
    const { png, pdf } = await renderAnnotatedImage(
      source,
      [
        { x: 0.25, y: 0.5, label: '左半：蓝色区域' },
        { x: 0.75, y: 0.5, label: 'Right half: green' },
      ],
      '颜色分区',
    );
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1600, 2263]);
    const document = await PDFDocument.load(pdf);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getSize().width).toBeCloseTo(595.28);

    // The 800×400 image is centred at x=400, y=110. Point 1 is at (600, 310);
    // its marker is a red disc centred 48px right and 40px up.
    const [r, g, b] = await pixel(png, 600 + 48 - 14, 310 - 40);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(100);
    // Untouched image pixels keep the picture's colours.
    const [, , blue] = await pixel(png, 420, 130);
    expect(blue).toBeGreaterThan(150);
    const [, green] = await pixel(png, 1180, 480);
    expect(green).toBeGreaterThan(120);
  });

  it('keeps both markers visible when two points coincide', async () => {
    const { png } = await renderAnnotatedImage(
      await picture(),
      [
        { x: 0.25, y: 0.5, label: 'first' },
        { x: 0.25, y: 0.5, label: 'second' },
      ],
      't',
    );
    const red = async (x: number, y: number) => {
      const [r, g] = await pixel(png, x, y);
      return r > 150 && g < 80;
    };
    // First marker up and to the right of (600, 310), second one below it.
    expect(await red(600 + 48 - 14, 310 - 40)).toBe(true);
    expect(await red(600 + 48 - 14, 310 + 40)).toBe(true);
  });

  it('stops before drawing when the run was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderAnnotatedImage(
        await picture(),
        [{ x: 0.5, y: 0.5, label: 'x' }],
        't',
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

interface ToolResult {
  isError?: boolean;
  details: Record<string, unknown>;
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

async function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  let next = 0;
  const add = (id: string, title: string, bytes: Buffer, mime: string, kind = 'source') => {
    records.set(id, { id, sessionId: 's1', kind, title, rawAssetId: `s1/${id}` });
    objects.set(`s1/${id}`, { bytes, mime });
  };
  add('mat_img', 'cell.png', await picture(), 'image/png');
  add('mat_doc', 'notes.pdf', Buffer.from('%PDF notes'), 'application/pdf');
  const handle = (record: Record<string, unknown>) => ({
    id: String(record.id),
    kind: String(record.kind),
    title: (record.title as string | undefined) ?? null,
    hasBytes: true,
    read: async () => objects.get(String(record.rawAssetId)) ?? null,
  });
  const owned = vi.fn(async () => ({ id: 's1', ownerId: 'user:one' }));
  const render = vi.fn(async (_bytes: Buffer, _points: unknown, _title: string) => ({
    png: Buffer.from('PNG annotated'),
    pdf: Buffer.from('%PDF annotated'),
  }));
  const persist = vi.fn(
    async (
      sessionId: string,
      input: { filename: string; mimeType: string; bytes: Buffer; sourceUrl?: string },
    ) => {
      const id = `mat_out${++next}`;
      const record = {
        id,
        sessionId,
        kind: 'source',
        title: input.filename,
        rawAssetId: `${sessionId}/${id}`,
        sourceUrl: input.sourceUrl,
      };
      records.set(id, record);
      objects.set(`${sessionId}/${id}`, { bytes: Buffer.from(input.bytes), mime: input.mimeType });
      return record;
    },
  );
  const tools = buildImageAnnotationTools({
    sessionId: 's1',
    ownerId: 'user:one',
    resolveSession: owned,
    render,
    persist,
    list: async () => [...records.values()],
    resolveImage: async (sessionId: string, id: string) => {
      const record = records.get(id);
      return record && record.sessionId === sessionId ? handle(record) : null;
    },
    listImages: async (sessionId: string) =>
      [...records.values()].filter((record) => record.sessionId === sessionId).map(handle),
    read: async (_sessionId: string, key: string) => objects.get(key) ?? null,
  } as never);
  const run = (name: string, input: unknown, signal?: AbortSignal) =>
    tools
      .find((tool) => tool.name === name)!
      .execute('c1', input as never, signal) as unknown as Promise<ToolResult>;
  return { tools, run, render, persist, owned, records, objects };
}

const POINTS = [{ x: 0.5, y: 0.5, label: 'nucleus' }];

describe('image annotation tools', () => {
  it('shows the model the image and names the view', async () => {
    const f = await fixture();
    const seen = await f.run('view_material_image', { materialId: 'mat_img' });
    expect(seen.isError).not.toBe(true);
    expect(seen.details.viewId).toMatch(/^view_[a-f0-9]{24}$/);
    expect(seen.details.frame).toEqual(FULL_IMAGE_FRAME);
    const image = seen.content.find((part) => part.type === 'image')!;
    expect(image.mimeType).toBe('image/jpeg');
    expect((await sharp(Buffer.from(image.data!, 'base64')).metadata()).width).toBe(800);
  });

  it('finds an image by its file name', async () => {
    const f = await fixture();
    expect(
      (await f.run('view_material_image', { materialId: 'cell.png' })).details.materialId,
    ).toBe('mat_img');
  });

  it('will not annotate an image the model has not looked at', async () => {
    const f = await fixture();
    const out = await f.run('annotate_image', { materialId: 'mat_img', annotations: POINTS });
    expect(out.isError).toBe(true);
    expect(out.details.reason).toBe('image_not_viewed');
    expect(f.render).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('saves a PNG and a PDF with download links after a look at the whole image', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    const out = await f.run('annotate_image', {
      materialId: 'mat_img',
      title: '植物细胞',
      annotations: POINTS,
    });
    expect(out.isError).not.toBe(true);
    expect(out.details).toMatchObject({
      status: 'saved',
      deliveryState: 'delivered',
      kind: 'annotation',
      title: '植物细胞',
      imageId: 'mat_img',
      reviewState: 'needs-review',
      annotations: POINTS,
    });
    const files = out.details.files as Array<{
      format: string;
      download: string;
      filename: string;
    }>;
    expect(files.map((file) => file.format)).toEqual(['png', 'pdf']);
    expect(files.every((file) => isDeliverableDownloadUrl(file.download))).toBe(true);
    expect(files[0]!.filename).toMatch(/^植物细胞-annotated-[a-f0-9]{12}\.png$/);
    expect(f.persist.mock.calls.map((call) => call[1].sourceUrl)).toEqual([
      expect.stringMatching(/^urn:zhexu:annotation:[a-f0-9]{64}:png:[a-f0-9]{64}$/),
      expect.stringMatching(/^urn:zhexu:annotation:[a-f0-9]{64}:pdf:[a-f0-9]{64}$/),
    ]);
    // The original is still exactly what was uploaded.
    expect(f.objects.get('s1/mat_img')!.bytes.equals(await picture())).toBe(true);
  });

  it('maps points given in a crop back to the original', async () => {
    const f = await fixture();
    const crop = await f.run('view_material_image', {
      materialId: 'mat_img',
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
    await f.run('annotate_image', {
      materialId: 'mat_img',
      viewId: crop.details.viewId,
      annotations: [{ x: 0.5, y: 0.5, label: 'in the crop' }],
    });
    expect(f.render.mock.calls[0]![1]).toEqual([{ x: 0.75, y: 0.5, label: 'in the crop' }]);
  });

  it('asks for the view when the last look was a crop, and refuses an unknown one', async () => {
    const f = await fixture();
    await f.run('view_material_image', {
      materialId: 'mat_img',
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    const bare = await f.run('annotate_image', { materialId: 'mat_img', annotations: POINTS });
    expect(bare.details.reason).toBe('image_view_id_required');
    const wrong = await f.run('annotate_image', {
      materialId: 'mat_img',
      viewId: `view_${'0'.repeat(24)}`,
      annotations: POINTS,
    });
    expect(wrong.details.reason).toBe('image_view_not_found');
    expect(f.render).not.toHaveBeenCalled();
  });

  it('refuses points when the image changed after the look', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    f.objects.get('s1/mat_img')!.bytes = await picture(400, 400);
    const out = await f.run('annotate_image', { materialId: 'mat_img', annotations: POINTS });
    expect(out.details.reason).toBe('image_source_changed');
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('returns the saved files for the same annotation instead of drawing it again', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    const first = await f.run('annotate_image', { materialId: 'mat_img', annotations: POINTS });
    const second = await f.run('annotate_image', { materialId: 'mat_img', annotations: POINTS });
    expect(second.details.files).toEqual(first.details.files);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.persist).toHaveBeenCalledTimes(2);
  });

  it('draws at most two different annotations in one run', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    for (const label of ['one', 'two'])
      expect(
        (
          await f.run('annotate_image', {
            materialId: 'mat_img',
            annotations: [{ x: 0.1, y: 0.1, label }],
          })
        ).isError,
      ).not.toBe(true);
    const third = await f.run('annotate_image', {
      materialId: 'mat_img',
      annotations: [{ x: 0.1, y: 0.1, label: 'three' }],
    });
    expect(third.details.reason).toBe('image_render_limit');
  });

  it('limits looks per run and does not return the same view twice', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    expect((await f.run('view_material_image', { materialId: 'mat_img' })).details.reason).toBe(
      'image_duplicate_view',
    );
    for (const x of [0, 0.25, 0.5])
      await f.run('view_material_image', {
        materialId: 'mat_img',
        crop: { x, y: 0, width: 0.25, height: 0.5 },
      });
    const fifth = await f.run('view_material_image', {
      materialId: 'mat_img',
      crop: { x: 0.75, y: 0, width: 0.25, height: 0.5 },
    });
    expect(fifth.details.reason).toBe('image_view_limit');
  });

  it('refuses another owner’s session, a material of another session and a non-image', async () => {
    const f = await fixture();
    expect((await f.run('view_material_image', { materialId: 'mat_doc' })).details.reason).toBe(
      'image_format',
    );
    f.records.get('mat_img')!.sessionId = 's2';
    expect((await f.run('view_material_image', { materialId: 'mat_img' })).details.reason).toBe(
      'image_not_found',
    );
    f.records.get('mat_img')!.sessionId = 's1';
    f.owned.mockResolvedValue({ id: 's1', ownerId: 'user:other' });
    for (const [name, input] of [
      ['view_material_image', { materialId: 'cell.png' }],
      ['annotate_image', { materialId: 'mat_img', annotations: POINTS }],
    ] as const) {
      const out = await f.run(name, input);
      expect(out.isError).toBe(true);
      expect(out.details.reason).toBe('image_not_found');
      expect(out.content.some((part) => part.type === 'image')).toBe(false);
    }
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('rejects malformed points', async () => {
    const f = await fixture();
    await f.run('view_material_image', { materialId: 'mat_img' });
    for (const annotations of [[], [{ x: 2, y: 0, label: 'out' }], [{ x: 0, y: 0, label: ' ' }]])
      expect((await f.run('annotate_image', { materialId: 'mat_img', annotations })).isError).toBe(
        true,
      );
    expect(f.render).not.toHaveBeenCalled();
  });
});

describe('when the annotation tools are offered', () => {
  const context = (modelSeesImages: boolean) => ({
    sessionId: 's1',
    ownerId: 'user:one',
    messages: () => [],
    modelSeesImages,
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const tools = async (env: Record<string, string>, modelSeesImages: boolean) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.resetModules();
    const seam = await import('@/extensions/agent-tools');
    return (await seam.deploymentAgentTools(context(modelSeesImages))).map((tool) => tool.name);
  };

  it('offers nothing while the switch is off', async () => {
    expect(await tools({ NEXT_PUBLIC_DEPLOYMENT_EXTENSION: 'zhexu' }, true)).toEqual([]);
  });

  it('offers nothing to a model that is not declared vision-capable', async () => {
    expect(
      await tools(
        { NEXT_PUBLIC_DEPLOYMENT_EXTENSION: 'zhexu', ZHEXU_IMAGE_ANNOTATIONS_ENABLED: 'true' },
        false,
      ),
    ).toEqual([]);
  });

  it('offers both tools to a vision model with the switch on, without the handout tools', async () => {
    expect(
      await tools(
        { NEXT_PUBLIC_DEPLOYMENT_EXTENSION: 'zhexu', ZHEXU_IMAGE_ANNOTATIONS_ENABLED: '1' },
        true,
      ),
    ).toEqual(['view_material_image', 'annotate_image']);
  });

  it('does not turn on from the switch alone, without the extension', async () => {
    expect(await tools({ ZHEXU_IMAGE_ANNOTATIONS_ENABLED: 'true' }, true)).toEqual([]);
  });
});
