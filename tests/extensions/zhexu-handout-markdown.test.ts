/**
 * Markdown in handouts (`extensions/zhexu/deliverables/markdown.ts` and its use
 * in `body-layout.ts`): headings, emphasis, lists and thematic breaks are set;
 * text without them, and a course's own text, lays out exactly as before.
 */

import { describe, expect, it } from 'vitest';
import {
  layoutBody,
  type BodyItem,
  type BodyLayoutOptions,
  type BodyLine,
} from '@/extensions/zhexu/deliverables/body-layout';
import { deliverableSourceSchema } from '@/extensions/zhexu/deliverables/contract';
import type { TypesetFormula } from '@/extensions/zhexu/deliverables/formula';
import { inlinePieces } from '@/extensions/zhexu/deliverables/markdown';
import { renderDeliverable } from '@/extensions/zhexu/deliverables/render';
import { wrapDeliverableText } from '@/extensions/zhexu/deliverables/text-layout';

/** One object per formula, so two layouts of the same text compare equal. */
const formulas = new Map<string, TypesetFormula>();
const typeset = (latex: string) => {
  if (!formulas.has(latex))
    formulas.set(latex, {
      latex,
      width: latex.length * 10,
      height: 20,
      depth: 5,
      paint() {},
    } as unknown as TypesetFormula);
  return formulas.get(latex)!;
};

/** Every character 20 wide at the body size; a formula 10 a character of its LaTeX. */
const options = (extra: Partial<BodyLayoutOptions> = {}): BodyLayoutOptions => ({
  width: 1000,
  lineHeight: 50,
  measure: (text, scale = 1) => Array.from(text).length * 20 * scale,
  typeset,
  ...extra,
});

const texts = (line: BodyLine) =>
  line.items.filter((item): item is Extract<BodyItem, { kind: 'text' }> => item.kind === 'text');
const lines = (body: string, extra?: Partial<BodyLayoutOptions>) =>
  layoutBody(body, options(extra)).sections.flat();
/** Each line's text, with ** around bold pieces and * around italic ones. */
const marked = (body: string, extra?: Partial<BodyLayoutOptions>) =>
  lines(body, extra).map((line) =>
    line.items
      .map((item) =>
        item.kind === 'formula'
          ? `[${item.formula.latex}]`
          : item.kind === 'text'
            ? `${item.bold ? '**' : ''}${item.italic ? '*' : ''}${item.text}${item.italic ? '*' : ''}${item.bold ? '**' : ''}`
            : `<${item.kind}>`,
      )
      .join(''),
  );

describe('emphasis in a line', () => {
  const styled = (row: string) =>
    inlinePieces(row).map((piece) =>
      piece.type === 'math'
        ? `[${piece.value}]`
        : `${piece.bold ? 'B' : ''}${piece.italic ? 'I' : ''}:${piece.value}`,
    );

  it('reads bold, italic and both', () => {
    expect(styled('a **b** *c* ***d*** __e__ _f_')).toEqual([
      ':a ',
      'B:b',
      ': ',
      'I:c',
      ': ',
      'BI:d',
      ': ',
      'B:e',
      ': ',
      'I:f',
    ]);
  });

  it('lets a mark next to Chinese open and close beside punctuation', () => {
    expect(styled('**注意：**垂直入射时方向不变')).toEqual(['B:注意：', ':垂直入射时方向不变']);
    expect(styled('这是**“引号”**后')).toEqual([':这是', 'B:“引号”', ':后']);
  });

  it('leaves a _ inside a word, an unmatched mark and an escaped one as text', () => {
    expect(styled('snake_case_name and file_v2_final')).toEqual([
      ':snake_case_name and file_v2_final',
    ]);
    expect(styled('a * b and **open')).toEqual([':a * b and **open']);
    expect(styled('\\*not italic\\* and \\_x\\_')).toEqual([':*not italic* and _x_']);
  });

  it('keeps a code span as written, emphasis marks and backticks included', () => {
    expect(styled('run `a*b*c` now')).toEqual([':run `a*b*c` now']);
  });

  it('keeps a formula a formula, inside bold too', () => {
    expect(styled('**面积 \\(S=ab\\) 公式**')).toEqual(['B:面积 ', '[S=ab]', 'B: 公式']);
    expect(styled('\\(a*b*c\\) and $x_1 + y_1$')).toEqual(['[a*b*c]', ': and ', '[x_1 + y_1]']);
  });
});

