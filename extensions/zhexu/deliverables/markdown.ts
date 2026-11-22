import { parseQuizMathText } from '@/lib/quiz/math-text';

/**
 * The Markdown a handout understands, besides its tables and pictures: ATX
 * headings, emphasis, list items and thematic breaks. Everything else (links,
 * block quotes, code) is printed as written.
 *
 * Emphasis follows CommonMark's delimiter rules, with one change for Chinese,
 * Japanese and Korean text, which has no spaces between words: next to one of
 * those characters a delimiter may open or close even when punctuation is on
 * its other side, so `**注意：**这里` is bold as a writer means it. A `_` inside
 * a word (`snake_case_name`) stays a `_`, and a backslash keeps a mark literal.
 */

/** A run of text with its emphasis, or a formula. */
export type InlinePiece =
  | { type: 'text'; value: string; bold: boolean; italic: boolean }
  | { type: 'math'; value: string; displayMode: boolean };

export const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
export const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
export const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;

/** Width of leading white space, a tab counting as four columns. */
export const indentWidth = (value: string) =>
  Array.from(value).reduce((sum, char) => sum + (char === '\t' ? 4 : 1), 0);

/** What a backslash keeps literal: the marks this reader acts on. */
const ESCAPABLE = new Set(['*', '_', '#', '-', '+', '.', '`']);
const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

interface Delimiter {
  char: '*' | '_';
  /** Marks not yet matched; the run's matched marks are taken from its inner side. */
  count: number;
  canOpen: boolean;
  canClose: boolean;
  /** Emphasis this run opens (outermost last) and closes (innermost first), 1 or 2 marks each. */
  opens: number[];
  closes: number[];
  active: boolean;
}

type Token =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; displayMode: boolean }
  | Delimiter;

/** Text, formulas and emphasis delimiters of a line, in order. */
function tokenize(row: string): Token[] {
  const tokens: Token[] = [];
  const text = (value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && 'type' in last && last.type === 'text') last.value += value;
    else tokens.push({ type: 'text', value });
  };
  const segments = parseQuizMathText(row);
  segments.forEach((segment, index) => {
    if (segment.type === 'math') {
      tokens.push({ type: 'math', value: segment.value, displayMode: segment.displayMode });
      return;
    }
    const value = segment.value;
    // A formula next to a delimiter counts as a letter, not as space.
    const before = (i: number) => (i > 0 ? value[i - 1]! : index > 0 ? 'x' : ' ');
    const after = (i: number) =>
      i < value.length ? value[i]! : index < segments.length - 1 ? 'x' : ' ';
    for (let i = 0; i < value.length; ) {
      const char = value[i]!;
      if (char === '\\' && ESCAPABLE.has(value[i + 1] ?? '')) {
        text(value[i + 1]!);
        i += 2;
        continue;
      }
      if (char === '`') {
        // A code span is literal, backticks and all; emphasis does not reach into it.
        let run = 1;
        while (value[i + run] === '`') run += 1;
        const fence = '`'.repeat(run);
        let close = value.indexOf(fence, i + run);
        while (close >= 0 && value[close + run] === '`')
          close = value.indexOf(fence, close + run + 1);
        const end = close >= 0 ? close + run : i + run;
        text(value.slice(i, end));
        i = end;
        continue;
      }
      if (char !== '*' && char !== '_') {
        text(char);
        i += 1;
        continue;
      }
      let run = 1;
      while (value[i + run] === char) run += 1;
      const prev = before(i);
      const next = after(i + run);
      const left =
        !WHITESPACE.test(next) &&
        (!PUNCTUATION.test(next) ||
          WHITESPACE.test(prev) ||
          PUNCTUATION.test(prev) ||
          CJK.test(prev));
      const right =
        !WHITESPACE.test(prev) &&
        (!PUNCTUATION.test(prev) ||
          WHITESPACE.test(next) ||
          PUNCTUATION.test(next) ||
          CJK.test(next));
      tokens.push({
        char,
        count: run,
        canOpen: char === '*' ? left : left && (!right || PUNCTUATION.test(prev)),
        canClose: char === '*' ? right : right && (!left || PUNCTUATION.test(next)),
        opens: [],
        closes: [],
        active: true,
      });
      i += run;
    }
  });
  return tokens;
}

const isDelimiter = (token: Token): token is Delimiter => !('type' in token);

/** The line in pieces of text with their emphasis, and its formulas. */
export function inlinePieces(row: string): InlinePiece[] {
  const tokens = tokenize(row);
  // Each closer takes the nearest opener of its kind; delimiters between them
  // are left as text. Two marks on both sides make bold, otherwise one makes italic.
  tokens.forEach((closer, index) => {
    if (!isDelimiter(closer) || !closer.canClose) return;
    while (closer.count > 0) {
      let at = index - 1;
      for (; at >= 0; at -= 1) {
        const token = tokens[at]!;
        if (
          isDelimiter(token) &&
          token.active &&
          token.canOpen &&
          token.char === closer.char &&
          token.count > 0
        )
          break;
      }
      if (at < 0) break;
      const opener = tokens[at] as Delimiter;
      const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= use;
      closer.count -= use;
      opener.opens.push(use);
      closer.closes.push(use);
      for (let between = at + 1; between < index; between += 1) {
        const token = tokens[between]!;
        if (isDelimiter(token)) token.active = false;
      }
    }
  });

  const pieces: InlinePiece[] = [];
  let bold = 0;
  let italic = 0;
  const emit = (value: string) => {
    if (!value) return;
    const last = pieces[pieces.length - 1];
    const style = { bold: bold > 0, italic: italic > 0 };
    if (last?.type === 'text' && last.bold === style.bold && last.italic === style.italic)
      last.value += value;
    else pieces.push({ type: 'text', value, ...style });
  };
  const apply = (marks: number, by: 1 | -1) => {
    if (marks === 2) bold += by;
    else italic += by;
  };
  for (const token of tokens) {
    if (!isDelimiter(token)) {
      if (token.type === 'math')
        pieces.push({ type: 'math', value: token.value, displayMode: token.displayMode });
      else emit(token.value);
      continue;
    }
    // Marks a run closes are on its left, marks it opens on its right; what
    // it did not match stays text, outside the emphasis on either side.
    for (const marks of token.closes) apply(marks, -1);
    emit(token.char.repeat(token.count));
    for (const marks of [...token.opens].reverse()) apply(marks, 1);
  }
  return pieces;
}
