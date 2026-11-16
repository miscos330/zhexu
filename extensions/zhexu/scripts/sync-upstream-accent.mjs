#!/usr/bin/env node
/**
 * Regenerates `extensions/zhexu/theme-upstream-literals.css`.
 *
 * Upstream writes its violet accent as literal colours in a few stylesheets
 * (`#7c3aed`, `rgba(124, 58, 237, 0.08)`, ...). Literals cannot be re-themed
 * through custom properties, so this script finds each declaration that
 * carries one and repeats it under the ZHEXU scope with the literal replaced
 * by the same step of Tailwind's violet/purple scale, which
 * `extensions/zhexu/theme.css` remaps to the brand colours.
 *
 * Run it after rebasing on upstream:
 *
 *   node extensions/zhexu/scripts/sync-upstream-accent.mjs          # rewrite
 *   node extensions/zhexu/scripts/sync-upstream-accent.mjs --check  # verify only
 *
 * `--check` exits 1 when the generated file is out of date (the test suite
 * runs it). Declarations inside `@keyframes` cannot be scoped by a selector;
 * they are reported, not covered.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCES = [
  'components/workbench/workspace-shell.css',
  'components/workbench/composer-input.css',
  'components/classroom/course-end/course-end.css',
];
const THEME = 'extensions/zhexu/theme.css';
const OUTPUT = 'extensions/zhexu/theme-upstream-literals.css';
const SCOPE = "html[data-brand='zhexu']";
const DARK_SCOPE = "html.dark[data-brand='zhexu']";

/** At-rules whose children are ordinary rules. `@layer` is dropped on output: unlayered wins. */
const GROUPING_AT_RULES = new Set(['media', 'container', 'supports', 'layer']);

/** OKLCH lightness of each step of Tailwind's scales, to pick the nearest step for a literal. */
const SCALES = {
  violet: {
    50: 0.969,
    100: 0.943,
    200: 0.894,
    300: 0.811,
    400: 0.702,
    500: 0.606,
    600: 0.541,
    700: 0.491,
    800: 0.432,
    900: 0.38,
    950: 0.283,
  },
  purple: {
    50: 0.977,
    100: 0.946,
    200: 0.902,
    300: 0.827,
    400: 0.714,
    500: 0.627,
    600: 0.558,
    700: 0.496,
    800: 0.438,
    900: 0.381,
    950: 0.291,
  },
};

function toOklch(r, g, b) {
  const linear = (channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: Math.hypot(a, bb),
    h: hue < 0 ? hue + 360 : hue,
  };
}

/** The scale reference for a violet or purple literal, or null for any other colour. */
function mapColor(r, g, b, alpha) {
  const { L, C, h } = toOklch(r, g, b);
  // Violet sits near hue 293 and purple near 304; indigo (below 284) and
  // fuchsia (above 320) stay out, as do near-greys.
  if (C < 0.012 || h < 286 || h >= 314) return null;
  const family = h < 299 ? 'violet' : 'purple';
  let step = '500';
  let nearest = Infinity;
  for (const [name, lightness] of Object.entries(SCALES[family])) {
    const distance = Math.abs(lightness - L);
    if (distance < nearest) {
      nearest = distance;
      step = name;
    }
  }
  const reference = `var(--color-${family}-${step})`;
  if (alpha === undefined || alpha >= 1) return reference;
  return `color-mix(in oklab, ${reference} ${Number((alpha * 100).toFixed(2))}%, transparent)`;
}

const HEX = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z_-])/gi;
const RGB =
  /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*(\d*\.?\d+%?))?\s*\)/gi;

/** Replace the violet literals in a declaration value; `count` is how many were replaced. */
function rewriteValue(value) {
  let count = 0;
  const replaced = value
    .replace(HEX, (match, digits) => {
      const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
      const channel = (index) => parseInt(full.slice(index * 2, index * 2 + 2), 16);
      const alpha = full.length === 8 ? channel(3) / 255 : undefined;
      const mapped = mapColor(channel(0), channel(1), channel(2), alpha);
      if (!mapped) return match;
      count += 1;
      return mapped;
    })
    .replace(RGB, (match, r, g, b, a) => {
      const alpha =
        a === undefined ? undefined : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
      const mapped = mapColor(Number(r), Number(g), Number(b), alpha);
      if (!mapped) return match;
      count += 1;
      return mapped;
    });
  return { value: replaced, count };
}

