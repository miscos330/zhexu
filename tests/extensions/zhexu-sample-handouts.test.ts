/**
 * Renders the sample handout pages the README and the showcase page show, with
 * the real renderer and fixed test content. Skipped unless asked for, so a
 * normal test run writes nothing:
 *
 *   ZHEXU_RENDER_SAMPLES=1 pnpm exec vitest run tests/extensions/zhexu-sample-handouts.test.ts
 *
 * No app, database or model is involved, and the same content always gives the
 * same pages. The picture is the browser tests' fixture, read from disk in
 * place of the owner's asset store.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { renderDeliverable } from '@/extensions/zhexu/deliverables/render';

const ROOT = resolve(__dirname, '../..');
const OUT = join(ROOT, 'extensions/zhexu/site/assets/shots');
const PICTURE = join(ROOT, 'extensions/zhexu/e2e/fixtures/cell-diagram.png');
const PICTURE_ID = 'ast_sample_cell_diagram';
/** Stored width in pixels, the same as the other samples. */
const STORED_WIDTH = 760;

const FORMULAS_BODY = [
  '## 一、总反应',
  '细胞呼吸把葡萄糖里的化学能转移到 ATP 中。**有氧呼吸**的总反应式：',
  '\\[ \\mathrm{C_6H_{12}O_6} + 6\\,\\mathrm{O_2} \\longrightarrow 6\\,\\mathrm{CO_2} + 6\\,\\mathrm{H_2O} + \\text{能量} \\]',
  '- 释放约 \\(2870\\ \\mathrm{kJ}\\)，约 \\(\\frac{977}{2870} \\approx 34\\%\\) 储存在 ATP 中',
  '- 其余以*热能*散失',
  '| 阶段 | 场所 | 产物 | ATP |',
  '| --- | --- | --- | :---: |',
  '| 第一阶段 | 细胞质基质 | 丙酮酸、[H] | 少量 |',
  '| 第二阶段 | 线粒体基质 | CO₂、[H] | 少量 |',
  '| 第三阶段 | 线粒体内膜 | H₂O | 大量 |',
  '| 合计 | < | < | 约 30–32 个 |',
  '思考：下图的植物细胞里，有氧呼吸的第二、三阶段在哪里进行？',
  `![植物细胞结构示意](${PICTURE_ID})`,
].join('\n');

/** The handwriting page. Its last line mixes in Greek, subscripts, Korean and Cyrillic, which other faces draw. */
const HANDWRITING_BODY = [
  '## 一、什么是光的折射',
  '光从一种介质斜射入另一种介质时，传播方向发生偏折，这种现象叫做光的折射。例如把筷子斜插入水中，从水面上方看，筷子好像在水面处“折断”了。',
  '## 二、折射规律',
  '1. 折射光线、入射光线和法线在同一平面内。',
  '2. 折射光线和入射光线分居法线两侧。',
  '3. 光从空气斜射入水或玻璃时，折射角小于入射角；反之折射角大于入射角。',
  '4. 垂直入射时，传播方向不变。',
  '## 三、课堂练习',
  '（1）画出光从空气斜射入水中的光路图，并标出入射角 i 和折射角 r。',
  '（2）解释：为什么池水看起来比实际的浅？',
  '',
  "Mixed text: Snell's law n₁·sinθ₁ = n₂·sinθ₂; 한국어 굴절; Преломление света.",
].join('\n');

async function readImage(ref: string): Promise<{ bytes: Uint8Array } | null> {
  return ref === PICTURE_ID ? { bytes: await readFile(PICTURE) } : null;
}

describe.skipIf(process.env.ZHEXU_RENDER_SAMPLES !== '1')('sample handout pages', () => {
  it('renders the page with formulas, a table and a picture', async () => {
    const outputs = await renderDeliverable(
      { kind: 'document', title: '细胞呼吸', body: FORMULAS_BODY, style: 'standard' },
      undefined,
      { readImage },
    );
    // The sample is one page: the PDF holds them all, the PNG is the first.
    expect(outputs.find((output) => output.format === 'pdf')?.pages).toBe(1);
    await writeSample(outputs, 'sample-handout-formulas.webp');
  }, 120_000);

  it('renders the page in the handwriting face', async () => {
    const outputs = await renderDeliverable({
      kind: 'document',
      title: '第三课 光的折射（课堂讲义）',
      body: HANDWRITING_BODY,
      style: 'handwriting',
    });
    expect(outputs.find((output) => output.format === 'pdf')?.pages).toBe(1);
    await writeSample(outputs, 'sample-handout.webp');
  }, 120_000);
});

/** Store the first page image, scaled to the stored width, as WebP. */
async function writeSample(
  outputs: Awaited<ReturnType<typeof renderDeliverable>>,
  name: string,
): Promise<void> {
  const png = outputs.find((output) => output.format === 'png');
  const webp = await sharp(png!.bytes)
    .resize({ width: STORED_WIDTH })
    .webp({ quality: 82, effort: 6 })
    .toBuffer();
  await writeFile(join(OUT, name), webp);
}
