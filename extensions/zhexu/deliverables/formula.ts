import katex from 'katex';
import { safeKatexOptions } from '@openmaic/dsl';

/**
 * Typesets a LaTeX formula for a handout page.
 *
 * KaTeX does the typesetting: it picks every glyph, font, size, space and
 * vertical position, exactly as for a formula on a slide. Its output is HTML
 * that a browser places with a short stylesheet (`katex.css`). A handout is
 * drawn on a canvas, with no browser, so this module applies the rules of that
 * stylesheet to KaTeX's internal tree (`__renderToHTMLTree`) and draws the
 * result with KaTeX's own fonts, which upstream ships for its video export.
 *
 * It knows the classes and styles KaTeX uses for fractions, roots, scripts,
 * accents, big operators, delimiters, matrices and arrays, stretchy arrows and
 * braces, boxes and cancel lines. A formula that uses anything else, or that
 * KaTeX cannot parse, is not typeset at all: the caller prints its source, as
 * before. A formula is drawn the way KaTeX lays it out or shown as written,
 * never drawn wrong. `tests/extensions/fixtures/katex-browser-layout.json`
 * holds the positions a browser gives the same formulas, and the tests compare
 * against it.
 */

/** KaTeX's fonts and the family each is registered under. */
export const KATEX_FONTS: ReadonlyArray<readonly [file: string, family: string]> = [
  'AMS-Regular',
  'Caligraphic-Bold',
  'Caligraphic-Regular',
  'Fraktur-Bold',
  'Fraktur-Regular',
  'Main-Bold',
  'Main-BoldItalic',
  'Main-Italic',
  'Main-Regular',
  'Math-BoldItalic',
  'Math-Italic',
  'SansSerif-Bold',
  'SansSerif-Italic',
  'SansSerif-Regular',
  'Script-Regular',
  'Size1-Regular',
  'Size2-Regular',
  'Size3-Regular',
  'Size4-Regular',
  'Typewriter-Regular',
].map((name) => [`public/vendor/video-export/fonts/KaTeX_${name}.woff2`, `ZhexuKaTeX_${name}`]);

/** Longest source that is typeset, the same bound upstream's renderer uses. */
export const MAX_FORMULA_SOURCE = 2000;

/** What a typeset formula is drawn with. Coordinates are canvas pixels. */
export interface FormulaPainter {
  text(text: string, font: string, x: number, baseline: number, color: string): void;
  rect(x: number, y: number, width: number, height: number, color: string): void;
  /** Fill an SVG path, mapped by `matrix` and clipped to `clip`. */
  path(d: string, matrix: Matrix, clip: Rect, color: string): void;
  line(from: Point, to: Point, width: number, clip: Rect, color: string): void;
}

export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number];
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

export interface TypesetFormula {
  latex: string;
  display: boolean;
  /** Advance width, and extent above and below the baseline, in pixels. */
  width: number;
  height: number;
  depth: number;
  /** Draw with the left edge at `x` and the baseline at `baseline`. */
  paint(painter: FormulaPainter, x: number, baseline: number): void;
}

export interface TypesetOptions {
  display: boolean;
  /** Font size of the formula in pixels (KaTeX's `.katex` size). */
  size: number;
  color: string;
  /** Width of `text` set in `font`, in pixels. */
  measure(text: string, font: string): number;
  /** Families tried after KaTeX's font, for characters it does not have. */
  fallback: string;
}

/** Typeset `latex`, or null when it cannot be drawn faithfully. */
export function typesetFormula(latex: string, options: TypesetOptions): TypesetFormula | null {
  const source = latex.trim();
  if (!source || source.length > MAX_FORMULA_SOURCE) return null;
  try {
    const tree = (
      katex as unknown as { __renderToHTMLTree(expression: string, options: object): unknown }
    ).__renderToHTMLTree(
      source,
      safeKatexOptions({
        displayMode: options.display,
        output: 'html',
        strict: false,
        throwOnError: true,
      }),
    );
    return new Layout(options).formula(tree, source);
  } catch {
    // A parse error, or a construct this module does not know.
    return null;
  }
}

class Unsupported extends Error {}
const unsupported = (what: string): never => {
  throw new Unsupported(what);
};

