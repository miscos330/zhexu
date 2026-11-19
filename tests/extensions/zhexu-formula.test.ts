/**
 * Formulas in handouts (`extensions/zhexu/deliverables/formula.ts`). What the
 * canvas draws is compared, glyph by glyph, with where a browser puts the same
 * formulas: `fixtures/katex-browser-layout.json`, recorded with KaTeX's own
 * stylesheet and fonts by `extensions/zhexu/scripts/capture-katex-layout.mjs`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  layoutBody,
  tableBlocks,
  tableCells,
  type BodyLayoutOptions,
  type BodyLine,
} from '@/extensions/zhexu/deliverables/body-layout';
import {
  typesetFormula,
  type FormulaPainter,
  type Rect,
  type TypesetFormula,
} from '@/extensions/zhexu/deliverables/formula';
import {
  registerFonts,
  renderDeliverable,
  TEXT_FAMILY,
} from '@/extensions/zhexu/deliverables/render';
import { wrapDeliverableText } from '@/extensions/zhexu/deliverables/text-layout';

interface Captured {
  katex: string;
  size: number;
  cases: Array<{
    latex: string;
    display: boolean;
    glyphs: Array<{ text: string; x: number; y: number }>;
    rules: Rect[];
    svgs: Rect[];
  }>;
}

const captured = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'katex-browser-layout.json'), 'utf8'),
) as Captured;
const installedKatex = (
  JSON.parse(
    readFileSync(
      path.join(path.dirname(createRequire(__filename).resolve('katex')), '..', 'package.json'),
      'utf8',
    ),
  ) as { version: string }
).version;

const context = createCanvas(10, 10).getContext('2d');
const measure = (text: string, font: string) => {
  context.font = font;
  return context.measureText(text).width;
};

interface Drawn {
  glyphs: Array<{ text: string; x: number; y: number }>;
  rules: Rect[];
  svgs: Rect[];
}

function draw(latex: string, display: boolean, size = captured.size) {
  const formula = typesetFormula(latex, {
    display,
    size,
    color: '#000',
    measure,
    fallback: TEXT_FAMILY,
  });
  const drawn: Drawn = { glyphs: [], rules: [], svgs: [] };
  const painter: FormulaPainter = {
    text: (text, _font, x, y) => drawn.glyphs.push({ text, x, y }),
    rect: (x, y, width, height) => drawn.rules.push({ x, y, width, height }),
    path: (_d, _matrix, clip) => drawn.svgs.push({ ...clip }),
    line: (_from, _to, _width, clip) => drawn.svgs.push({ ...clip }),
  };
  formula?.paint(painter, 0, 0);
  // Several path pieces of one SVG share its box.
  drawn.svgs = drawn.svgs.filter(
    (box, index, all) => index === 0 || JSON.stringify(box) !== JSON.stringify(all[index - 1]),
  );
  return { formula, drawn };
}

/** Largest gap between two lists of boxes, or Infinity when they differ in number. */
function gap(a: Rect[], b: Rect[]): number {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  a.forEach((box, index) => {
    const other = b[index]!;
    for (const key of ['x', 'y', 'width', 'height'] as const)
      worst = Math.max(worst, Math.abs(box[key] - other[key]));
  });
  return worst;
}

describe('formulas typeset for a handout', () => {
  beforeAll(async () => {
    await registerFonts();
  });

  it('was compared with the KaTeX version that is installed', () => {
    expect(captured.katex).toBe(installedKatex);
  });

  it.each(captured.cases.map((item) => [item.display ? 'display' : 'inline', item.latex, item]))(
    '%s %s: every glyph, line and SVG where a browser puts it',
    (_mode, latex, expected) => {
      const { formula, drawn } = draw(latex, expected.display);
      expect(formula, 'typeset').not.toBeNull();
      expect(drawn.glyphs.map((glyph) => glyph.text)).toEqual(
        expected.glyphs.map((glyph) => glyph.text),
      );
      // Pixels at a 100px formula: half a pixel is 0.005em.
      const tolerance = 0.5;
      drawn.glyphs.forEach((glyph, index) => {
        const browser = expected.glyphs[index]!;
        expect(
          Math.abs(glyph.x - browser.x),
          `x of "${glyph.text}" (#${index})`,
        ).toBeLessThanOrEqual(tolerance);
        expect(
          Math.abs(glyph.y - browser.y),
          `y of "${glyph.text}" (#${index})`,
        ).toBeLessThanOrEqual(tolerance);
      });
      expect(gap(drawn.rules, expected.rules), 'rules').toBeLessThanOrEqual(1);
      expect(gap(drawn.svgs, expected.svgs), 'svgs').toBeLessThanOrEqual(1);
    },
  );

  it('gives up on what it cannot draw the way KaTeX lays it out', () => {
    // Chemistry needs mhchem, which upstream does not load: KaTeX cannot parse it.
    expect(draw('\\ce{H2O}', false).formula).toBeNull();
    // A vertical rule between columns, and a big operator in an overlap, are not modelled.
    expect(draw('\\begin{array}{c|c}a&b\\end{array}', false).formula).toBeNull();
    expect(draw('\\mathclap{\\sum}', true).formula).toBeNull();
    // Too long, as upstream's renderer bounds it; and nothing at all.
    expect(draw('x+'.repeat(1000) + 'x', false).formula).toBeNull();
    expect(draw('  ', false).formula).toBeNull();
  });
});

