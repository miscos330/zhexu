import { parseQuizMathText } from '@/lib/quiz/math-text';
import { DELIVERABLE_PAGE_BREAK } from './contract';
import type { TypesetFormula } from './formula';
import {
  HEADING,
  indentWidth,
  inlinePieces,
  LIST_ITEM,
  THEMATIC_BREAK,
  type InlinePiece,
} from './markdown';
import { wrapDeliverableText } from './text-layout';

/**
 * Lines of a handout's body, with its formulas typeset and its tables drawn.
 *
 * A formula is LaTeX between `\(` and `\)` or `$` and `$` (in the text line)
 * or between `\[` and `\]` or `$$` and `$$` (on a line of its own), the
 * delimiters upstream's quiz view understands; a single `$` pair only counts
 * when what is between looks like a formula, so prices stay text. A formula
 * that cannot be typeset is printed as its LaTeX source.
 *
 * A table is written as a Markdown pipe table: two or more consecutive lines
 * that start and end with `|`. A line of dashes (`| --- | :---: |`) after the
 * first row makes that row a header and sets each column's alignment; `\|` is
 * a `|` inside a cell, `<br>` a line break, and a `|` inside a formula does not
 * end the cell. Each table row is one line of the layout, so a page break falls
 * between rows.
 *
 * A picture is a line that is only `![description](asset id)`: it is drawn
 * centred on lines of its own. A picture the renderer could not read leaves a
 * visible note in its place.
 *
 * Plain text comes out exactly as before formulas and tables were drawn: the
 * same line breaks and one line height per line. A line only grows when a
 * formula in it needs the room.
 */

export type BodyItem = (
  | {
      kind: 'text';
      text: string;
      /** Emphasis, and a heading's size as a multiple of the body size; plain text has none. */
      bold?: true;
      italic?: true;
      scale?: number;
    }
  | { kind: 'formula'; formula: TypesetFormula }
  /** A table rule (`width` by `height`), and a header row's shading. */
  | { kind: 'rule'; width: number; height: number }
  | { kind: 'shade'; width: number; height: number }
  /** A picture, its top-left corner at (x, y), drawn `width` by `height`. */
  | { kind: 'image'; ref: string; width: number; height: number }
) & {
  x: number;
  /** Offset from the line's baseline, downwards; 0 when absent. */
  y?: number;
};

export interface BodyLine {
  items: BodyItem[];
  /** Room above and below the baseline; the line takes `above + below`. */
  above: number;
  below: number;
  /** Drawn first when this line begins a page: a table's header row. */
  repeat?: BodyLine;
}

export interface BodyLayoutOptions {
  /** Width of the text column. */
  width: number;
  /** Line height of plain text. */
  lineHeight: number;
  /** Width of text in the body font, or at `scale` times its size (a heading). */
  measure(text: string, scale?: number): number;
  /** Typeset LaTeX at `scale` times the normal formula size, or null. */
  typeset(latex: string, display: boolean, scale: number): TypesetFormula | null;
  /** Size of a picture that was read and decoded, or null when it could not be. */
  image?(ref: string): { width: number; height: number } | null;
  /** Tallest a picture may be drawn. */
  imageHeight?: number;
  /**
   * False to print the body as it is written; otherwise its Markdown headings,
   * emphasis, lists and thematic breaks are set (see `markdown.ts`).
   */
  markdown?: boolean;
  /** The handout's title: a heading that only repeats it at the top of the body is left out. */
  title?: string;
}

export interface BodyLayout {
  /** One list of lines per section; a page break starts a new section. */
  sections: BodyLine[][];
  /** Formulas typeset, and formulas printed as source. */
  formulas: number;
  untypeset: number;
  /** Tables drawn. */
  tables: number;
  /** Pictures placed, and pictures that could not be. */
  images: number;
  missingImages: number;
}