type Face =
  | 'Main'
  | 'Math'
  | 'AMS'
  | 'Caligraphic'
  | 'Fraktur'
  | 'SansSerif'
  | 'Script'
  | 'Typewriter'
  | 'Size1'
  | 'Size2'
  | 'Size3'
  | 'Size4';
type Variant = 'Regular' | 'Bold' | 'Italic' | 'BoldItalic';
interface Font {
  face: Face;
  bold: boolean;
  italic: boolean;
}

const VARIANTS: Record<Face, readonly Variant[]> = {
  Main: ['Regular', 'Bold', 'Italic', 'BoldItalic'],
  Math: ['Italic', 'BoldItalic'],
  AMS: ['Regular'],
  Caligraphic: ['Regular', 'Bold'],
  Fraktur: ['Regular', 'Bold'],
  SansSerif: ['Regular', 'Bold', 'Italic'],
  Script: ['Regular'],
  Typewriter: ['Regular'],
  Size1: ['Regular'],
  Size2: ['Regular'],
  Size3: ['Regular'],
  Size4: ['Regular'],
};

/** The registered file for a font: the exact variant, or the nearest one KaTeX ships. */
function fontFamily(font: Font): string {
  const want: Variant =
    font.bold && font.italic
      ? 'BoldItalic'
      : font.bold
        ? 'Bold'
        : font.italic
          ? 'Italic'
          : 'Regular';
  const have = VARIANTS[font.face];
  const order: Variant[] = [want, font.bold ? 'Bold' : 'Italic', 'Regular', ...have];
  return `ZhexuKaTeX_${font.face}-${order.find((variant) => have.includes(variant))!}`;
}

/** The font rules of katex.css, in the stylesheet's order (a later rule wins). */
const FONT_CLASSES: ReadonlyArray<readonly [string, Partial<Font>]> = [
  ['textbf', { bold: true }],
  ['textit', { italic: true }],
  ['textrm', { face: 'Main' }],
  ['textsf', { face: 'SansSerif' }],
  ['texttt', { face: 'Typewriter' }],
  ['mathnormal', { face: 'Math', italic: true }],
  ['mathit', { face: 'Main', italic: true }],
  ['mathrm', { italic: false }],
  ['mathbf', { face: 'Main', bold: true }],
  ['boldsymbol', { face: 'Math', bold: true, italic: true }],
  ['amsrm', { face: 'AMS' }],
  ['mathbb', { face: 'AMS' }],
  ['textbb', { face: 'AMS' }],
  ['mathcal', { face: 'Caligraphic' }],
  ['mathfrak', { face: 'Fraktur' }],
  ['textfrak', { face: 'Fraktur' }],
  ['mathboldfrak', { face: 'Fraktur', bold: true }],
  ['textboldfrak', { face: 'Fraktur', bold: true }],
  ['mathtt', { face: 'Typewriter' }],
  ['mathscr', { face: 'Script' }],
  ['textscr', { face: 'Script' }],
  ['mathsf', { face: 'SansSerif' }],
  ['mathboldsf', { face: 'SansSerif', bold: true }],
  ['textboldsf', { face: 'SansSerif', bold: true }],
  ['mathsfit', { face: 'SansSerif', italic: true }],
  ['mathitsf', { face: 'SansSerif', italic: true }],
  ['textitsf', { face: 'SansSerif', italic: true }],
  ['mainrm', { face: 'Main', italic: false }],
];

/** KaTeX's size steps; `reset-sizeA sizeB` scales the font by SIZES[B] / SIZES[A]. */
const SIZES = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];

