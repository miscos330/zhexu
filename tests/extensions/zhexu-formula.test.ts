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
import { beforeAll, describe, expect, it } from 'vitest';
import {
  layoutBody,
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
  const kinds = (line: BodyLine) =>
    line.items.map((item) => (item.kind === 'text' ? item.text : `[${item.formula.latex}]`));

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
