/**
 * Turns a saved course into the text of a handout.
 *
 * Nothing here calls a model or adds a word: the text on the pages, the
 * narration and the quiz questions are taken from the course as it was saved,
 * in page order. The shapes below name only the fields that are read, so a
 * course written by a newer format still gives what it has of them.
 *
 * The answers start on a new page, so a page of questions can be handed out
 * without them. The only words that are not the course's own are the labels
 * ("Notes", "Answers") and, on a worksheet, a line for the student's name.
 *
 * Formulas keep their LaTeX and are marked for the renderer, which typesets
 * them: a formula element of a slide stands on a line of its own (`\[ \]`), a
 * formula inside slide text stays in its line (`\( \)`), and quiz text is
 * marked where upstream's quiz view shows a formula.
 */

import { isConcreteMediaAddress } from '@openmaic/dsl';
import { renderQuizMathText } from '@/lib/quiz/math-text';
import { DELIVERABLE_PAGE_BREAK } from './contract';

export type CourseHandoutContent = 'full' | 'slides' | 'questions';

export interface CourseForHandout {
  name: string;
  description?: string;
  scenes: readonly unknown[];
}

export interface CourseHandoutText {
  title: string;
  body: string;
  /** Pages of the course that went into the text. */
  scenes: number;
  /** Quiz questions that went into the text. */
  questions: number;
}

interface Labels {
  notes: string;
  exercises: string;
  answers: string;
  worksheet: string;
  nameLine: string;
  untitled: string;
  analysis: string;
  goal: string;
  separator: string;
}

