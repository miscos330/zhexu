import { parseQuizMathText } from '@/lib/quiz/math-text';
import { DELIVERABLE_PAGE_BREAK } from './contract';
import type { TypesetFormula } from './formula';
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
 * Plain text comes out exactly as before formulas and tables were drawn: the
 * same line breaks and one line height per line. A line only grows when a
 * formula in it needs the room.
 */

export type BodyItem = (
  | { kind: 'text'; text: string }
  | { kind: 'formula'; formula: TypesetFormula }
  /** A table rule (`width` by `height`), and a header row's shading. */
  | { kind: 'rule'; width: number; height: number }
  | { kind: 'shade'; width: number; height: number }
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
}

export interface BodyLayoutOptions {
  /** Width of the text column. */
  width: number;
  /** Line height of plain text. */
  lineHeight: number;
  /** Width of plain text in the body font. */
  measure(text: string): number;
  /** Typeset LaTeX at `scale` times the normal formula size, or null. */
  typeset(latex: string, display: boolean, scale: number): TypesetFormula | null;
}

export interface BodyLayout {
  /** One list of lines per section; a page break starts a new section. */
  sections: BodyLine[][];
  /** Formulas typeset, and formulas printed as source. */
  formulas: number;
  untypeset: number;
  /** Tables drawn. */
  tables: number;
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

/** `%` starts a comment in LaTeX; as upstream does, a bare one in a formula is taken literally. */
function literalPercents(latex: string): string {
  return latex.replace(/(\\*)%/g, (match, slashes: string) =>
    slashes.length % 2 === 1 ? match : `${slashes}\\%`,
  );
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
  let formulas = 0;
  let untypeset = 0;
  let tables = 0;

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
  ): Wrapped[] => {
    const lines: Wrapped[] = [];
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
          const formula = inline.get(char);
          if (!formula) {
            piece += char;
            continue;
          }
          if (piece) sum += measure(piece);
          piece = '';
          sum += formula.width;
        }
        return piece ? sum + measure(piece) : sum;
      };
      for (const wrapped of wrapDeliverableText(run, advance, room)) {
        const items: BodyItem[] = [];
        let x = 0;
        let piece = '';
        let above = metrics.above;
        let below = metrics.below;
        const text = () => {
          if (!piece) return;
          items.push({ kind: 'text', text: piece, x });
          x += measure(piece);
          piece = '';
        };
        for (const char of Array.from(wrapped)) {
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

    for (const segment of parseQuizMathText(row)) {
      if (segment.type === 'text') {
        run += segment.value;
        runHasContent ||= segment.value.length > 0;
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

  /** A table: one line per row, ruled, in columns as wide as their content allows. */
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

    // Each column wants the width of its longest unbroken cell line; columns
    // share the page by that, but a short column keeps all it needs.
    const lineWidth = (text: string) =>
      Math.max(
        0,
        ...paragraph(text, Number.MAX_SAFE_INTEGER / 4, cellMetrics, 'left', false).map(
          (line) => line.width,
        ),
      );
    const natural = Array.from({ length: columns }, (_, column) =>
      Math.max(
        lineHeight,
        ...rows.map((cells) => Math.max(...cells[column]!.split(/<br\s*\/?>/i).map(lineWidth))),
      ),
    );
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
    const total = edges[edges.length - 1]! - edges[0]!;

    return rows.map((cells, rowIndex) => {
      const laidOut = cells.map((cell, column) =>
        cell
          .split(/<br\s*\/?>/i)
          // Lines come back left-aligned; the column's alignment is applied below.
          .flatMap((part) => paragraph(part, widths[column]!, cellMetrics, 'left')),
      );
      // The first lines of a row share one baseline, as in an HTML table: a
      // cell whose first line is less tall starts lower.
      const firstAbove = Math.max(...laidOut.map((lines) => lines[0]?.above ?? 0));
      const offsets = laidOut.map((lines) => firstAbove - (lines[0]?.above ?? 0));
      const heights = laidOut.map(
        (lines, column) =>
          offsets[column]! + lines.reduce((sum, line) => sum + line.above + line.below, 0),
      );
      const height = Math.max(...heights) + 2 * padY;
      const items: BodyItem[] = [];
      // The baseline of a row line is its bottom edge; everything sits above it.
      const top = -height;
      if (header && rowIndex === 0)
        items.push({ kind: 'shade', x: edges[0]!, y: top, width: total, height });
      items.push(
        {
          kind: 'rule',
          x: edges[0]! - rule / 2,
          y: top - rule / 2,
          width: total + rule,
          height: rule,
        },
        { kind: 'rule', x: edges[0]! - rule / 2, y: -rule / 2, width: total + rule, height: rule },
      );
      for (const edge of edges)
        items.push({ kind: 'rule', x: edge - rule / 2, y: top, width: rule, height });
      laidOut.forEach((lines, column) => {
        let y = top + padY + offsets[column]!;
        for (const line of lines) {
          const free = Math.max(0, widths[column]! - line.width);
          const shift =
            align[column] === 'center' ? free / 2 : align[column] === 'right' ? free : 0;
          const left = edges[column]! + padX + shift;
          for (const item of line.items)
            items.push({ ...item, x: left + item.x, y: y + line.above });
          y += line.above + line.below;
        }
      });
      return {
        items,
        above: height + (rowIndex === 0 ? margin : 0),
        below: rowIndex === rows.length - 1 ? margin : 0,
      };
    });
  };

  const sections: BodyLine[][] = [];
  for (const part of body.split(DELIVERABLE_PAGE_BREAK)) {
    const section = part.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!section.trim()) continue;
    const lines: BodyLine[] = [];
    const rows = section.replace(/\r\n?/g, '\n').split('\n');
    for (let index = 0; index < rows.length; index += 1) {
      const found = readTable(rows, index);
      if (found) {
        lines.push(...table(found.table));
        index = found.end - 1;
        continue;
      }
      for (const { items, above, below } of paragraph(rows[index]!, width, plain, 'center'))
        lines.push({ items, above, below });
    }
    sections.push(lines);
  }
  return { sections, formulas, untypeset, tables };
}