/** Classes this module knows the effect of (most have none on layout). */
const KNOWN_CLASSES = new Set([
  // structure
  'katex',
  'katex-display',
  'katex-html',
  'base',
  'strut',
  'pstrut',
  'vlist-t',
  'vlist-t2',
  'vlist-r',
  'vlist',
  'vlist-s',
  // atom kinds, which only steer KaTeX's own spacing
  'mord',
  'mop',
  'mbin',
  'mrel',
  'mopen',
  'mclose',
  'mpunct',
  'minner',
  'mtight',
  'text',
  'cjk_fallback',
  'nobreak',
  'allowbreak',
  'smash',
  // overlaps (\neq, \notin, \mathrlap)
  'vbox',
  'thinbox',
  'rlap',
  'llap',
  'clap',
  'inner',
  'fix',
  // spacing and sizes
  'mspace',
  'nulldelimiter',
  'sizing',
  'fontsize-ensurer',
  // scripts, fractions, roots, operators, delimiters
  'msupsub',
  'mfrac',
  'frac-line',
  'sqrt',
  'root',
  'hide-tail',
  'op-symbol',
  'small-op',
  'large-op',
  'op-limits',
  'delimsizing',
  'delimcenter',
  'mult',
  'delim-size1',
  'delim-size4',
  // accents and lines over and under
  'accent',
  'accent-body',
  'overlay',
  'mover',
  'munder',
  'overline',
  'overline-line',
  'underline',
  'underline-line',
  // arrays
  'mtable',
  'col-align-l',
  'col-align-c',
  'col-align-r',
  'arraycolsep',
  'hline',
  // stretchy pieces, boxes, cancel
  'stretchy',
  'svg-align',
  'brace-left',
  'brace-center',
  'brace-right',
  'halfarrow-left',
  'halfarrow-right',
  'x-arrow',
  'x-arrow-pad',
  'boxpad',
  'fbox',
  'cancel-pad',
  'cancel-lap',
  ...FONT_CLASSES.map(([name]) => name),
]);
const SIZE_CLASS = /^(?:reset-)?size(?:[1-9]|1[01])$/;

/** `text-align` set by katex.css on (or right under) an element. */
const ALIGN_CLASSES: Record<string, Align> = {
  mfrac: 'center',
  'op-limits': 'center',
  accent: 'center',
  'x-arrow': 'center',
  mover: 'center',
  munder: 'center',
  'col-align-c': 'center',
  'col-align-l': 'left',
  'col-align-r': 'right',
  'svg-align': 'left',
  msupsub: 'left',
};

/** Horizontal padding (em) and margins (em) katex.css gives by class. */
const PADDING_CLASSES: Record<string, number> = {
  boxpad: 0.3,
  'x-arrow-pad': 0.5,
  'cancel-pad': 0.2,
};
const MARGIN_CLASSES: Record<string, readonly [left: number, right: number]> = {
  root: [0.2777777778, -0.5555555556],
  'cancel-lap': [-0.2, -0.2],
};

/** Elements whose width is 100% of the row they sit in. */
const FULL_WIDTH_CLASSES = [
  'hide-tail',
  'stretchy',
  'frac-line',
  'overline-line',
  'underline-line',
  'hline',
];
const RULE_CLASSES = ['frac-line', 'overline-line', 'underline-line', 'hline'];

/** Absolutely placed pieces of a stretchy container: left edge and width, as fractions of it. */
const PIECES: Record<string, (width: number) => readonly [left: number, width: number]> = {
  'brace-left': (w) => [0, 0.251 * w],
  'brace-center': (w) => [0.25 * w, 0.5 * w],
  'brace-right': (w) => [w - 0.251 * w, 0.251 * w],
  'halfarrow-left': (w) => [0, 0.502 * w],
  'halfarrow-right': (w) => [w - 0.502 * w, 0.502 * w],
};

const STYLE_KEYS = new Set([
  'height',
  'verticalAlign',
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'top',
  'left',
  'position',
  'width',
  'minWidth',
  'borderBottomWidth',
  'borderStyle',
  'borderWidth',
  'color',
]);
const COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i;

type Align = 'left' | 'center' | 'right';
interface Env {
  size: number;
  font: Font;
  align: Align;
  color: string;
  /** Face for direct child spans (`.delim-size1 > span`). */
  childFace?: Face;
}

interface Style {
  height?: number;
  raise: number;
  marginLeft: number;
  marginRight: number;
  paddingLeft: number;
  top: number;
  left: number;
  width?: number;
  minWidth?: number;
  borderBottom?: number;
  border?: number;
  color?: string;
}

/** A laid out piece of the formula. */
interface Box {
  width: number;
  marginLeft: number;
  marginRight: number;
  /** `vertical-align`, upwards. */
  raise: number;
  /** `position: relative` offsets. */
  dx: number;
  dy: number;
  /** Width is 100% of the row: the smallest it may be. */
  stretch?: number;
  setWidth(width: number): void;
  /** `x`: left border edge; `baseline`: where this box's baseline is. */
  paint(painter: FormulaPainter, x: number, baseline: number): void;
}

interface TreeNode {
  classes?: unknown;
  children?: unknown;
  style?: unknown;
  attributes?: unknown;
  text?: unknown;
  italic?: unknown;
  height?: unknown;
  depth?: unknown;
  pathName?: unknown;
  toMarkup?: unknown;
}