const ZH: Labels = {
  notes: '讲解',
  exercises: '练习',
  answers: '答案与解析',
  worksheet: '练习',
  nameLine: '姓名：________　班级：________　日期：________',
  untitled: '未命名',
  analysis: '解析',
  goal: '学习目标',
  separator: '：',
};
const EN: Labels = {
  notes: 'Notes',
  exercises: 'Exercises',
  answers: 'Answers',
  worksheet: 'Worksheet',
  nameLine: 'Name: ________   Class: ________   Date: ________',
  untitled: 'Untitled',
  analysis: 'Explanation',
  goal: 'Learning objective',
  separator: ': ',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * The text of a rich-text fragment, one line per block; markup is dropped. An
 * inline formula (stored by upstream as `<span data-inline-math="LATEX">`)
 * becomes `\(LATEX\)`.
 */
export function htmlToText(html: string): string {
  return html
    .replace(
      /<span\b[^>]*?\sdata-inline-math\s*=\s*(["'])([\s\S]*?)\1[^>]*>[\s\S]*?<\/span\s*>/gi,
      (_whole, _quote: string, latex: string) => `\\(${latex}\\)`,
    )
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
      const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * A slide's table as a Markdown pipe table, which the renderer draws ruled; the
 * first row is the header when the table's theme says so. A pipe table cannot
 * merge cells, so a table with merged cells stays rows of text separated by
 * ` | `, as before.
 */
function tableText(element: Record<string, unknown>): string {
  const rows = list(element.data).map((row) => list(row).filter(isRecord));
  const merged = rows.some((row) =>
    row.some((cell) => Number(cell.colspan ?? 1) > 1 || Number(cell.rowspan ?? 1) > 1),
  );
  const cellText = (cell: Record<string, unknown>) => htmlToText(text(cell.text));
  if (merged)
    return rows
      .map((row) => row.map(cellText).join(' | '))
      .filter((row) => row.replace(/[| ]/g, ''))
      .join('\n');
  const filled = rows
    .map((row) => row.map(cellText))
    .filter((cells) => cells.some((cell) => cell.trim()));
  if (filled.length === 0) return '';
  const columns = Math.max(...filled.map((cells) => cells.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: columns }, (_, index) =>
      (cells[index] ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>'),
    ).join(' | ')} |`;
  const lines = filled.map(line);
  const theme = isRecord(element.theme) ? element.theme : {};
  // A pipe table needs two rows; a single row is a header only with a body under it.
  if (theme.rowHeader === true && lines.length > 1)
    lines.splice(1, 0, `| ${Array<string>(columns).fill('---').join(' | ')} |`);
  return lines.length > 1 ? lines.join('\n') : filled[0]!.join(' | ');
}

/**
 * A slide picture as a picture line for the renderer: `![](asset id)`, which it
 * reads from the owner's asset pool. A background is left out. A picture held
 * as a URL or a data URL is not read (nothing remote is fetched, and a data URL
 * would not fit the handout's text), so it becomes `![](-)`, which the renderer
 * marks as a picture that was not included.
 */
function pictureLine(element: Record<string, unknown>): string {
  if (element.imageType === 'background') return '';
  const src = text(element.src).trim();
  if (!src) return '';
  return isConcreteMediaAddress(src) || /[\s()[\]]/.test(src) ? '![](-)' : `![](${src})`;
}

/** What is written on a slide, top to bottom and left to right. */
function slideText(content: Record<string, unknown>): string {
  const canvas = isRecord(content.canvas) ? content.canvas : {};
  const placed = list(canvas.elements)
    .filter(isRecord)
    .map((element) => {
      let value = '';
      if (element.type === 'text') value = htmlToText(text(element.content));
      else if (element.type === 'image') value = pictureLine(element);
      else if (element.type === 'shape' && isRecord(element.text))
        value = htmlToText(text(element.text.content));
      else if (element.type === 'latex') {
        const latex = text(element.latex).trim();
        value = latex && `\\[${latex}\\]`;
      } else if (element.type === 'table') value = tableText(element);
      return {
        value,
        top: typeof element.top === 'number' ? element.top : 0,
        left: typeof element.left === 'number' ? element.left : 0,
      };
    })
    .filter((item) => item.value);
  placed.sort((a, b) => a.top - b.top || a.left - b.left);
  return placed.map((item) => item.value).join('\n');
}

/** `label: value`, or just the value when there is no label. */
const labelled = (label: string, value: string, labels: Labels) =>
  label ? `${label}${labels.separator}${value}` : value;

/**
 * What an interactive page explains, from its widget's own fields: the concept
 * of a simulation or the task of a procedure, the description, the steps of a
 * procedure and the nodes of a diagram. The page's HTML is a program, not text
 * to print, so a page without widget fields gives only its title.
 */
function interactiveText(content: Record<string, unknown>, labels: Labels): string {
  const widget = isRecord(content.widgetConfig) ? content.widgetConfig : {};
  const out: string[] = [];
  for (const key of ['concept', 'task', 'description']) {
    const value = text(widget[key]).trim();
    if (value && !out.includes(value)) out.push(value);
  }
  list(widget.steps)
    .filter(isRecord)
    .forEach((step, index) => {
      const title = text(step.title).trim();
      const detail = text(step.description).trim();
      if (title || detail)
        out.push(
          `${index + 1}. ${title && detail ? labelled(title, detail, labels) : title || detail}`,
        );
    });
  for (const node of list(widget.nodes).filter(isRecord)) {
    const label = text(node.label).trim();
    const details = text(node.details).trim();
    if (label) out.push(`· ${details ? labelled(label, details, labels) : label}`);
  }
  return out.join('\n');
}

/**
 * What a project page sets out: its description, learning objective and
 * milestones with their tasks. Only the project as designed is read (v2,
 * stored in the page); a v3 project lives in a separate package and gives
 * only the page's title.
 */
function projectText(content: Record<string, unknown>, labels: Labels): string {
  const project = isRecord(content.projectV2) ? content.projectV2 : undefined;
  if (!project) return '';
  const out: string[] = [];
  const description = text(project.description).trim();
  if (description) out.push(description);
  const goal = text(project.learningObjective).trim();
  if (goal) out.push(labelled(labels.goal, goal, labels));
  const milestones = list(project.milestones)
    .filter(isRecord)
    .map((milestone, index) => ({ milestone, index }))
    .sort(
      (a, b) =>
        (typeof a.milestone.order === 'number' ? a.milestone.order : a.index) -
          (typeof b.milestone.order === 'number' ? b.milestone.order : b.index) ||
        a.index - b.index,
    );
  milestones.forEach(({ milestone }, index) => {
    const title = text(milestone.title).trim();
    const detail = text(milestone.description).trim();
    if (!title && !detail) return;
    out.push(
      `${index + 1}. ${title && detail ? labelled(title, detail, labels) : title || detail}`,
    );
    const tasks = list(milestone.microtasks)
      .filter(isRecord)
      .map((task, order) => ({ task, order }))
      .sort(
        (a, b) =>
          (typeof a.task.order === 'number' ? a.task.order : a.order) -
            (typeof b.task.order === 'number' ? b.task.order : b.order) || a.order - b.order,
      );
    for (const { task } of tasks) {
      const name = text(task.title).trim();
      if (name) out.push(`  · ${name}`);
    }
  });
  return out.join('\n');
}

/** What the teacher says on a page: its speech actions, in order. */
function narration(scene: Record<string, unknown>): string {
  return list(scene.actions)
    .filter(isRecord)
    .filter((action) => action.type === 'speech')
    .map((action) => text(action.text).trim())
    .filter(Boolean)
    .join('\n');
}

interface Question {
  ask: string;
  options: string[];
  answer: string;
  analysis: string;
}

/**
 * Quiz text with its formulas delimited where upstream's quiz view shows them
 * (it also recognises an undelimited formula such as `x^2+1=0`). `block`: a
 * formula the quiz shows on a line of its own stays there; options keep
 * theirs in the line.
 */
function quizText(value: string, block: boolean): string {
  return renderQuizMathText(value)
    .map((segment) =>
      segment.type === 'text'
        ? segment.value
        : block && segment.displayMode
          ? `\\[${segment.value}\\]`
          : `\\(${segment.value}\\)`,
    )
    .join('');
}

function questions(content: Record<string, unknown>): Question[] {
  return list(content.questions)
    .filter(isRecord)
    .map((question) => ({
      ask: quizText(htmlToText(text(question.question)), true),
      options: list(question.options)
        .filter(isRecord)
        .map((option) =>
          `${text(option.value)}. ${quizText(htmlToText(text(option.label)), false)}`.trim(),
        )
        .filter((option) => option !== '.'),
      answer: list(question.answer)
        .filter((value): value is string => typeof value === 'string')
        .join(', '),
      analysis: quizText(htmlToText(text(question.analysis)), true),
    }))
    .filter((question) => question.ask);
}

/**
 * The handout text of a course.
 *
 * - `full`: every page with its text and the narration, quiz questions where
 *   they come, and the answers on a page of their own at the end.
 * - `slides`: the same without the narration.
 * - `questions`: a worksheet, the quiz questions first and the answers after.
 *
 * `from` and `to` are 1-based page numbers, inclusive.
 */
export function courseHandoutText(
  course: CourseForHandout,
  content: CourseHandoutContent = 'full',
  range: { from?: number; to?: number } = {},
): CourseHandoutText {
  const ordered = course.scenes.filter(isRecord).map((scene, index) => ({ scene, index }));
  ordered.sort((a, b) => {
    const left = typeof a.scene.order === 'number' ? a.scene.order : a.index;
    const right = typeof b.scene.order === 'number' ? b.scene.order : b.index;
    return left - right || a.index - b.index;
  });
  const from = Math.max(1, Math.trunc(range.from ?? 1));
  const to = Math.min(ordered.length, Math.trunc(range.to ?? ordered.length));
  const picked = ordered.slice(from - 1, Math.max(from - 1, to));

  const name = course.name.trim();
  const sample = name + picked.map(({ scene }) => text(scene.title)).join('');
  const labels = /\p{Script=Han}/u.test(sample) ? ZH : EN;

  const blocks: string[] = [];
  const answers: string[] = [];
  let asked = 0;
  const ask = (found: Question[]): string[] =>
    found.map((question) => {
      asked += 1;
      if (question.answer)
        answers.push(
          [
            `${asked}. ${question.answer}`,
            question.analysis && `${labels.analysis}: ${question.analysis}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      // A question without a fixed answer: its explanation is the answer.
      else if (question.analysis) answers.push(`${asked}. ${question.analysis}`);
      // On a worksheet, a question without options gets room to write under it.
      const room = content === 'questions' && !question.options.length ? ['', '', ''] : [];
      return [`${asked}. ${question.ask}`, ...question.options, ...room].join('\n');
    });

  if (content === 'questions') {
    for (const { scene } of picked) {
      const body = isRecord(scene.content) ? scene.content : {};
      if (body.type === 'quiz') blocks.push(...ask(questions(body)));
    }
  } else {
    const description = text(course.description).trim();
    if (description && from === 1) blocks.push(description);
    picked.forEach(({ scene }, offset) => {
      const body = isRecord(scene.content) ? scene.content : {};
      const lines = [`${from + offset}. ${text(scene.title).trim() || labels.untitled}`];
      if (body.type === 'quiz') {
        const found = ask(questions(body));
        if (found.length) lines.push(`${labels.exercises}`, ...found);
      } else if (body.type === 'slide') {
        const written = slideText(body);
        if (written) lines.push(written);
      } else if (body.type === 'interactive' || body.type === 'pbl') {
        const written =
          body.type === 'interactive' ? interactiveText(body, labels) : projectText(body, labels);
        if (written) lines.push(written);
      }
      if (content === 'full') {
        const spoken = narration(scene);
        if (spoken) lines.push(`${labels.notes}: ${spoken}`);
      }
      blocks.push(lines.join('\n'));
    });
  }
  if (content === 'questions' && blocks.length) blocks.unshift(labels.nameLine);
  const main = blocks.join('\n\n').replace(/\n+$/, '');
  const key = answers.length ? [labels.answers, ...answers].join('\n') : '';

  return {
    title:
      content === 'questions'
        ? `${name || labels.untitled} ${labels.worksheet}`
        : name || labels.untitled,
    // The answers start on a page of their own.
    body: main && key ? main + DELIVERABLE_PAGE_BREAK + key : main || key,
    scenes: picked.length,
    questions: asked,
  };
}