/** Share of a plain line's height above its baseline. */
const ABOVE = 0.7;
/** Room above the baseline of a line of plain text. */
export const plainLineAbove = (lineHeight: number) => lineHeight * ABOVE;
/** Room kept between a formula and the lines around it, as a share of the line height. */
const GAP = 0.12;
/** A formula is not shrunk below this to fit the width; past it, its source is printed. */
const MIN_SCALE = 0.5;

/** Table measures, as shares of the line height. */
const TABLE = {
  /** Line height of the text in a cell. */
  cellLine: 0.8,
  /** Padding inside a cell, across and down. */
  padX: 0.3,
  padY: 0.18,
  /** Room before and after a table. */
  margin: 0.3,
  /** Thickness of a rule, in pixels. */
  rule: 2,
} as const;

/** Markdown measures, as shares of the line height unless noted. */
const MARKDOWN = {
  /** Size of a heading of each level, as a multiple of the body size. */
  headingScale: [1.27, 1.15, 1.06, 1, 1, 1],
  /** Room above a heading that does not open its section. */
  headingSpace: 0.4,
  /** How far each level of a nested list moves in. */
  listIndent: 1,
  /** Least room for a list marker before the item's text. */
  markerBox: 0.9,
  /** Bullets of a list, by depth, taken in turn; the faces have no ◦ or ▪. */
  bullets: ['•', '–'],
} as const;

/** `%` starts a comment in LaTeX; as upstream does, a bare one in a formula is taken literally. */
function literalPercents(latex: string): string {
  return latex.replace(/(\\*)%/g, (match, slashes: string) =>
    slashes.length % 2 === 1 ? match : `${slashes}\\%`,
  );
}

/** KaTeX sets a formula 1.21 times the text; a script in running text is set at the text's size. */
const KATEX_SCALE = 1.21;

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₌': '=',
  '₍': '(',
  '₎': ')',
};
const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '⁼': '=',
  '⁽': '(',
  '⁾': ')',
  ⁿ: 'n',
};
/** Splits text into runs of script characters (kept by the capture) and the rest. */
const SCRIPT_RUN = new RegExp(
  `([${Object.keys(SUBSCRIPTS).join('')}]+|[${Object.keys(SUPERSCRIPTS).join('')}]+)`,
  'u',
);

/** LaTeX for a run of subscript or superscript characters, or null for other text. */
function scriptLatex(run: string): string | null {
  const chars = Array.from(run);
  if (chars.every((char) => char in SUBSCRIPTS))
    return `{}_{${chars.map((char) => SUBSCRIPTS[char]).join('')}}`;
  if (chars.every((char) => char in SUPERSCRIPTS))
    return `{}^{${chars.map((char) => SUPERSCRIPTS[char]).join('')}}`;
  return null;
}

/** Characters for formula placeholders while text is wrapped: Supplementary Private Use Area-B. */
const PLACEHOLDER_START = 0x100000;

type Align = 'left' | 'center' | 'right';

/** A line and how wide its content is. */
interface Wrapped extends BodyLine {
  width: number;
}

interface Table {
  rows: string[][];
  header: boolean;
  align: Align[];
}

/** A cell of a table: the rows and columns it covers, and its text. */
export interface Block {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  text: string;
}

/**
 * The cells of a table, with joined cells resolved: `<` joins the cell to its
 * left, `^` the cell above (`\<` and `\^` are those characters as text). When
 * a join would not make a rectangle, no cell is joined and the marks print as
 * text.
 */