describe('Markdown in a handout body', () => {
  it('lays out text without Markdown exactly as the text would be printed as written', () => {
    const body = [
      '光从一种介质斜射入另一种介质时，传播方向发生偏折。'.repeat(3),
      '',
      'a snake_case_name, 2 * 3 = 6, a price of $5 and $6, H₂O',
      '速度 \\(v=\\frac{s}{t}\\)，单位 $\\mathrm{m/s}$。',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '![](missing)',
    ].join('\n');
    expect(layoutBody(body, options())).toEqual(layoutBody(body, options({ markdown: false })));
  });

  it('prints every mark as written when the body is not Markdown', () => {
    const body = '# 标题\n- 一项\n1. 第一\n---\n**粗** *斜*';
    expect(marked(body, { markdown: false })).toEqual(body.split('\n'));
    expect(
      lines(body, { markdown: false }).every((line) => texts(line).every((item) => !item.scale)),
    );
  });

  it('sets headings bold, the upper levels larger, with room above all but the first', () => {
    const laid = lines('## 一、现象\n正文\n### 二、步骤\n#### 小节');
    expect(marked('## 一、现象\n正文\n### 二、步骤\n#### 小节')).toEqual([
      '**一、现象**',
      '正文',
      '**二、步骤**',
      '**小节**',
    ]);
    expect(texts(laid[0]!)[0]!.scale).toBe(1.15);
    expect(texts(laid[2]!)[0]!.scale).toBe(1.06);
    expect(texts(laid[3]!)[0]!.scale).toBeUndefined();
    expect(laid[0]!.above + laid[0]!.below).toBeCloseTo(50 * 1.15);
    expect(laid[2]!.above + laid[2]!.below).toBeCloseTo(50 * 1.06 + 50 * 0.4);
  });

  it('leaves out a heading that only repeats the title, and the blank line after it', () => {
    expect(marked('# 光的折射\n\n正文', { title: '光的折射' })).toEqual(['正文']);
    expect(marked('正文\n# 光的折射', { title: '光的折射' })).toEqual(['正文', '**光的折射**']);
  });

  it('puts list markers before their text and aligns wrapped lines with it', () => {
    const long = '长'.repeat(60);
    const laid = lines(`- 一项\n- ${long}\n  - 嵌套\n1. 第一\n10. 第十`);
    expect(laid.map((line) => texts(line)[0]!.text)).toEqual([
      '•',
      '•',
      '长'.repeat(60 - Array.from(texts(laid[1]!)[1]!.text).length),
      '–',
      '1.',
      '10.',
    ]);
    const [first, second, wrapped, nested] = laid;
    expect(texts(first!)[0]!.x).toBe(0);
    expect(texts(first!)[1]!.x).toBe(45);
    expect(texts(wrapped!)[0]!.x).toBe(texts(second!)[1]!.x);
    expect(texts(nested!)[0]!.x).toBe(50);
    expect(texts(nested!)[1]!.x).toBe(95);
    // A number wider than the marker's room pushes its text along.
    expect(texts(laid[5]!)[1]!.x).toBe(3 * 20 + 15);
  });

  it('continues an item with an indented line, and ends the list at one that is not', () => {
    const laid = lines('- 一项\n  接着说\n\n- 二项\n不缩进');
    expect(laid.map((line) => texts(line).map((item) => [item.text, item.x]))).toEqual([
      [
        ['•', 0],
        ['一项', 45],
      ],
      [['接着说', 45]],
      [],
      [
        ['•', 0],
        ['二项', 45],
      ],
      [['不缩进', 0]],
    ]);
  });

  it('draws a thematic break as a rule across the column', () => {
    const [rule] = lines('---');
    expect(rule!.items).toEqual([expect.objectContaining({ kind: 'rule', x: 0, width: 1000 })]);
    expect(marked('***\n- - -')).toEqual(['<rule>', '<rule>']);
  });

  it('sets emphasis in table cells and list items', () => {
    expect(marked('- **重点** 内容\n| **a** | b |\n| --- | --- |\n| 1 | *2* |')).toEqual([
      '•**重点** 内容',
      '<shade><shade><rule><rule><rule><rule><rule><rule><rule>**a**b',
      '<rule><rule><rule><rule><rule><rule><rule>1*2*',
    ]);
  });
});

