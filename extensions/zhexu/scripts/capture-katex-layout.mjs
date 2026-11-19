/**
 * Records where a browser puts every glyph, rule and SVG of a set of KaTeX
 * formulas, with KaTeX's own stylesheet and fonts. The handout renderer draws
 * formulas without a browser (`deliverables/formula.ts`), and its tests compare
 * what it draws against this record.
 *
 *   node extensions/zhexu/scripts/capture-katex-layout.mjs
 *
 * Writes tests/extensions/fixtures/katex-browser-layout.json. Uses Playwright's
 * Chromium, or the browser channel in ZHEXU_E2E_CHANNEL (for example `chrome`).
 * Run it again after a KaTeX upgrade.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));
const dist = path.dirname(require.resolve('katex/dist/katex.min.css'));
const version = JSON.parse(readFileSync(path.join(dist, '..', 'package.json'), 'utf8')).version;
const out = path.join(root, 'tests/extensions/fixtures/katex-browser-layout.json');

/** KaTeX's `.katex` font size in the capture, in pixels. */
const SIZE = 100;

/** Formulas a handout meets: school mathematics, physics and chemistry. */
const FORMULAS = [
  'a+b=c',
  'x^2',
  'E=mc^2',
  'H_2O',
  'x_{1,2}=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
  '\\frac{a}{b}',
  '\\frac{\\partial f}{\\partial x}',
  '\\sqrt{x+1}',
  '\\sqrt[3]{x}',
  '\\sum_{i=1}^{n} i^2',
  '\\int_0^1 f(x)\\,dx',
  '\\lim_{x\\to 0}\\frac{\\sin x}{x}=1',
  '\\left(\\frac{1}{2}\\right)^2',
  '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
  '\\begin{cases}x+y=1\\\\x-y=2\\end{cases}',
  '\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}',
  '\\vec{v}',
  '\\vec{F}=m\\vec{a}',
  '\\hat{y}',
  '\\overline{AB}',
  '\\overrightarrow{AB}',
  '\\xrightarrow{\\Delta}',
  '\\underbrace{a+b}_{n}',
  '\\binom{n}{k}',
  '\\boxed{x=1}',
  '\\cancel{x}',
  '\\sin^2\\theta+\\cos^2\\theta=1',
  '\\log_2 8=3',
  '\\angle ABC=90^\\circ',
  '\\alpha\\beta\\gamma\\Delta',
  'x \\in \\mathbb{R}',
  '\\mathrm{d}x\\quad\\mathbf{F}',
  'a\\cdot b\\times c\\div d',
  '|x|\\leq 1',
  '\\{1,2,3\\}',
  '\\text{速度 } v=\\frac{s}{t}',
  '\\displaystyle\\sum_{k=0}^{\\infty}\\frac{x^k}{k!}',
  'F=G\\frac{m_1 m_2}{r^2}',
  'a\\neq b',
  'ax^2+bx+c=0\\ (a\\neq 0)',
  'x\\notin A',
  '\\mathrlap{/}x+\\mathllap{x}y+\\mathclap{=}z',
  '\\frac{a}{b}\\neq c',
  '\\dfrac{a}{b}\\neq\\sqrt{c}',
  '\\frac{x\\neq 1}{2}',
  '\\sum_{i}x_i\\neq 0',
  'x^{a\\neq b}',
  'x\\not\\in A',
  '\\dfrac{1}{2}+\\tfrac{1}{3}',
  '\\frac{1}{1+\\frac{1}{x}}',
  '\\left|x-1\\right|+\\lfloor x\\rfloor',
  '\\widehat{ABC}',
  '\\overleftrightarrow{AB}',
  '\\overset{\\frown}{AB}',
  '\\because a=b,\\therefore b=a',
  '\\triangle ABC\\cong\\triangle DEF',
  'AB\\parallel CD,\\ AB\\perp EF',
  '2H_2+O_2\\xlongequal{\\text{点燃}}2H_2O',
  '\\mathrm{CO_2}+\\mathrm{H_2O}',
  '10\\%\\approx\\pm 0.1',
  '\\left[\\begin{array}{cc}1&0\\\\0&1\\end{array}\\right]',
  '\\left(\\begin{array}{c}1\\\\2\\\\3\\\\4\\end{array}\\right)',
  'a_{n+1}=a_n+d',
  '\\tan\\alpha=\\frac{\\sin\\alpha}{\\cos\\alpha}',
  '\\sqrt{\\frac{a}{b}}',
  '{\\color{red}x}+y',
];

