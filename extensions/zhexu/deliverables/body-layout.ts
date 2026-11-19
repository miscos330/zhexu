import { parseQuizMathText } from '@/lib/quiz/math-text';
import { DELIVERABLE_PAGE_BREAK } from './contract';
import type { TypesetFormula } from './formula';
import { wrapDeliverableText } from './text-layout';

/**
 * Lines of a handout's body, with its formulas typeset.
 *
 * A formula is LaTeX between `\(` and `\)` or `$` and `$` (in the text line)
 * or between `\[` and `\]` or `$$` and `$$` (on a line of its own), the
 * delimiters upstream's quiz view understands; a single `$` pair only counts
 * when what is between looks like a formula, so prices stay text. A formula
 * that cannot be typeset is printed as its LaTeX source.
 *
 * Plain text comes out exactly as before formulas were typeset: the same line
 * breaks and one line height per line. A line only grows when a formula in it
 * needs the room.
 */

export type BodyItem =
  | { kind: 'text'; text: string; x: number }
  | { kind: 'formula'; formula: TypesetFormula; x: number };

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
}

/** Share of a plain line's height above its baseline. */
const ABOVE = 0.7;
/** Room above the baseline of a line of plain text. */
export const plainLineAbove = (lineHeight: number) => lineHeight * ABOVE;
/** Room kept between a formula and the lines around it, as a share of the line height. */
const GAP = 0.12;
/** A formula is not shrunk below this to fit the width; past it, its source is printed. */
const MIN_SCALE = 0.5;

/** `%` starts a comment in LaTeX; as upstream does, a bare one in a formula is taken literally. */
function literalPercents(latex: string): string {
  return latex.replace(/(\\*)%/g, (match, slashes: string) =>
    slashes.length % 2 === 1 ? match : `${slashes}\\%`,
  );
}

/** Characters for formula placeholders while text is wrapped: Supplementary Private Use Area-B. */
const PLACEHOLDER_START = 0x100000;

export function layoutBody(body: string, options: BodyLayoutOptions): BodyLayout {
  const { width, lineHeight, measure } = options;
  const plainAbove = plainLineAbove(lineHeight);
  const plainBelow = lineHeight - plainAbove;
  const gap = lineHeight * GAP;
  let formulas = 0;
  let untypeset = 0;

  /** The formula at full size, or shrunk to fit the column; null to print its source. */
  const fit = (latex: string, display: boolean) => {
    const formula = options.typeset(literalPercents(latex), display, 1);
    if (!formula || formula.width <= width) return formula && { formula, shrunk: false };
    const scale = (width / formula.width) * 0.999;
    if (scale < MIN_SCALE) return null;
    const smaller = options.typeset(literalPercents(latex), display, scale);
    return smaller && smaller.width <= width ? { formula: smaller, shrunk: true } : null;
  };

  const sections: BodyLine[][] = [];
  for (const part of body.split(DELIVERABLE_PAGE_BREAK)) {
    const section = part.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!section.trim()) continue;
    const lines: BodyLine[] = [];

    /** A formula on a line of its own, centred. */
    const block = (formula: TypesetFormula) => {
      lines.push({
        items: [{ kind: 'formula', formula, x: Math.max(0, (width - formula.width) / 2) }],
        above: Math.max(plainAbove, formula.height + gap),
        below: Math.max(plainBelow, formula.depth + gap),
      });
    };

    for (const row of section.replace(/\r\n?/g, '\n').split('\n')) {
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
          let plain = '';
          for (const char of Array.from(text)) {
            const formula = inline.get(char);
            if (!formula) {
              plain += char;
              continue;
            }
            if (plain) sum += measure(plain);
            plain = '';
            sum += formula.width;
          }
          return plain ? sum + measure(plain) : sum;
        };
        for (const wrapped of wrapDeliverableText(run, advance, width)) {
          const items: BodyItem[] = [];
          let x = 0;
          let plain = '';
          let above = plainAbove;
          let below = plainBelow;
          const text = () => {
            if (!plain) return;
            items.push({ kind: 'text', text: plain, x });
            x += measure(plain);
            plain = '';
          };
          for (const char of Array.from(wrapped)) {
            const formula = inline.get(char);
            if (!formula) {
              plain += char;
              continue;
            }
            text();
            items.push({ kind: 'formula', formula, x });
            x += formula.width;
            above = Math.max(above, formula.height + gap);
            below = Math.max(below, formula.depth + gap);
          }
          text();
          lines.push({ items, above, below });
        }
        run = '';
        runHasContent = false;
      };

      const before = lines.length;
      for (const segment of parseQuizMathText(row)) {
        if (segment.type === 'text') {
          run += segment.value;
          runHasContent ||= segment.value.length > 0;
          continue;
        }
        const fitted = fit(segment.value, segment.displayMode);
        if (!fitted) {
          untypeset += 1;
          run += segment.value;
          runHasContent = true;
          continue;
        }
        formulas += 1;
        // A display formula, or one too wide for a line of text, stands alone.
        if (segment.displayMode || fitted.shrunk) {
          flush(false);
          block(fitted.formula);
          continue;
        }
        const mark = placeholder();
        inline.set(mark, fitted.formula);
        run += mark;
        runHasContent = true;
      }
      if (runHasContent) flush(false);
      // An empty row is an empty line, as before.
      else if (lines.length === before) flush(true);
    }
    sections.push(lines);
  }
  return { sections, formulas, untypeset };
}