describe('line breaks and page breaks around Markdown', () => {
  it('keeps closing punctuation off the start of a line after bold text', () => {
    // Found with a real model: "叫做**光的折射**。" broke before the 。.
    for (let width = 300; width <= 700; width += 20) {
      const laid = lines(
        '光从一种介质斜射入另一种介质时，这种现象叫做**光的折射**。然后继续说下去。',
        {
          width,
        },
      );
      for (const line of laid)
        expect(texts(line)[0]?.text ?? '', `width ${width}`).not.toMatch(/^[。，]/);
    }
  });

  it('moves a blank answer bracket to the next line whole, its spaces included', () => {
    const measure = (text: string) => Array.from(text).length * 10;
    const wrapped = wrapDeliverableText('下列说法正确的是（   ）', measure, 100);
    expect(wrapped).toEqual(['下列说法正确的是', '（   ）']);
  });

  it('keeps a word whole in any script that puts spaces between words', () => {
    const measure = (text: string) => Array.from(text).length * 10;
    // Found in the handwriting sample: "Преломление" broke after "Преломл".
    expect(wrapDeliverableText('Закон: Преломление света', measure, 150)).toEqual([
      'Закон: ',
      'Преломление ',
      'света',
    ]);
    expect(wrapDeliverableText('νόμος διάθλαση', measure, 100)).toEqual(['νόμος ', 'διάθλαση']);
    expect(wrapDeliverableText('قانون الانكسار', measure, 100)).toEqual(['قانون ', 'الانكسار']);
    // Chinese, Japanese and Korean still break between characters.
    expect(wrapDeliverableText('光的 折射规律', measure, 50)).toEqual(['光的 折射', '规律']);
    expect(wrapDeliverableText('빛의 굴절법칙', measure, 50)).toEqual(['빛의 굴절', '법칙']);
  });

  it('starts a page that text ran on to with text, not with the blank lines before it', async () => {
    // 28 lines fill a page of standard text under a one-line title.
    const full = Array.from({ length: 28 }, (_, i) => `第 ${i + 1} 行`).join('\n');
    const [pdf] = await renderDeliverable({
      kind: 'document',
      title: '分页',
      body: `${full}\n${'\n'.repeat(40)}末行`,
      style: 'standard',
    });
    expect(pdf!.pages).toBe(2);
  });
});

describe('the source of a handout', () => {
  const base = { kind: 'document', title: 't', body: 'b' };

  it('takes markdown: false and nothing else for it, and adds nothing when it is absent', () => {
    expect(deliverableSourceSchema.parse({ ...base, markdown: false }).markdown).toBe(false);
    expect(deliverableSourceSchema.safeParse({ ...base, markdown: true }).success).toBe(false);
    // A saved source without it keeps the same JSON, so its hash still matches.
    expect(Object.keys(deliverableSourceSchema.parse(base))).toEqual([
      'kind',
      'title',
      'body',
      'style',
    ]);
  });
});