describe('a handout body with formulas', () => {
  beforeAll(async () => {
    await registerFonts();
  });

  const font = `30px ${TEXT_FAMILY}, sans-serif`;
  const options = (width = 1080): BodyLayoutOptions => ({
    width,
    lineHeight: 50,
    measure: (text) => measure(text, font),
    typeset: (latex, display, scale) =>
      typesetFormula(latex, {
        display,
        size: 36 * scale,
        color: '#000',
        measure,
        fallback: TEXT_FAMILY,
      }),
  });
  /** What a line holds: text, [formula]; a table's rules and shading are left out. */
  const kinds = (line: BodyLine) =>
    line.items.flatMap((item) =>
      item.kind === 'text'
        ? [item.text]
        : item.kind === 'formula'
          ? [`[${item.formula.latex}]`]
          : [],
    );

  it('lays plain text out as the text wrapper does, one line height a line', () => {
    const body = '第一行\n\n第二段，价格是 $5 和 $10。\n' + '很长的一段话。'.repeat(40);
    const layout = layoutBody(body, options());
    const lines = layout.sections[0]!;
    expect(
      lines.map((line) => line.items.map((item) => (item as { text: string }).text).join('')),
    ).toEqual(wrapDeliverableText(body, (text) => measure(text, font), 1080));
    expect(lines.every((line) => line.above + line.below === 50)).toBe(true);
    expect(layout).toMatchObject({ formulas: 0, untypeset: 0 });
  });

  it('keeps an inline formula in its line and gives it the room it needs', () => {
    const layout = layoutBody('速度 \\(v=\\frac{s}{t}\\)，单位 $\\mathrm{m/s}$。', options());
    const [line] = layout.sections[0]!;
    expect(kinds(line!)).toEqual(['速度 ', '[v=\\frac{s}{t}]', '，单位 ', '[\\mathrm{m/s}]', '。']);
    const xs = line!.items.map((item) => item.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // The fraction is taller than a line of text.
    expect(line!.above + line!.below).toBeGreaterThan(50);
    expect(layout).toMatchObject({ formulas: 2, untypeset: 0 });
  });

  it('puts a display formula on a line of its own, centred, without empty lines around it', () => {
    const layout = layoutBody(
      '求根公式：\n$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$\n其中 \\(a\\neq 0\\)。',
      options(),
    );
    const lines = layout.sections[0]!;
    expect(lines.map(kinds)).toEqual([
      ['求根公式：'],
      ['[x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}]'],
      ['其中 ', '[a\\neq 0]', '。'],
    ]);
    const display = lines[1]!.items[0]!;
    if (display.kind !== 'formula') throw Error('expected a formula');
    expect(display.formula.display).toBe(true);
    expect(display.x).toBeCloseTo((1080 - display.formula.width) / 2);
  });

  it('prints a formula it cannot typeset as its source, and counts it', () => {
    const layout = layoutBody(
      '表格 \\(\\begin{array}{c|c}a&b\\end{array}\\) 照原样印出',
      options(),
    );
    expect(layout.sections[0]!.map(kinds)).toEqual([
      ['表格 \\begin{array}{c|c}a&b\\end{array} 照原样印出'],
    ]);
    expect(layout).toMatchObject({ formulas: 0, untypeset: 1 });
  });

  it('shrinks a formula wider than the page onto a line of its own', () => {
    const long = Array.from({ length: 10 }, (_, i) => `a_{${i + 1}}`).join('+');
    const layout = layoutBody(`和是 \\(${long}\\)。`, options(600));
    const lines = layout.sections[0]!;
    expect(lines.map(kinds)).toEqual([['和是 '], [`[${long}]`], ['。']]);
    const formula = lines[1]!.items[0]!;
    if (formula.kind !== 'formula') throw Error('expected a formula');
    expect(formula.formula.width).toBeLessThanOrEqual(600);
    // Past half size it would be unreadable: the source is printed instead.
    const longer = Array.from({ length: 200 }, (_, i) => `a_{${i + 1}}`).join('+');
    expect(layoutBody(`\\(${longer}\\)`, options(600)).untypeset).toBe(1);
  });

  it('splits a table row at its pipes, not at escaped ones or those in a formula', () => {
    expect(tableCells('| a | b \\| c | $|x|=1$ | \\(\\|v\\|\\) |')).toEqual([
      'a',
      'b | c',
      '$|x|=1$',
      '\\(\\|v\\|\\)',
    ]);
    expect(tableCells('|  | only |')).toEqual(['', 'only']);
  });

  it('draws a pipe table as ruled rows: a header, column alignment, wrapped cells', () => {
    const body = [
      '介质如下：',
      '| 介质 | 折射率 | 光速 |',
      '| :--- | :---: | ---: |',
      '| 水 | \\(1.33\\) | 2.25 |',
      '| 玻璃 | 1.5 | 2.00 |',
      '表后。',
    ].join('\n');
    const layout = layoutBody(body, options());
    const lines = layout.sections[0]!;
    expect(lines.map(kinds)).toEqual([
      ['介质如下：'],
      ['介质', '折射率', '光速'],
      ['水', '[1.33]', '2.25'],
      ['玻璃', '1.5', '2.00'],
      ['表后。'],
    ]);
    expect(layout).toMatchObject({ tables: 1, formulas: 1, untypeset: 0 });
    // Only the header row is shaded; every row is ruled.
    expect(
      lines.slice(1, 4).map((line) => line.items.some((item) => item.kind === 'shade')),
    ).toEqual([true, false, false]);
    expect(lines.slice(1, 4).every((line) => line.items.some((item) => item.kind === 'rule'))).toBe(
      true,
    );
    // Columns are left, centre and right aligned: compare where "水"'s row puts each cell.
    const row = lines[2]!.items.filter((item) => item.kind !== 'rule' && item.kind !== 'shade');
    const rules = lines[2]!.items.flatMap((item) =>
      item.kind === 'rule' && item.height > item.width ? [item] : [],
    );
    const edges = rules.map((rule) => rule.x + rule.width / 2);
    expect(edges).toHaveLength(4);
    const [water, index, speed] = row;
    expect(water!.x - edges[0]!).toBeCloseTo(15, 0);
    const indexWidth = index!.kind === 'formula' ? index!.formula.width : 0;
    expect(index!.x - edges[1]!).toBeCloseTo(edges[2]! - (index!.x + indexWidth), 0);
    expect(edges[3]! - (speed!.x + measure('2.25', font))).toBeCloseTo(15, 0);

    // A long cell wraps inside its column; the table stays within the width.
    const wide = layoutBody(
      `| 现象 | 说明 |\n| 折断 | ${'光从水斜射入空气时发生折射。'.repeat(8)} |`,
      options(600),
    );
    const [, second] = wide.sections[0]!;
    const right = Math.max(
      ...second!.items
        .filter((item) => item.kind === 'rule')
        .map((item) => item.x + (item as { width: number }).width),
    );
    expect(right).toBeLessThanOrEqual(600 + 1);
    expect(second!.above).toBeGreaterThan(3 * 40);
  });

  it('joins cells marked < and ^ into one box, when they make a rectangle', () => {
    expect(
      tableBlocks([
        ['A', '<', 'B'],
        ['^', '^', 'C'],
        ['\\<', 'D', '^'],
      ]).map(({ r0, c0, r1, c1, text }) => [text, r0, c0, r1, c1]),
    ).toEqual([
      ['A', 0, 0, 1, 1],
      ['B', 0, 2, 0, 2],
      ['C', 1, 2, 2, 2],
      ['<', 2, 0, 2, 0],
      ['D', 2, 1, 2, 1],
    ]);
    // An L shape is not a cell: nothing is joined and the marks are text.
    expect(
      tableBlocks([
        ['A', '<'],
        ['^', 'B'],
        ['^', '<'],
      ]).map((block) => block.text),
    ).toEqual(['A', '<', '^', 'B', '^', '<']);
  });

  it('draws a joined cell as one box, keeps rows it ties together on one line', () => {
    const body = [
      '| 物质 | 性质 | < |',
      '| --- | --- | --- |',
      '| 水 | 无色 | 液体 |',
      '| ^ | 透明 | ^ |',
      '| 铁 | 银白色 | 固体 |',
    ].join('\n');
    const lines = layoutBody(body, options()).sections[0]!;
    // Header; the two rows of 水 tied by its cell; 铁.
    expect(lines.map(kinds)).toEqual([
      ['物质', '性质'],
      ['水', '无色', '液体', '透明'],
      ['铁', '银白色', '固体'],
    ]);
    // The header's 性质 spans the last two columns: its box ends where the table does.
    const shades = lines[0]!.items.flatMap((item) => (item.kind === 'shade' ? [item] : []));
    expect(shades).toHaveLength(2);
    const right = (line: BodyLine) =>
      Math.max(
        ...line.items.flatMap((item) => (item.kind === 'rule' ? [item.x + item.width] : [])),
      );
    expect(shades[1]!.x + shades[1]!.width).toBeCloseTo(right(lines[0]!) - 1, 0);
    // 水 and 液体 cover two rows: the band holds both, and 透明 sits below 无色.
    const at = (text: string) =>
      lines[1]!.items.find((item) => item.kind === 'text' && item.text === text)!;
    expect(at('透明').y!).toBeGreaterThan(at('无色').y!);
    expect(at('水').y).toBe(at('无色').y);
    // A rule between the two rows runs only under the middle column, not through 水 or 液体.
    const across = lines[1]!.items.flatMap((item) =>
      item.kind === 'rule' && item.width > item.height && item.y! > lines[1]!.items[0]!.y! + 5
        ? [item]
        : [],
    );
    expect(across.some((rule) => rule.x > at('无色').x - 30 && rule.x < at('无色').x)).toBe(true);
  });

  it('draws the header row again on each later page a long table runs on to', async () => {
    const rows = Array.from({ length: 70 }, (_, index) => `| ${index + 1} | 第 ${index + 1} 行 |`);
    const body = ['| 序号 | 内容 |', '| --- | --- |', ...rows].join('\n');
    const files = await renderDeliverable({
      kind: 'document',
      title: '长表',
      style: 'standard',
      body,
    });
    const zip = await JSZip.loadAsync(files.find((file) => file.format === 'zip')!.bytes);
    const pages = Object.keys(zip.files).sort();
    expect(pages.length).toBeGreaterThan(1);
    // The header's shading (#E6EFED) is on every page, near the top.
    for (const name of pages) {
      const png = await zip.files[name]!.async('nodebuffer');
      const { data, info } = await sharp(png)
        .extract({ left: 0, top: 0, width: 1240, height: 400 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let shaded = 0;
      for (let i = 0; i < data.length; i += info.channels)
        if (data[i] === 0xe6 && data[i + 1] === 0xef && data[i + 2] === 0xed) shaded += 1;
      expect(shaded, name).toBeGreaterThan(10_000);
    }
  });

  it('sets subscript and superscript characters as scripts, without growing the line', () => {
    const layout = layoutBody('水是 H₂O，面积单位 m²，离子 SO₄²⁻。', options());
    const [line] = layout.sections[0]!;
    expect(kinds(line!)).toEqual([
      '水是 H',
      '[{}_{2}]',
      'O，面积单位 m',
      '[{}^{2}]',
      '，离子 SO',
      '[{}_{4}]',
      '[{}^{2-}]',
      '。',
    ]);
    expect(line!.above + line!.below).toBe(50);
    // Not formulas the text wrote: they are not counted as such.
    expect(layout.formulas).toBe(0);
  });

  it('leaves text with pipes alone unless it is a table', () => {
    const body = '| 只有一行 |\n竖线 a | b 不在行首\n\n| 前 |\n后面不是表格';
    const layout = layoutBody(body, options());
    expect(layout.tables).toBe(0);
    expect(layout.sections[0]!.map(kinds)).toEqual([
      ['| 只有一行 |'],
      ['竖线 a | b 不在行首'],
      [],
      ['| 前 |'],
      ['后面不是表格'],
    ]);
  });

  it('draws every formula of the browser record on a page', async () => {
    const formulas = [...new Set(captured.cases.map((item) => item.latex))];
    const body = formulas
      .map((latex, index) => `${index + 1}. \\(${latex}\\)\n\\[${latex}\\]`)
      .join('\n');
    const files = await renderDeliverable({
      kind: 'document',
      title: '公式',
      style: 'standard',
      body,
    });
    expect(files.find((file) => file.format === 'pdf')!.pages).toBeGreaterThan(1);
    expect(
      files
        .find((file) => file.format === 'png')!
        .bytes.subarray(1, 4)
        .toString(),
    ).toBe('PNG');
  });
});

export type { TypesetFormula };
