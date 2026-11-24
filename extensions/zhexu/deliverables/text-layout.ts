const closing = /^[，。！？；：、）】》」』〕〉,.!?;:%…]/u;
const opening = /[（【《「『〔〈(\[]$/u;
/**
 * A letter or digit of a script that puts spaces between words, such as Latin,
 * Cyrillic, Greek or Arabic. Chinese, Japanese, Korean and Thai text breaks
 * between characters instead.
 */
const wordChar =
  /(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}])[\p{L}\p{N}\p{M}]/u;
const startsWord = new RegExp(`^${wordChar.source}`, 'u');
const endsWord = new RegExp(`${wordChar.source}$`, 'u');

/**
 * Break text into lines no wider than `maxWidth`. Paragraph breaks are kept and
 * no character is dropped. A line never starts with closing punctuation or ends
 * with an opening bracket (spaces after it included, as in a blank `（　）`), and
 * a word of a script that spaces its words (Latin, Cyrillic, Greek, Arabic) is
 * moved to the next line whole when it fits there.
 *
 * `invisible` marks characters that take no room and are not text, such as the
 * marks of an emphasis change: these rules look through them.
 */
export function wrapDeliverableText(
  text: string,
  measure: (text: string) => number,
  maxWidth: number,
  invisible?: (char: string) => boolean,
): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) throw Error('deliverable_layout_width');
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const seen = (value: string) =>
    invisible
      ? Array.from(value)
          .filter((char) => !invisible(char))
          .join('')
      : value;
  const out: string[] = [];
  for (const row of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const { segment } of segmenter.segment(row)) {
      if (line && measure(line + segment) > maxWidth) {
        let carry = segment;
        const split = line.lastIndexOf(' ');
        if (startsWord.test(segment) && endsWord.test(seen(line)) && split > line.length / 3) {
          carry = line.slice(split + 1) + carry;
          line = line.slice(0, split + 1);
        }
        while (
          line &&
          (opening.test(seen(line).trimEnd()) ||
            (closing.test(seen(carry)) && Array.from(seen(line)).length > 1))
        ) {
          const chars = Array.from(segmenter.segment(line), (value) => value.segment);
          carry = chars.pop()! + carry;
          line = chars.join('');
        }
        if (line) out.push(line);
        line = carry;
      } else line += segment;
    }
    out.push(line);
  }
  return out;
}

/** A neutral heading for text that brings none, in the script the text is written in. */
export function defaultDeliverableTitle(text: string): string {
  if (/\p{Script=Hangul}/u.test(text)) return '본문';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return '本文';
  if (/\p{Script=Arabic}/u.test(text)) return 'مستند';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'Документ';
  if (/\p{Script=Han}/u.test(text)) return '正文';
  return 'Document';
}

/**
 * The title for an exported answer: its Markdown heading, or a short first line
 * that is not a sentence. A paragraph is content, not a title to cut off halfway.
 */
export function deriveDeliverableTitle(body: string): string {
  const first =
    body
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? '';
  const heading = first.match(/^#{1,6}\s+(.+)$/)?.[1];
  if (heading && Array.from(heading).length <= 160) return heading;
  if (body.includes('\n') && first.length <= 70 && !/[。！？.!?]$/.test(first)) return first;
  return defaultDeliverableTitle(body);
}
