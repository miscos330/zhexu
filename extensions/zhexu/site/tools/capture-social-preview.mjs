#!/usr/bin/env node
/**
 * Draws the repository's social preview image (the card a link to the
 * repository unfurls into), 1280 by 640 as GitHub asks.
 *
 *   node extensions/zhexu/site/tools/capture-social-preview.mjs
 *   node extensions/zhexu/site/tools/capture-social-preview.mjs --out some/file.png
 *
 * The card is built from the showcase page itself: its stylesheet for the
 * colours and fonts, the signature in its header, and one of its screenshots.
 * A change of brand on the page therefore shows on the next run. It drives an
 * installed Edge or Chrome (no browser download) and calls nothing else.
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 1280;
const HEIGHT = 640;
/** GitHub refuses an image above 1 MB. */
const MAX_BYTES = 1_000_000;

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const OUT = option('out', join(SITE, 'assets', 'social-preview.png'));

async function launch() {
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--hide-scrollbars'] });
    } catch (error) {
      if (channel === undefined) throw error;
    }
  }
  throw new Error('No browser available');
}

/** The signature (mark and lettering) exactly as the page's header draws it. */
function signature() {
  const html = readFileSync(join(SITE, 'index.html'), 'utf8');
  const start = html.indexOf('<svg');
  const end = html.indexOf('</svg>', start);
  const svg = html.slice(start, end + '</svg>'.length);
  if (start === -1 || end === -1 || !svg.includes('zx-brand__signature')) {
    throw new Error('The header signature was not found in index.html');
  }
  return svg;
}

const card = `<!doctype html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <base href="${pathToFileURL(SITE).href}/" />
    <link rel="stylesheet" href="site.css" />
    <style>
      html,
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        margin: 0;
        overflow: hidden;
        background: var(--zx-bg-page);
      }
      .card {
        position: relative;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        font-family: var(--zx-font-sans);
        color: var(--zx-text-primary);
      }
      .card__text {
        position: absolute;
        inset: 64px auto 64px 72px;
        width: 560px;
        display: flex;
        flex-direction: column;
      }
      .card__text svg {
        width: 198px;
        height: 72px;
      }
      .card__title {
        margin: 68px 0 0;
        font-size: 74px;
        line-height: 90px;
        font-weight: 700;
        letter-spacing: 0;
      }
      .card__sub {
        margin: 22px 0 0;
        font-family: 'Geist', system-ui, sans-serif;
        font-size: 27px;
        line-height: 36px;
        color: var(--zx-text-muted);
      }
      .card__note {
        margin: auto 0 0;
        font-size: 22px;
        line-height: 30px;
        color: var(--zx-text-muted);
      }
      .card__note b {
        font-weight: 600;
        color: var(--zx-text-accent);
      }
      .card__shot {
        position: absolute;
        left: 668px;
        top: 150px;
        width: 800px;
        height: 500px;
        border: 1px solid var(--zx-border-default);
        border-radius: 16px;
        background: var(--zx-bg-fold);
        object-fit: cover;
        box-shadow: 0 28px 64px rgb(24 37 34 / 0.14);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="card__shot" src="assets/shots/classroom-light.webp" alt="" />
      <div class="card__text">
        ${signature()}
        <h1 class="card__title">一句话，<br />展开成一堂课。</h1>
        <p class="card__sub">One sentence, unfolded into a lesson.</p>
        <p class="card__note"><b>开源</b>的 AI 互动课堂 · 基于 OpenMAIC · MIT</p>
      </div>
    </div>
  </body>
</html>`;

const browser = await launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  // A file URL, so that the relative addresses in the card resolve to the page's own files.
  const holder = join(SITE, 'tools', '.social-preview.html');
  writeFileSync(holder, card);
  try {
    await page.goto(pathToFileURL(holder).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => {
      const shot = document.querySelector('.card__shot');
      return shot.complete && shot.naturalWidth > 0;
    });
    if (!loaded) throw new Error('The screenshot in the card did not load');
    const raw = await page.screenshot({ type: 'png' });
    const png = await sharp(raw).png({ compressionLevel: 9, palette: false }).toBuffer();
    if (png.length > MAX_BYTES) {
      throw new Error(`The image is ${png.length} bytes; GitHub accepts at most ${MAX_BYTES}`);
    }
    writeFileSync(OUT, png);
    const { width, height } = await sharp(png).metadata();
    console.log(`${OUT}: ${width}x${height}, ${statSync(OUT).size} bytes`);
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(holder, { force: true });
  }
} finally {
  await browser.close();
}
