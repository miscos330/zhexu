/**
 * Pictures in handouts (`extensions/zhexu/deliverables/`): a line
 * `![description](asset id)` is read through the owner's asset pool, checked
 * by its header before it is decoded, and drawn centred; anything else (a URL,
 * a data URL, a missing or unreadable file) leaves a visible note.
 */

import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { layoutBody, type BodyLayoutOptions } from '@/extensions/zhexu/deliverables/body-layout';
import { courseHandoutText } from '@/extensions/zhexu/deliverables/course-source';
import {
  IMAGE_LIMITS,
  imageSize,
  registerFonts,
  renderDeliverable,
} from '@/extensions/zhexu/deliverables/render';

/** A solid picture, `width` by `height`, in `format`. */
async function picture(format: 'png' | 'jpeg' | 'webp' | 'gif', width: number, height: number) {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 30, b: 30 } },
  });
  const encoded =
    format === 'png'
      ? image.png()
      : format === 'jpeg'
        ? image.jpeg()
        : format === 'webp'
          ? image.webp()
          : image.gif();
  return new Uint8Array(await encoded.toBuffer());
}

describe('the size a picture declares', () => {
  it('is read from the header of PNG, JPEG, WebP and GIF files', async () => {
    for (const format of ['png', 'jpeg', 'webp', 'gif'] as const)
      expect(imageSize(await picture(format, 37, 23)), format).toEqual({ width: 37, height: 23 });
    const lossless = new Uint8Array(
      await sharp({ create: { width: 41, height: 7, channels: 4, background: '#123456' } })
        .webp({ lossless: true })
        .toBuffer(),
    );
    expect(imageSize(lossless)).toEqual({ width: 41, height: 7 });
  });

  it('is unknown for anything else, so it is never decoded', () => {
    expect(
      imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });
});

describe('pictures on a handout page', () => {
  beforeAll(async () => {
    await registerFonts();
  });

  const options = (
    sizes: Record<string, { width: number; height: number }>,
  ): BodyLayoutOptions => ({
    width: 1000,
    lineHeight: 50,
    measure: (text) => text.length * 30,
    typeset: () => null,
    image: (ref) => sizes[ref] ?? null,
    imageHeight: 600,
  });

  it('is centred, as large as the column and half a page allow, never more than doubled', () => {
    const layout = layoutBody(
      '前\n![一张宽图](ast_wide)\n![一张高图](ast_tall)\n![小图](ast_small)\n后',
      options({
        ast_wide: { width: 4000, height: 1000 },
        ast_tall: { width: 300, height: 3000 },
        ast_small: { width: 100, height: 50 },
      }),
    );
    expect(layout).toMatchObject({ images: 3, missingImages: 0 });
    const drawn = layout.sections[0]!.flatMap((line) =>
      line.items.flatMap((item) => (item.kind === 'image' ? [item] : [])),
    );
    expect(drawn.map(({ width, height }) => [width, height])).toEqual([
      [1000, 250],
      [60, 600],
      [200, 100],
    ]);
    for (const item of drawn) expect(item.x).toBeCloseTo((1000 - item.width) / 2);
  });

  it('leaves a note, in the language of the text, for a picture it could not read', () => {
    const chinese = layoutBody('看图：\n![折射示意图](ast_gone)', options({}));
    expect(chinese).toMatchObject({ images: 0, missingImages: 1 });
    const texts = chinese.sections[0]!.flatMap((line) =>
      line.items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])),
    );
    expect(texts).toEqual(['看图：', '［图片未放入：折射示意图］']);
    const english = layoutBody('See:\n![](ast_gone)', options({}));
    expect(
      english.sections[0]![1]!.items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])),
    ).toEqual(['[Picture not included]']);
    // A picture written inside a line is not a picture line: it stays text.
    expect(
      layoutBody('见 ![图](ast_a) 。', options({ ast_a: { width: 10, height: 10 } })).images,
    ).toBe(0);
  });

  it('reads only asset ids, as the owner may, and draws what it read', async () => {
    const red = await picture('png', 400, 200);
    // A tiny file whose header claims a picture far over the pixel limit.
    const bomb = Buffer.from(await picture('png', 2, 2));
    bomb.writeUInt32BE(100_000, 16);
    bomb.writeUInt32BE(100_000, 20);
    const files: Record<string, Uint8Array> = {
      ast_red: red,
      ast_bomb: bomb,
      ast_text: new TextEncoder().encode('not a picture'),
    };
    const readImage = vi.fn(async (ref: string, maxBytes: number) => {
      expect(maxBytes).toBeLessThanOrEqual(IMAGE_LIMITS.bytes);
      return files[ref] ? { bytes: files[ref] } : null;
    });
    const body = [
      '图一：',
      '![红色块](ast_red)',
      '![](ast_red)',
      '![](https://example.com/a.png)',
      '![](data:image/png;base64,iVBORw0KGgo=)',
      '![](/uploads/a.png)',
      '![](ast_missing)',
      '![](ast_bomb)',
      '![](ast_text)',
    ].join('\n');
    const rendered = await renderDeliverable(
      { kind: 'document', title: '图片', style: 'standard', body },
      undefined,
      { readImage },
    );
    // A URL, a data URL and a path are never handed to the reader; a repeated id is read once.
    expect(readImage.mock.calls.map(([ref]) => ref)).toEqual([
      'ast_red',
      'ast_missing',
      'ast_bomb',
      'ast_text',
    ]);
    // The red picture is on the page: count strongly red pixels of the first page.
    const page = rendered.find((file) => file.format === 'png')!;
    const { data, info } = await sharp(page.bytes).raw().toBuffer({ resolveWithObject: true });
    let reds = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) reds += 1;
    // Drawn twice at up to twice its size: well over its own 80,000 pixels.
    expect(reds).toBeGreaterThan(80_000);
  });
});

describe('pictures of a course', () => {
  it('are written as picture lines: asset ids read, a background left out, a URL marked', () => {
    const body = courseHandoutText(
      {
        name: 'Pictures',
        scenes: [
          {
            title: 'One',
            type: 'slide',
            content: {
              type: 'slide',
              canvas: {
                elements: [
                  { type: 'image', top: 10, left: 0, src: 'ast_figure' },
                  { type: 'image', top: 0, left: 0, src: 'ast_back', imageType: 'background' },
                  { type: 'image', top: 20, left: 0, src: 'https://example.com/a.png' },
                  { type: 'image', top: 30, left: 0, src: 'data:image/png;base64,AAAA' },
                  { type: 'image', top: 40, left: 0, src: '' },
                ],
              },
            },
          },
        ],
      },
      'slides',
    ).body;
    expect(body).toBe('1. One\n![](ast_figure)\n![](-)\n![](-)');
  });
});