const page = `<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="katex.min.css">
<script src="katex.min.js"></script>
<style>
  body { margin: 0; font-family: serif; }
  .case { font-size: ${SIZE / 1.21}px; white-space: nowrap; text-align: left; padding: 40px; }
</style>
<body></body>`;

const browser = await chromium.launch({ channel: process.env.ZHEXU_E2E_CHANNEL || undefined });
try {
  const tab = await browser.newPage();
  await tab.route('https://katex.capture/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'index.html')
      return route.fulfill({ body: page, contentType: 'text/html; charset=utf-8' });
    return route.fulfill({ path: path.join(dist, name) });
  });
  await tab.goto('https://katex.capture/index.html');
  const cases = await tab.evaluate(async (formulas) => {
    const all = [];
    for (const latex of formulas)
      for (const display of [false, true]) {
        const element = document.createElement('div');
        element.className = 'case';
        document.body.append(element);
        globalThis.katex.render(latex, element, {
          displayMode: display,
          output: 'html',
          strict: false,
          throwOnError: true,
          trust: false,
        });
        all.push({ latex, display, element });
      }
    await document.fonts.ready;
    // Faces no formula uses stay unloaded; only a face that failed matters.
    const missing = [...document.fonts].filter((face) => face.status === 'error').length;
    const canvas = document.createElement('canvas').getContext('2d');
    const round = (value) => Math.round(value * 100) / 100;
    return {
      missing,
      cases: all.map(({ latex, display, element }) => {
        // An empty inline block at the start of the first base sits on the
        // formula's baseline, at its left edge.
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:0;height:0';
        const base = element.querySelector('.base');
        base.insertBefore(marker, base.firstChild);
        const origin = marker.getBoundingClientRect();
        const ox = origin.left;
        const oy = origin.bottom;
        const html = element.querySelector('.katex-html');
        const glyphs = [];
        const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.nodeValue;
          if (!text || text === '​') continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          canvas.font = getComputedStyle(node.parentElement).font;
          const descent = canvas.measureText(text).fontBoundingBoxDescent;
          glyphs.push({ text, x: round(rect.left - ox), y: round(rect.bottom - descent - oy) });
        }
        const box = (el) => {
          const rect = el.getBoundingClientRect();
          return {
            x: round(rect.left - ox),
            y: round(rect.top - oy),
            width: round(rect.width),
            height: round(rect.height),
          };
        };
        const rules = [];
        for (const el of html.querySelectorAll(
          '.frac-line, .overline-line, .underline-line, .hline, .fbox',
        )) {
          if (el.classList.contains('fbox')) {
            const outer = box(el);
            const border = round(parseFloat(getComputedStyle(el).borderTopWidth));
            rules.push(
              { ...outer, height: border },
              { ...outer, y: round(outer.y + outer.height - border), height: border },
              { ...outer, width: border },
              { ...outer, x: round(outer.x + outer.width - border), width: border },
            );
          } else {
            // The line is the bottom border; the box above it is katex.css's 1px minimum height.
            const outer = box(el);
            const border = round(parseFloat(getComputedStyle(el).borderBottomWidth));
            rules.push({ ...outer, y: round(outer.y + outer.height - border), height: border });
          }
        }
        const svgs = [...html.querySelectorAll('svg')].map(box);
        return { latex, display, glyphs, rules, svgs };
      }),
    };
  }, FORMULAS);
  if (cases.missing) throw Error(`${cases.missing} KaTeX fonts did not load`);
  // Two-space JSON is also how Prettier formats it, so a new capture diffs cleanly.
  writeFileSync(
    out,
    JSON.stringify(
      { katex: version, size: SIZE, browser: browser.version(), cases: cases.cases },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${path.relative(root, out)}: ${cases.cases.length} cases, KaTeX ${version}`);
} finally {
  await browser.close();
}