export function tableBlocks(rows: string[][]): Block[] {
  const literal = (cell: string) => (cell === '\\<' ? '<' : cell === '\\^' ? '^' : cell);
  const single = () =>
    rows.flatMap((cells, r) =>
      cells.map((cell, c) => ({ r0: r, c0: c, r1: r, c1: c, text: literal(cell) })),
    );
  const origin: Array<Array<readonly [number, number]>> = rows.map(() => []);
  rows.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      origin[r]![c] =
        cell === '<' && c > 0
          ? origin[r]![c - 1]!
          : cell === '^' && r > 0 && origin[r - 1]![c]
            ? origin[r - 1]![c]!
            : [r, c];
    }),
  );
  const groups = new Map<readonly [number, number], Array<[number, number]>>();
  origin.forEach((cells, r) =>
    cells.forEach((key, c) => groups.set(key, [...(groups.get(key) ?? []), [r, c]])),
  );
  const blocks: Block[] = [];
  for (const [[r0, c0], slots] of groups) {
    const r1 = Math.max(...slots.map(([r]) => r));
    const c1 = Math.max(...slots.map(([, c]) => c));
    const rectangle =
      slots.length === (r1 - r0 + 1) * (c1 - c0 + 1) && slots.every(([r, c]) => r >= r0 && c >= c0);
    if (!rectangle) return single();
    blocks.push({ r0, c0, r1, c1, text: literal(rows[r0]![c0]!) });
  }
  return blocks.sort((a, b) => a.r0 - b.r0 || a.c0 - b.c0);
}

/**
 * A picture: a line that is only `![description](reference)`. The reference
 * is a course asset id; the renderer reads it, and nothing remote.
 */
export const IMAGE_ROW = /^\s*!\[([^\]\n]*)\]\(\s*([^()\s]+)\s*\)\s*$/;

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const DIVIDER_CELL = /^\s*(:?)-{3,}(:?)\s*$/;

/**
 * The cells of a table row: split at each `|` that is not escaped and not in
 * a formula, outer pipes dropped, `\|` read as `|` outside formulas.
 */
export function tableCells(row: string): string[] {
  const text = row.trim();
  const cells: string[] = [];
  let cell = '';
  let math: '' | '$' | '$$' | '\\(' | '\\[' = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const two = text.slice(i, i + 2);
    if (char === '\\' && i + 1 < text.length) {
      if (!math && text[i + 1] === '|') {
        cell += '|';
        i += 1;
        continue;
      }
      if (!math && (two === '\\(' || two === '\\[')) math = two;
      else if ((math === '\\(' && two === '\\)') || (math === '\\[' && two === '\\]')) math = '';
      cell += two;
      i += 1;
      continue;
    }
    if (char === '$') {
      const mark = two === '$$' ? '$$' : '$';
      if (!math) math = mark;
      else if (math === mark) math = '';
      cell += mark;
      i += mark.length - 1;
      continue;
    }
    if (char === '|' && !math) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  // The outer pipes leave an empty first and last piece.
  if (text.startsWith('|')) cells.shift();
  if (text.endsWith('|') && !text.endsWith('\\|')) cells.pop();
  return cells.map((value) => value.trim());
}

/** The table starting at `rows[start]`, and the row after it; null when none starts there. */
function readTable(rows: string[], start: number): { table: Table; end: number } | null {
  let end = start;
  while (end < rows.length && TABLE_ROW.test(rows[end]!)) end += 1;
  if (end - start < 2) return null;
  const parsed = rows.slice(start, end).map(tableCells);
  const isDivider = (cells: string[]) =>
    cells.length > 0 && cells.every((cell) => DIVIDER_CELL.test(cell));
  const header = parsed.length > 2 && isDivider(parsed[1]!) && !isDivider(parsed[0]!);
  const align: Align[] = header
    ? parsed[1]!.map((cell) => {
        const [, left, right] = DIVIDER_CELL.exec(cell)!;
        return left && right ? 'center' : right ? 'right' : 'left';
      })
    : [];
  const body = parsed.filter((cells) => !isDivider(cells));
  if (body.length === 0) return null;
  const columns = Math.max(...body.map((cells) => cells.length));
  return {
    table: {
      rows: body.map((cells) => [...cells, ...Array<string>(columns - cells.length).fill('')]),
      header,
      align: Array.from({ length: columns }, (_, index) => align[index] ?? 'left'),
    },
    end,
  };
}