const asNode = (value: unknown): TreeNode =>
  typeof value === 'object' && value !== null ? (value as TreeNode) : unsupported('node');
const childrenOf = (node: TreeNode): TreeNode[] =>
  Array.isArray(node.children) ? node.children.map(asNode) : [];
const classesOf = (node: TreeNode): string[] =>
  Array.isArray(node.classes) ? node.classes.filter((name): name is string => !!name) : [];
const isSymbol = (node: TreeNode) => typeof node.text === 'string';
const isElement = (node: TreeNode) => Array.isArray(node.classes);
/** An SVG node: children and attributes, no classes. */
const isSvg = (node: TreeNode) =>
  !isElement(node) &&
  !isSymbol(node) &&
  Array.isArray(node.children) &&
  typeof node.attributes === 'object';

const EMPTY: Box = {
  width: 0,
  marginLeft: 0,
  marginRight: 0,
  raise: 0,
  dx: 0,
  dy: 0,
  setWidth() {},
  paint() {},
};

class Layout {
  private readonly widths = new Map<string, number>();

  constructor(private readonly options: TypesetOptions) {}

  formula(tree: unknown, latex: string): TypesetFormula {
    let root = asNode(tree);
    if (classesOf(root).includes('katex-display'))
      root = childrenOf(root)[0] ?? unsupported('display');
    if (!classesOf(root).includes('katex')) unsupported('root');
    const html = childrenOf(root).find((child) => classesOf(child).includes('katex-html'));
    if (!html) unsupported('html');
    const env: Env = {
      size: this.options.size,
      font: { face: 'Main', bold: false, italic: false },
      align: this.options.display ? 'center' : 'left',
      color: this.options.color,
    };
    const line = this.flow(childrenOf(html!), env);
    const metric = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return {
      latex,
      display: this.options.display,
      width: line.width,
      height: Math.max(0, metric(html!.height)) * env.size,
      depth: Math.max(0, metric(html!.depth)) * env.size,
      paint: (painter, x, baseline) => line.paint(painter, x, baseline),
    };
  }