/** Blank out comments, keeping every newline so positions still map to source lines. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/** Index of the first of `stops` outside strings and parentheses, or -1. */
function scan(css, from, to, stops) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < to; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(ch)) return i;
  }
  return -1;
}

function matchingBrace(css, open, to) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < to; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced braces in stylesheet');
}

function parseDeclarations(css, from, to) {
  const declarations = [];
  let i = from;
  while (i < to) {
    const stop = scan(css, i, to, ';');
    const end = stop === -1 ? to : stop;
    const text = css.slice(i, end);
    const colon = text.indexOf(':');
    if (colon > 0) {
      declarations.push({
        prop: text.slice(0, colon).trim(),
        value: text
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
      });
    }
    i = end + 1;
  }
  return declarations;
}

function parseRules(css, from = 0, to = css.length) {
  const nodes = [];
  let i = from;
  while (i < to) {
    const stop = scan(css, i, to, '{;');
    if (stop === -1) break;
    if (css[stop] === ';') {
      i = stop + 1;
      continue;
    }
    const prelude = css.slice(i, stop).trim();
    const close = matchingBrace(css, stop, to);
    if (prelude.startsWith('@')) {
      const name = prelude.slice(1).split(/[\s(]/, 1)[0].toLowerCase();
      if (GROUPING_AT_RULES.has(name)) {
        nodes.push({ kind: 'group', name, prelude, children: parseRules(css, stop + 1, close) });
      } else {
        nodes.push({ kind: 'opaque', prelude, body: css.slice(stop + 1, close) });
      }
    } else {
      nodes.push({ kind: 'rule', prelude, declarations: parseDeclarations(css, stop + 1, close) });
    }
    i = close + 1;
  }
  return nodes;
}

function splitSelectors(prelude) {
  const selectors = [];
  let i = 0;
  while (i < prelude.length) {
    const stop = scan(prelude, i, prelude.length, ',');
    const end = stop === -1 ? prelude.length : stop;
    selectors.push(prelude.slice(i, end).trim().replace(/\s+/g, ' '));
    i = end + 1;
  }
  return selectors.filter(Boolean);
}

const DARK_PREFIX = /^(?:html|:root)?\.dark(?=$|[\s>+~])\s*/;
const ROOT_PREFIX = /^(?:html|:root)(?=$|[\s>+~])/;

/** For every selector upstream also styles under `.dark`, the properties that dark rule sets. */
function collectDarkProperties(nodes, map = new Map()) {
  for (const node of nodes) {
    if (node.kind === 'group') collectDarkProperties(node.children, map);
    if (node.kind !== 'rule') continue;
    for (const selector of splitSelectors(node.prelude)) {
      const dark = DARK_PREFIX.exec(selector);
      if (!dark) continue;
      const base = selector.slice(dark[0].length);
      const properties = map.get(base) ?? new Set();
      for (const declaration of node.declarations) properties.add(declaration.prop);
      map.set(base, properties);
    }
  }
  return map;
}

/** The same property, or a shorthand and one of its longhands (`background`, `background-color`). */
function overlaps(a, b) {
  if (a === b) return true;
  if (a.startsWith('--') || b.startsWith('--')) return false;
  return a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

/**
 * Put a selector under the brand scope. A leading `.dark` moves onto the root
 * element. A light rule whose property upstream sets again under `.dark` is
 * limited to light mode: the scoped selector outranks upstream's dark rule, so
 * without the limit it would replace the dark value with the light one.
 */
function scopeSelector(selector, prop, darkProperties) {
  const dark = DARK_PREFIX.exec(selector);
  if (dark) return `${DARK_SCOPE} ${selector.slice(dark[0].length)}`.trim();
  const root = ROOT_PREFIX.exec(selector);
  if (root) return SCOPE + selector.slice(root[0].length);
  const setInDark = [...(darkProperties.get(selector) ?? [])].some((other) =>
    overlaps(prop, other),
  );
  return setInDark ? `${SCOPE}:not(.dark) ${selector}` : `${SCOPE} ${selector}`;
}

function emit(nodes, context) {
  const { manualProperties, darkProperties, stats } = context;
  let css = '';
  for (const node of nodes) {
    if (node.kind === 'rule') {
      // Scoped selector list -> the declarations it gets, in source order.
      const bySelectors = new Map();
      for (const declaration of node.declarations) {
        const { value, count } = rewriteValue(declaration.value);
        if (count === 0) continue;
        if (declaration.prop.startsWith('--') && manualProperties.has(declaration.prop)) {
          stats.manual += count;
          continue;
        }
        stats.overridden += count;
        const selectors = splitSelectors(node.prelude)
          .map((selector) => scopeSelector(selector, declaration.prop, darkProperties))
          .join(',\n');
        const lines = bySelectors.get(selectors) ?? [];
        lines.push(`  ${declaration.prop}: ${value};`);
        bySelectors.set(selectors, lines);
      }
      for (const [selectors, lines] of bySelectors) {
        css += `${selectors} {\n${lines.join('\n')}\n}\n\n`;
      }
    } else if (node.kind === 'group') {
      const inner = emit(node.children, context);
      if (inner.trim()) css += node.name === 'layer' ? inner : `${node.prelude} {\n${inner}}\n\n`;
    } else {
      const { count } = rewriteValue(node.body);
      if (count > 0) stats.uncovered.push(`${node.prelude} (${count})`);
    }
  }
  return css;
}

async function generate() {
  const read = (file) => readFileSync(join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  // Custom properties theme.css sets by hand keep its values, not a generated one.
  const manualProperties = new Set(
    [...stripComments(read(THEME)).matchAll(/(?:^|[\s{;])(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
  );
  const report = [];
  let body = '';
  for (const source of SOURCES) {
    const stats = { overridden: 0, manual: 0, uncovered: [] };
    const nodes = parseRules(stripComments(read(source)));
    const darkProperties = collectDarkProperties(nodes);
    const css = emit(nodes, { manualProperties, darkProperties, stats });
    report.push({ source, ...stats });
    if (css.trim()) body += `/* ${source} */\n\n${css}`;
  }
  const header = `/*
 * GENERATED by extensions/zhexu/scripts/sync-upstream-accent.mjs. Do not edit.
 *
 * Upstream stylesheets write the product accent as literal violet colours in
 * places. Each rule below repeats one such declaration under the ZHEXU scope
 * with the literal replaced by the same step of Tailwind's violet/purple
 * scale, which theme.css remaps to the brand colours. Regenerate after
 * rebasing on upstream (see the script's header).
 */

`;
  const outputPath = join(REPO_ROOT, OUTPUT);
  const options = (await prettier.resolveConfig(outputPath)) ?? {};
  const text = await prettier.format(header + body, { ...options, filepath: outputPath });
  return { text, report, outputPath };
}

const check = process.argv.includes('--check');
const { text, report, outputPath } = await generate();

for (const entry of report) {
  const notes = [
    `${entry.overridden} overridden`,
    entry.manual > 0 ? `${entry.manual} left to theme.css` : '',
    entry.uncovered.length > 0 ? `not covered: ${entry.uncovered.join(', ')}` : '',
  ].filter(Boolean);
  console.log(`${entry.source}: ${notes.join('; ')}`);
}

if (check) {
  let current = '';
  try {
    current = readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // A missing file is simply out of date.
  }
  if (current !== text) {
    console.error(
      `${OUTPUT} is out of date. Run: node extensions/zhexu/scripts/sync-upstream-accent.mjs`,
    );
    process.exit(1);
  }
  console.log(`${OUTPUT} is up to date.`);
} else {
  writeFileSync(outputPath, text);
  console.log(`Wrote ${OUTPUT}.`);
}