export function layoutBody(body: string, options: BodyLayoutOptions): BodyLayout {
  const { width, lineHeight, measure } = options;
  const plainAbove = plainLineAbove(lineHeight);
  const plain = { above: plainAbove, below: lineHeight - plainAbove };
  const gap = lineHeight * GAP;
  const markdown = options.markdown !== false;
  let formulas = 0;
  let untypeset = 0;
  let tables = 0;
  let images = 0;
  let missingImages = 0;

  /** The formula at full size, or shrunk to fit `room`; null to print its source. */
  const fit = (latex: string, display: boolean, room: number) => {
    const formula = options.typeset(literalPercents(latex), display, 1);
    if (!formula || formula.width <= room) return formula && { formula, shrunk: false };
    const scale = (room / formula.width) * 0.999;
    if (scale < MIN_SCALE) return null;
    const smaller = options.typeset(literalPercents(latex), display, scale);
    return smaller && smaller.width <= room ? { formula: smaller, shrunk: true } : null;
  };

  /**
   * One row of text wrapped to `room`: its inline formulas in the lines, a
   * display formula (or one too wide for a line) on a line of its own, placed
   * by `blockAlign`. An empty row is one empty line.
   */
  const paragraph = (
    row: string,
    room: number,
    metrics: { above: number; below: number },
    blockAlign: Align,
    /** False when only measuring: the formula counts are left alone. */
    tally = true,
    /** For a heading: its size as a multiple of the body size. A heading is bold. */
    headingScale?: number,
  ): Wrapped[] => {
    const lines: Wrapped[] = [];
    const scale = headingScale ?? 1;
    const measureText = scale === 1 ? measure : (text: string) => options.measure(text, scale);
    // Emphasis changes are marked in the run by characters of their own, which
    // take no width; the style they set carries on across wrapped lines.
    const styles = new Map<string, { bold: boolean; italic: boolean }>();
    let style = { bold: false, italic: false };
    let runStyle = style;
    const styled = () => ({
      ...(style.bold || headingScale !== undefined ? { bold: true as const } : {}),
      ...(style.italic ? { italic: true as const } : {}),
      ...(scale !== 1 ? { scale } : {}),
    });
    // Text and inline formulas collect into a run, wrapped when a display
    // formula or the end of the row closes it.
    let run = '';
    let runHasContent = false;
    const inline = new Map<string, TypesetFormula>();
    const used = new Set(Array.from(row));
    let next = PLACEHOLDER_START;
    const placeholder = () => {
      let mark = String.fromCodePoint(next++);
      while (used.has(mark)) mark = String.fromCodePoint(next++);
      return mark;
    };

    const flush = (always: boolean) => {
      if (!runHasContent && !always) return;
      const advance = (text: string) => {
        let sum = 0;
        let piece = '';
        for (const char of Array.from(text)) {
          if (styles.has(char)) continue;
          const formula = inline.get(char);
          if (!formula) {
            piece += char;
            continue;
          }
          if (piece) sum += measureText(piece);
          piece = '';
          sum += formula.width;
        }
        return piece ? sum + measureText(piece) : sum;
      };
      for (const wrapped of wrapDeliverableText(run, advance, room)) {
        const items: BodyItem[] = [];
        let x = 0;
        let piece = '';
        let above = metrics.above;
        let below = metrics.below;
        const text = () => {
          if (!piece) return;
          items.push({ kind: 'text', text: piece, x, ...styled() });
          x += measureText(piece);
          piece = '';
        };
        for (const char of Array.from(wrapped)) {
          const change = styles.get(char);
          if (change) {
            text();
            style = change;
            continue;
          }
          const formula = inline.get(char);
          if (!formula) {
            piece += char;
            continue;
          }
          text();
          items.push({ kind: 'formula', formula, x });
          x += formula.width;
          above = Math.max(above, formula.height + gap);
          below = Math.max(below, formula.depth + gap);
        }
        text();
        lines.push({ items, above, below, width: x });
      }
      run = '';
      runHasContent = false;
    };

    const pieces: InlinePiece[] = markdown
      ? inlinePieces(row)
      : parseQuizMathText(row).map((segment) =>
          segment.type === 'text'
            ? { type: 'text', value: segment.value, bold: false, italic: false }
            : { type: 'math', value: segment.value, displayMode: segment.displayMode },
        );
    for (const segment of pieces) {
      if (segment.type === 'text') {
        if (segment.bold !== runStyle.bold || segment.italic !== runStyle.italic) {
          const mark = placeholder();
          runStyle = { bold: segment.bold, italic: segment.italic };
          styles.set(mark, runStyle);
          run += mark;
        }
        // Subscript and superscript characters (H₂O, x²) are in none of the
        // text fonts: each run of them is set as a KaTeX script instead.
        for (const piece of segment.value.split(SCRIPT_RUN)) {
          if (!piece) continue;
          const script = scriptLatex(piece);
          const formula = script && options.typeset(script, false, 1 / KATEX_SCALE);
          if (formula) {
            const mark = placeholder();
            inline.set(mark, formula);
            run += mark;
          } else run += piece;
          runHasContent = true;
        }
        continue;
      }
      const fitted = fit(segment.value, segment.displayMode, room);
      if (!fitted) {
        if (tally) untypeset += 1;
        run += segment.value;
        runHasContent = true;
        continue;
      }
      if (tally) formulas += 1;
      // A display formula, or one too wide for a line of text, stands alone.
      if (segment.displayMode || fitted.shrunk) {
        flush(false);
        const { formula } = fitted;
        const free = Math.max(0, room - formula.width);
        lines.push({
          items: [
            {
              kind: 'formula',
              formula,
              x: blockAlign === 'center' ? free / 2 : blockAlign === 'right' ? free : 0,
            },
          ],
          above: Math.max(metrics.above, formula.height + gap),
          below: Math.max(metrics.below, formula.depth + gap),
          width: formula.width,
        });
        continue;
      }
      const mark = placeholder();
      inline.set(mark, fitted.formula);
      run += mark;
      runHasContent = true;
    }
    if (runHasContent) flush(false);
    // An empty row is an empty line, as before.
    else if (lines.length === 0) flush(true);
    return lines;
  };

  /**
   * A table, ruled, in columns as wide as their content allows. A cell that is
   * only `<` joins the cell to its left, one that is only `^` the cell above;
   * a joined cell is one box across its columns and rows. Rows tied together
   * by a joined cell are one line of the layout, so they stay on one page; a
   * header row is drawn again at the top of each later page the table runs on.
   */
  const table = ({ rows, header, align }: Table): BodyLine[] => {
    tables += 1;
    const padX = lineHeight * TABLE.padX;
    const padY = lineHeight * TABLE.padY;
    const cellLine = Math.round(lineHeight * TABLE.cellLine);
    const cellAbove = plainLineAbove(cellLine);
    const cellMetrics = { above: cellAbove, below: cellLine - cellAbove };
    const rule = TABLE.rule;
    const margin = lineHeight * TABLE.margin;
    const columns = align.length;

    const blocks = tableBlocks(rows);
    const lineWidth = (text: string) =>
      Math.max(
        0,
        ...paragraph(text, Number.MAX_SAFE_INTEGER / 4, cellMetrics, 'left', false).map(
          (line) => line.width,
        ),
      );
    const textWidth = (text: string) => Math.max(...text.split(/<br\s*\/?>/i).map(lineWidth));

    // Each column wants the width of its longest unbroken cell line; a joined
    // cell wider than its columns widens them evenly. Columns share the page
    // by that, but a short column keeps all it needs.
    const natural = Array.from({ length: columns }, () => lineHeight);
    for (const block of blocks)
      if (block.c0 === block.c1)
        natural[block.c0] = Math.max(natural[block.c0]!, textWidth(block.text));
    for (const block of blocks) {
      if (block.c0 === block.c1) continue;
      const span = block.c1 - block.c0 + 1;
      const have =
        natural.slice(block.c0, block.c1 + 1).reduce((sum, value) => sum + value, 0) +
        (span - 1) * 2 * padX;
      const extra = textWidth(block.text) - have;
      if (extra > 0) for (let c = block.c0; c <= block.c1; c += 1) natural[c]! += extra / span;
    }
    const room = width - columns * 2 * padX - rule;
    let widths = natural;
    if (natural.reduce((sum, value) => sum + value, 0) > room) {
      const fixed = new Set<number>();
      for (;;) {
        const left = room - [...fixed].reduce((sum, index) => sum + natural[index]!, 0);
        const open = natural.map((_, index) => index).filter((index) => !fixed.has(index));
        const share = left / open.length;
        const fits = open.filter((index) => natural[index]! <= share);
        if (fits.length === 0 || fits.length === open.length) break;
        for (const index of fits) fixed.add(index);
      }
      const left = room - [...fixed].reduce((sum, index) => sum + natural[index]!, 0);
      const openTotal = natural.reduce(
        (sum, value, index) => (fixed.has(index) ? sum : sum + value),
        0,
      );
      widths = natural.map((value, index) =>
        fixed.has(index) ? value : Math.max(lineHeight, (left * value) / openTotal),
      );
    }
    const edges = [rule / 2];
    for (const value of widths) edges.push(edges[edges.length - 1]! + value + 2 * padX);

    // A cell's lines, left-aligned at the width of its columns.
    const laidOut = new Map(
      blocks.map((block) => {
        const room = edges[block.c1 + 1]! - edges[block.c0]! - 2 * padX;
        const lines = block.text
          .split(/<br\s*\/?>/i)
          .flatMap((part) => paragraph(part, room, cellMetrics, 'left'));
        return [block, { lines, room }] as const;
      }),
    );
    const contentHeight = (block: Block) =>
      laidOut.get(block)!.lines.reduce((sum, line) => sum + line.above + line.below, 0);

    // The first lines of a row's one-row cells share one baseline, as in an
    // HTML table: a cell whose first line is less tall starts lower.
    const offsets = new Map<Block, number>();
    const heights = rows.map((_, row) => {
      const single = blocks.filter((block) => block.r0 === row && block.r1 === row);
      const firstAbove = Math.max(
        0,
        ...single.map((block) => laidOut.get(block)!.lines[0]?.above ?? 0),
      );
      let height = cellLine + 2 * padY;
      for (const block of single) {
        const offset = firstAbove - (laidOut.get(block)!.lines[0]?.above ?? 0);
        offsets.set(block, offset);
        height = Math.max(height, offset + contentHeight(block) + 2 * padY);
      }
      return height;
    });
    // A cell across rows that needs more room than they have makes its last row taller.
    for (const block of [...blocks].sort((a, b) => a.r1 - a.r0 - (b.r1 - b.r0))) {
      if (block.r0 === block.r1) continue;
      const have = heights.slice(block.r0, block.r1 + 1).reduce((sum, value) => sum + value, 0);
      const need = contentHeight(block) + 2 * padY;
      if (need > have) heights[block.r1]! += need - have;
    }

    // Rows tied by a cell across rows form one band, one line of the layout.
    const bands: Array<[first: number, last: number]> = [];
    for (let row = 0; row < rows.length; ) {
      let last = row;
      for (let r = row; r <= last; r += 1)
        for (const block of blocks) if (block.r0 <= r && block.r1 > last) last = block.r1;
      bands.push([row, last]);
      row = last + 1;
    }

    const lines = bands.map(([first, last]) => {
      const tops: number[] = [];
      let height = 0;
      for (let row = first; row <= last; row += 1) {
        tops[row] = height;
        height += heights[row]!;
      }
      const items: BodyItem[] = [];
      // The baseline of a band's line is its bottom edge; everything sits above it.
      const top = -height;
      const inBand = blocks.filter((block) => block.r0 >= first && block.r0 <= last);
      const box = (block: Block) => {
        const x = edges[block.c0]!;
        const y = top + tops[block.r0]!;
        let h = 0;
        for (let row = block.r0; row <= block.r1; row += 1) h += heights[row]!;
        return { x, y, width: edges[block.c1 + 1]! - x, height: h };
      };
      // The header is the first row and any row a header cell reaches down into.
      if (header && first === 0)
        for (const block of inBand) items.push({ kind: 'shade', ...box(block) });
      // Each cell is outlined; an edge two cells share is drawn once.
      const drawn = new Set<string>();
      const ruleItem = (x: number, y: number, w: number, h: number) => {
        const key = [x, y, w, h].map((value) => value.toFixed(2)).join(',');
        if (drawn.has(key)) return;
        drawn.add(key);
        items.push({ kind: 'rule', x, y, width: w, height: h });
      };
      for (const block of inBand) {
        const { x, y, width: w, height: h } = box(block);
        ruleItem(x - rule / 2, y - rule / 2, w + rule, rule);
        ruleItem(x - rule / 2, y + h - rule / 2, w + rule, rule);
        ruleItem(x - rule / 2, y, rule, h);
        ruleItem(x + w - rule / 2, y, rule, h);
      }
      for (const block of inBand) {
        const { x, y: cellTop } = box(block);
        const { lines: cellLines, room: cellRoom } = laidOut.get(block)!;
        let y = cellTop + padY + (offsets.get(block) ?? 0);
        for (const line of cellLines) {
          const free = Math.max(0, cellRoom - line.width);
          const column = align[block.c0];
          const shift = column === 'center' ? free / 2 : column === 'right' ? free : 0;
          for (const item of line.items)
            items.push({ ...item, x: x + padX + shift + item.x, y: y + line.above });
          y += line.above + line.below;
        }
      }
      return { items, above: height, below: 0 } as BodyLine;
    });

    lines[0]!.above += margin;
    lines[lines.length - 1]!.below += margin;
    // The header rows are drawn again at the top of each later page.
    if (header) {
      const repeat: BodyLine = {
        items: lines[0]!.items,
        above: lines[0]!.above - margin,
        below: 0,
      };
      for (const line of lines.slice(1)) line.repeat = repeat;
    }
    return lines;
  };

  /**
   * A picture on lines of its own, centred, as large as its pixels allow up
   * to the column width and `imageHeight` (never more than twice its size).
   * One that could not be read or decoded leaves a visible note instead, in
   * the language of the text.
   */
  const image = (description: string, ref: string): BodyLine[] => {
    const size = options.image?.(ref);
    if (!size || !(size.width > 0) || !(size.height > 0)) {
      missingImages += 1;
      const han = /\p{Script=Han}/u.test(body);
      const note = han
        ? `［图片未放入${description ? `：${description}` : ''}］`
        : `[Picture not included${description ? `: ${description}` : ''}]`;
      return paragraph(note, width, plain, 'center').map(({ items, above, below }) => ({
        items,
        above,
        below,
      }));
    }
    images += 1;
    const scale = Math.min(
      width / size.width,
      (options.imageHeight ?? Number.POSITIVE_INFINITY) / size.height,
      2,
    );
    const drawn = { width: size.width * scale, height: size.height * scale };
    const margin = lineHeight * TABLE.margin;
    return [
      {
        items: [
          {
            kind: 'image',
            ref,
            x: (width - drawn.width) / 2,
            y: -drawn.height,
            width: drawn.width,
            height: drawn.height,
          },
        ],
        // The baseline of a picture's line is its bottom edge.
        above: drawn.height + margin,
        below: margin,
      },
    ];
  };

  /** Lines of text moved `indent` to the right. */
  const indented = (wrapped: Wrapped[], indent: number): BodyLine[] =>
    wrapped.map(({ items, above, below }) => ({
      items: items.map((item) => ({ ...item, x: item.x + indent })),
      above,
      below,
    }));

  /** A heading: bold, larger for the upper levels, with room above it unless it opens the section. */
  const heading = (level: number, text: string, first: boolean): BodyLine[] => {
    const scale = MARKDOWN.headingScale[level - 1] ?? 1;
    const pitch = lineHeight * scale;
    const metrics = { above: plainLineAbove(pitch), below: pitch - plainLineAbove(pitch) };
    const lines = indented(paragraph(text, width, metrics, 'left', true, scale), 0);
    if (!first && lines[0]) lines[0].above += lineHeight * MARKDOWN.headingSpace;
    return lines;
  };

  /** A thematic break: a rule across the column, in the middle of a line. */
  const thematicBreak = (): BodyLine => ({
    items: [
      {
        kind: 'rule',
        x: 0,
        y: lineHeight / 2 - plain.above - TABLE.rule / 2,
        width,
        height: TABLE.rule,
      },
    ],
    ...plain,
  });

  /**
   * A list item: its marker (a bullet, or the number as written) at the item's
   * depth, its text beside it, and wrapped lines aligned with the text.
   */
  const listItem = (depth: number, marker: string, text: string) => {
    const indent = depth * lineHeight * MARKDOWN.listIndent;
    const glyph = /^\d/.test(marker) ? marker : MARKDOWN.bullets[depth % MARKDOWN.bullets.length]!;
    const box = Math.max(lineHeight * MARKDOWN.markerBox, measure(glyph) + lineHeight * 0.3);
    const lines = indented(paragraph(text, width - indent - box, plain, 'left'), indent + box);
    lines[0]?.items.unshift({ kind: 'text', text: glyph, x: indent });
    return { lines, content: indent + box };
  };

  const sections: BodyLine[][] = [];
  let leading = true;
  for (const part of body.split(DELIVERABLE_PAGE_BREAK)) {
    const section = part.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!section.trim()) continue;
    const lines: BodyLine[] = [];
    const rows = section.replace(/\r\n?/g, '\n').split('\n');
    // Open list items: their indent as written, and where their text starts.
    const open: Array<{ indent: number; content: number }> = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const picture = IMAGE_ROW.exec(row);
      if (picture) {
        lines.push(...image(picture[1]!, picture[2]!));
        open.length = 0;
        leading = false;
        continue;
      }
      const found = readTable(rows, index);
      if (found) {
        lines.push(...table(found.table));
        index = found.end - 1;
        open.length = 0;
        leading = false;
        continue;
      }
      if (markdown) {
        const title = HEADING.exec(row);
        // A heading that repeats the title above it, as an exported answer's first line does.
        if (leading && title && title[2]!.trim() === options.title?.trim()) {
          leading = false;
          while (index + 1 < rows.length && !rows[index + 1]!.trim()) index += 1;
          continue;
        }
        if (row.trim()) leading = false;
        if (THEMATIC_BREAK.test(row)) {
          lines.push(thematicBreak());
          open.length = 0;
          continue;
        }
        if (title) {
          lines.push(...heading(title[1]!.length, title[2]!, lines.length === 0));
          open.length = 0;
          continue;
        }
        const item = LIST_ITEM.exec(row);
        if (item) {
          const indent = indentWidth(item[1]!);
          while (open.length && open[open.length - 1]!.indent >= indent) open.pop();
          const laid = listItem(open.length, item[2]!, item[3]!);
          open.push({ indent, content: laid.content });
          lines.push(...laid.lines);
          continue;
        }
        // An indented line under a list item goes on with that item's text; a
        // line that is not indented ends the list. A blank line keeps it open.
        const indent = indentWidth(/^[ \t]*/.exec(row)![0]);
        const parent = [...open].reverse().find((entry) => entry.indent < indent);
        if (row.trim() && parent) {
          lines.push(
            ...indented(
              paragraph(row.trim(), width - parent.content, plain, 'left'),
              parent.content,
            ),
          );
          continue;
        }
        if (row.trim()) open.length = 0;
      }
      for (const { items, above, below } of paragraph(row, width, plain, 'center'))
        lines.push({ items, above, below });
    }
    sections.push(lines);
  }
  return { sections, formulas, untypeset, tables, images, missingImages };
}