  private measure(text: string, font: string): number {
    const key = `${font}\n${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      width = this.options.measure(text, font);
      this.widths.set(key, width);
    }
    return width;
  }

  private font(env: Env): string {
    return `${env.size}px "${fontFamily(env.font)}", ${this.options.fallback}`;
  }

  /** Children laid out side by side on one baseline. */
  private flow(nodes: TreeNode[], env: Env): Box {
    const boxes = nodes.map((node) => this.node(node, env));
    const advance = () =>
      boxes.reduce((sum, box) => sum + box.marginLeft + box.width + box.marginRight, 0);
    return {
      ...EMPTY,
      get width() {
        return advance();
      },
      paint(painter, x, baseline) {
        let cursor = x;
        for (const box of boxes) {
          cursor += box.marginLeft;
          box.paint(painter, cursor + box.dx, baseline - box.raise + box.dy);
          cursor += box.width + box.marginRight;
        }
      },
    };
  }

  private node(node: TreeNode, env: Env): Box {
    if (isSymbol(node)) return this.symbol(node, env);
    if (isElement(node)) {
      const attributes = (node.attributes ?? {}) as Record<string, unknown>;
      // Links (\href) and images (\includegraphics) are not drawn.
      if ('href' in attributes || 'src' in attributes) unsupported('link or image');
      return this.element(node, env);
    }
    return unsupported('node kind');
  }

  private derive(env: Env, classes: string[], isSpan: boolean): Env {
    for (const name of classes)
      if (!KNOWN_CLASSES.has(name) && !SIZE_CLASS.test(name)) unsupported(name);
    let size = env.size;
    const font: Font = { ...env.font };
    if (isSpan && env.childFace) font.face = env.childFace;
    if (classes.includes('sizing') || classes.includes('fontsize-ensurer')) {
      const from = Number(classes.find((name) => name.startsWith('reset-size'))?.slice(10));
      const to = Number(classes.find((name) => /^size\d+$/.test(name))?.slice(4));
      if (!SIZES[from - 1] || !SIZES[to - 1]) unsupported('sizing');
      size *= SIZES[to - 1]! / SIZES[from - 1]!;
    }
    for (const [name, effect] of FONT_CLASSES)
      if (classes.includes(name)) Object.assign(font, effect);
    if (classes.includes('delimsizing')) {
      const step = classes.find((name) => /^size[1-4]$/.test(name));
      if (step) font.face = `Size${step.slice(4)}` as Face;
    }
    if (classes.includes('op-symbol')) {
      if (classes.includes('small-op')) font.face = 'Size1';
      if (classes.includes('large-op')) font.face = 'Size2';
    }
    let align = env.align;
    for (const name of classes) align = ALIGN_CLASSES[name] ?? align;
    const childFace = classes.includes('delim-size1')
      ? 'Size1'
      : classes.includes('delim-size4')
        ? 'Size4'
        : undefined;
    return { size, font, align, color: env.color, childFace };
  }

  private style(value: unknown, size: number): Style {
    const style = (typeof value === 'object' && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
    const length = (key: string): number | undefined => {
      const raw = style[key];
      if (raw === undefined || raw === null || raw === '') return undefined;
      const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(em)?$/.exec(String(raw).trim());
      if (!match || (!match[2] && Number(match[1]) !== 0)) unsupported(`${key}: ${String(raw)}`);
      return Number(match![1]) * size;
    };
    for (const [key, raw] of Object.entries(style)) {
      if (raw === undefined || raw === '') continue;
      if (!STYLE_KEYS.has(key)) unsupported(`style ${key}`);
    }
    if (style.position !== undefined && style.position !== 'relative') unsupported('position');
    if (style.borderStyle !== undefined && style.borderStyle !== 'solid')
      unsupported('border style');
    const color = style.color;
    if (color !== undefined && (typeof color !== 'string' || !COLOR.test(color)))
      unsupported('color');
    return {
      height: length('height'),
      raise: length('verticalAlign') ?? 0,
      marginLeft: length('marginLeft') ?? 0,
      marginRight: length('marginRight') ?? 0,
      paddingLeft: length('paddingLeft') ?? 0,
      top: length('top') ?? 0,
      left: length('left') ?? 0,
      width: length('width'),
      minWidth: length('minWidth'),
      borderBottom: length('borderBottomWidth'),
      border: length('borderWidth'),
      color: color as string | undefined,
    };
  }

  private symbol(node: TreeNode, parent: Env): Box {
    const env = this.derive(parent, classesOf(node), false);
    const style = this.style(node.style, env.size);
    const color = style.color ?? env.color;
    const text = node.text as string;
    // KaTeX's zero-width space keeps a table cell open in Safari; it draws nothing.
    if (!text || text === '​') return EMPTY;
    const font = this.font(env);
    const italic = typeof node.italic === 'number' && node.italic > 0 ? node.italic * env.size : 0;
    return {
      ...EMPTY,
      width: this.measure(text, font),
      marginLeft: style.marginLeft,
      // KaTeX writes the italic correction as a right margin unless the style sets one.
      marginRight: style.marginRight || italic,
      raise: style.raise,
      dx: style.left,
      dy: style.top,
      paint: (painter, x, baseline) => painter.text(text, font, x, baseline, color),
    };
  }

  private element(node: TreeNode, parent: Env): Box {
    const classes = classesOf(node);
    const env = this.derive(parent, classes, true);
    const style = this.style(node.style, env.size);
    if (style.color) env.color = style.color;
    if (classes.includes('vlist-t')) return this.table(node, env, style);
    if (classes.includes('strut') || classes.includes('pstrut') || classes.includes('vlist-s'))
      return EMPTY;
    const lap = (['rlap', 'llap', 'clap'] as const).find((name) => classes.includes(name));
    if (lap) return this.lap(node, env, style, lap);
    if (classes.includes('vbox') && childrenOf(node).length > 1) unsupported('vbox of several');

    const inFlow: TreeNode[] = [];
    const placed: TreeNode[] = [];
    for (const child of childrenOf(node)) {
      if (isSvg(child) || classesOf(child).some((name) => name in PIECES)) placed.push(child);
      else inFlow.push(child);
    }
    const content = this.flow(inFlow, env);
    const padding = classes.reduce((sum, name) => sum + (PADDING_CLASSES[name] ?? 0), 0) * env.size;
    const [classLeft, classRight] = classes.reduce<readonly [number, number]>(
      (sum, name) => {
        const margins = MARGIN_CLASSES[name];
        return margins ? [sum[0] + margins[0] * env.size, sum[1] + margins[1] * env.size] : sum;
      },
      [0, 0],
    );
    const stretches =
      classes.some((name) => FULL_WIDTH_CLASSES.includes(name)) ||
      // A plain container of an SVG that is 100% wide, as \cancel makes.
      (inFlow.length === 0 &&
        placed.length > 0 &&
        style.width === undefined &&
        classes.length === 0);
    let fixed: number | undefined = style.width;
    if (classes.includes('nulldelimiter')) fixed = 0.12 * env.size;
    if (classes.includes('accent-body') || classes.includes('thinbox')) fixed = 0;
    const natural = () => padding + style.paddingLeft + content.width + padding;
    let width = stretches ? (style.minWidth ?? 0) : (fixed ?? natural());
    if (!stretches && style.minWidth !== undefined) width = Math.max(width, style.minWidth);
    const rule = RULE_CLASSES.some((name) => classes.includes(name))
      ? (style.borderBottom ?? 0)
      : 0;
    const border = classes.includes('fbox') ? (style.border ?? 0.04 * env.size) : 0;
    if (classes.includes('fbox') && style.height === undefined) unsupported('fbox height');

    const box: Box = {
      width,
      marginLeft: style.marginLeft + classLeft,
      marginRight: style.marginRight + classRight,
      raise: style.raise,
      dx: style.left,
      dy: style.top,
      stretch: stretches ? width : undefined,
      setWidth(value) {
        box.width = value;
      },
      paint: (painter, x, baseline) => {
        content.paint(painter, x + padding + style.paddingLeft, baseline);
        // An inline block with no text of its own sits on the baseline: its
        // bottom edge is the baseline and its top is its height above.
        const height = style.height ?? 0;
        const top = baseline - height;
        if (rule > 0) painter.rect(x, baseline - rule, box.width, rule, env.color);
        if (border > 0) {
          painter.rect(x, top, box.width, border, env.color);
          painter.rect(x, baseline - border, box.width, border, env.color);
          painter.rect(x, top, border, height, env.color);
          painter.rect(x + box.width - border, top, border, height, env.color);
        }
        for (const child of placed) {
          if (isSvg(child)) {
            this.svg(child, env, painter, { x, y: top, width: box.width, height }, style.height);
            continue;
          }
          const pieceClasses = classesOf(child);
          const piece = pieceClasses.find((name) => name in PIECES)!;
          const pieceEnv = this.derive(env, pieceClasses, true);
          const pieceStyle = this.style(child.style, pieceEnv.size);
          const [left, pieceWidth] = PIECES[piece]!(box.width);
          const pieceHeight = pieceStyle.height ?? height;
          for (const grandchild of childrenOf(child)) {
            if (!isSvg(grandchild)) unsupported('stretchy piece');
            this.svg(
              grandchild,
              pieceEnv,
              painter,
              { x: x + left, y: top, width: pieceWidth, height: pieceHeight },
              pieceStyle.height,
            );
          }
        }
      },
    };
    return box;
  }

  /**
   * An overlap (`.rlap`, `.llap`, `.clap`): no width of its own; its `.inner`
   * content starts at it, ends at it or is centred on it. This is how KaTeX
   * lays the slash of \neq and \notin over the next symbol.
   */
  private lap(node: TreeNode, env: Env, style: Style, kind: 'rlap' | 'llap' | 'clap'): Box {
    let inner: Box | undefined;
    for (const child of childrenOf(node)) {
      const names = classesOf(child);
      if (names.includes('inner')) {
        if (inner) unsupported('two lap contents');
        const innerEnv = this.derive(env, names, true);
        const innerStyle = this.style(child.style, innerEnv.size);
        if (innerStyle.width !== undefined || innerStyle.marginLeft || innerStyle.marginRight)
          unsupported('lap content style');
        // The content is absolutely placed, so a browser sets its baseline from
        // the line metrics of its fonts. That equals the surrounding baseline
        // when the content is plain symbols in the text and math faces (the
        // slash of \neq is), and is not modelled otherwise.
        const plain = (nodes: TreeNode[], scope: Env): void => {
          for (const item of nodes) {
            if (isSymbol(item)) {
              const face = this.derive(scope, classesOf(item), false).font.face;
              if (!['Main', 'Math', 'AMS'].includes(face)) unsupported('lap face');
            } else if (isElement(item)) {
              const names = classesOf(item);
              if (names.some((name) => ['vlist-t', 'sizing', 'fontsize-ensurer'].includes(name)))
                unsupported('lap structure');
              plain(childrenOf(item), this.derive(scope, names, true));
            } else unsupported('lap node');
          }
        };
        plain(childrenOf(child), innerEnv);
        // `.clap > .inner > span` is shifted by half its own width; the same as centring the content.
        inner = this.flow(childrenOf(child), innerEnv);
      } else if (
        !(names.includes('strut') || (names.includes('fix') && childrenOf(child).length === 0))
      )
        unsupported('lap child');
    }
    if (!inner) unsupported('lap without content');
    const content = inner!;
    return {
      ...EMPTY,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      raise: style.raise,
      dx: style.left,
      dy: style.top,
      paint(painter, x, baseline) {
        const shift = kind === 'rlap' ? 0 : kind === 'llap' ? -content.width : -content.width / 2;
        content.paint(painter, x + shift, baseline);
      },
    };
  }

  /**
   * A KaTeX vlist: rows stacked at given heights. Each row is a block as wide
   * as the table, whose content is lined up by `text-align`; the content's
   * baseline is the row's `top` plus the height of its `pstrut` below the
   * table's baseline (negative: above).
   */
  private table(node: TreeNode, env: Env, style: Style): Box {
    const [first, ...rest] = childrenOf(node);
    if (!first || !classesOf(first).includes('vlist-r')) unsupported('vlist rows');
    for (const row of rest) {
      // The second row only gives the table its depth; it holds nothing to draw.
      const cells = childrenOf(row);
      if (cells.some((cell) => childrenOf(cell).some((span) => childrenOf(span).length > 0)))
        unsupported('vlist depth row');
    }
    const [list] = childrenOf(first!);
    if (!list || !classesOf(list).includes('vlist')) unsupported('vlist');

    interface Row {
      content: Box;
      marginLeft: number;
      marginRight: number;
      align: Align;
      /** Baseline of the content, upwards from the table's baseline. */
      up: number;
    }
    const rows: Row[] = [];
    for (const wrapper of childrenOf(list!)) {
      const children = childrenOf(wrapper);
      if (children.length === 0) continue;
      const rowEnv = this.derive(env, classesOf(wrapper), true);
      const rowStyle = this.style(wrapper.style, rowEnv.size);
      const [strut, ...content] = children;
      if (!classesOf(strut!).includes('pstrut')) unsupported('pstrut');
      const strutHeight =
        this.style(strut!.style, rowEnv.size).height ?? unsupported('pstrut height');
      const boxes = content.map((child) => this.node(child, rowEnv));
      const single = boxes.length === 1 ? boxes[0]! : undefined;
      rows.push({
        content:
          single && single.stretch !== undefined
            ? single
            : {
                ...EMPTY,
                get width() {
                  return boxes.reduce(
                    (sum, box) => sum + box.marginLeft + box.width + box.marginRight,
                    0,
                  );
                },
                paint(painter, x, baseline) {
                  let cursor = x;
                  for (const box of boxes) {
                    cursor += box.marginLeft;
                    box.paint(painter, cursor + box.dx, baseline - box.raise + box.dy);
                    cursor += box.width + box.marginRight;
                  }
                },
              },
        marginLeft: rowStyle.marginLeft,
        marginRight: rowStyle.marginRight,
        align: rowEnv.align,
        up: -(rowStyle.top + (strutHeight as number)),
      });
    }

    const intrinsic = (row: Row) =>
      row.marginLeft + (row.content.stretch ?? row.content.width) + row.marginRight;
    const cell = Math.max(0, ...rows.map(intrinsic));
    for (const row of rows)
      if (row.content.stretch !== undefined)
        row.content.setWidth(
          Math.max(row.content.stretch, cell - row.marginLeft - row.marginRight),
        );

    return {
      ...EMPTY,
      width: style.width ?? cell,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      raise: style.raise,
      dx: style.left,
      dy: style.top,
      paint(painter, x, baseline) {
        for (const row of rows) {
          const room = cell - row.marginLeft - row.marginRight;
          const used = row.content.width;
          // Content wider than its row starts at the row's left edge.
          const offset =
            used >= room
              ? 0
              : row.align === 'center'
                ? (room - used) / 2
                : row.align === 'right'
                  ? room - used
                  : 0;
          const content = row.content;
          content.paint(
            painter,
            x + row.marginLeft + offset + content.dx,
            baseline - row.up * 1 - content.raise + content.dy,
          );
        }
      },
    };
  }

  /**
   * An SVG of KaTeX's (a radical sign, an arrow, a brace, a cancel line). It
   * fills `box` (its parent's box; its own width if it sets one, its parent's
   * height or else its own), maps its viewBox there and is clipped to it.
   */
  private svg(
    node: TreeNode,
    env: Env,
    painter: FormulaPainter,
    parent: Rect,
    parentHeight: number | undefined,
  ): void {
    const attributes = (node.attributes ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(attributes))
      if (!['width', 'height', 'viewBox', 'preserveAspectRatio', 'style'].includes(key))
        unsupported(`svg ${key}`);
    const em = (value: unknown): number | undefined => {
      if (typeof value !== 'string') return undefined;
      const match = /^(-?\d+(?:\.\d+)?)em$/.exec(value.trim());
      return match ? Number(match[1]) * env.size : undefined;
    };
    const ownWidth =
      typeof attributes.style === 'string'
        ? em(/^width:\s*([^;]+);?$/.exec(attributes.style.trim())?.[1] ?? unsupported('svg style'))
        : undefined;
    const box: Rect = {
      x: parent.x,
      y: parent.y,
      width: ownWidth ?? parent.width,
      height: parentHeight ?? em(attributes.height) ?? unsupported('svg height'),
    };
    if (parentHeight === undefined) box.y = parent.y + parent.height - box.height;

    for (const child of childrenOf(node)) {
      if (typeof child.pathName === 'string' && typeof child.toMarkup === 'function') {
        const markup = String((child.toMarkup as () => unknown).call(child));
        const d = /\sd=(["'])([\s\S]*?)\1/.exec(markup)?.[2] ?? unsupported('svg path');
        const viewBox = String(attributes.viewBox ?? unsupported('viewBox'))
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)))
          unsupported('viewBox');
        painter.path(
          d!,
          viewBoxMatrix(
            viewBox as [number, number, number, number],
            box,
            attributes.preserveAspectRatio,
          ),
          box,
          env.color,
        );
        continue;
      }
      const line = (child.attributes ?? {}) as Record<string, unknown>;
      if (!('x1' in line)) unsupported('svg child');
      const coordinate = (value: unknown, extent: number) => {
        const match = /^(\d+(?:\.\d+)?)(%?)$/.exec(String(value).trim());
        if (!match || (!match[2] && Number(match[1]) !== 0)) unsupported('line coordinate');
        return (Number(match![1]) / 100) * extent;
      };
      const strokeWidth = em(line['stroke-width']) ?? unsupported('line width');
      painter.line(
        { x: box.x + coordinate(line.x1, box.width), y: box.y + coordinate(line.y1, box.height) },
        { x: box.x + coordinate(line.x2, box.width), y: box.y + coordinate(line.y2, box.height) },
        strokeWidth as number,
        box,
        env.color,
      );
    }
  }
}

/** The SVG viewBox mapping (`preserveAspectRatio`) into `box`. */
function viewBoxMatrix(
  [minX, minY, width, height]: readonly [number, number, number, number],
  box: Rect,
  aspect: unknown,
): Matrix {
  const value = typeof aspect === 'string' ? aspect.trim() : 'xMidYMid meet';
  if (value === 'none') {
    const sx = box.width / width;
    const sy = box.height / height;
    return [sx, 0, 0, sy, box.x - minX * sx, box.y - minY * sy];
  }
  const match = /^x(Min|Mid|Max)Y(Min|Mid|Max)(?:\s+(meet|slice))?$/.exec(value);
  if (!match) unsupported('preserveAspectRatio');
  const scale =
    match![3] === 'slice'
      ? Math.max(box.width / width, box.height / height)
      : Math.min(box.width / width, box.height / height);
  const place = (where: string, start: number, room: number, used: number) =>
    where === 'Min' ? start : where === 'Mid' ? start + (room - used) / 2 : start + room - used;
  return [
    scale,
    0,
    0,
    scale,
    place(match![1]!, box.x, box.width, width * scale) - minX * scale,
    place(match![2]!, box.y, box.height, height * scale) - minY * scale,
  ];
}
