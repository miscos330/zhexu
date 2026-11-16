#!/usr/bin/env node
/**
 * Captures the product screenshots the showcase page uses, from a running app.
 *
 * Start the app with the ZHEXU extension first (`pnpm dev` with
 * NEXT_PUBLIC_DEPLOYMENT_EXTENSION=zhexu and NEXT_PUBLIC_WORKBENCH_ENABLED=true),
 * then:
 *
 *   node extensions/zhexu/site/tools/capture-screenshots.mjs
 *   node extensions/zhexu/site/tools/capture-screenshots.mjs --base http://localhost:3000 --out some/dir
 *
 * It drives an installed Edge or Chrome (no browser download) with a fresh
 * profile, so every run starts as a first visit: the first-run tour is skipped
 * and the bundled guide course is the only course. No model is called.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const BASE = option('base', 'http://localhost:3000').replace(/\/$/, '');
const OUT = option('out', join(HERE, '..', 'assets', 'shots'));
const VIEWPORT = { width: 1440, height: 900 };
/** Stored width in pixels: the page shows a shot at most 1200 CSS pixels wide, at 2x. */
const STORED_WIDTH = 2400;

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

/** Skip the first-run tour when it is showing. */
async function dismissTour(page) {
  const skip = page.locator('.ws-tour button', { hasText: '跳过' });
  if ((await skip.count()) > 0) {
    await skip.last().click();
    await page.waitForTimeout(600);
  }
}

/** Load a workspace URL and wait until the shell has settled. */
async function visit(page, path) {
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForSelector('.ws-root', { timeout: 60_000 });
  // The dev-mode indicator of `next dev` is not part of the product.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(2500);
  await dismissTour(page);
}

/** Open the bundled guide course (the only course of a first visit) at a scene. */
async function openGuideCourse(page, scene) {
  await visit(page, '/workspace?view=courses');
  await page.locator('text=5 分钟学会用').first().click();
  await page.waitForTimeout(6000);
  await dismissTour(page);
  const gotIt = page.getByRole('button', { name: '知道了' });
  if ((await gotIt.count()) > 0) {
    await gotIt.first().click();
    await page.waitForTimeout(400);
  }
  for (let current = 1; current < scene; current += 1) {
    await page.getByRole('button', { name: 'Next scene' }).click();
    await page.waitForTimeout(1200);
  }
  // Park the pointer away from the slide so no hover control covers it.
  await page.mouse.move(700, 880);
  await page.waitForTimeout(500);
}

async function save(page, name) {
  const png = await page.screenshot({ type: 'png' });
  const output = await sharp(png).resize({ width: STORED_WIDTH }).webp({ quality: 82 }).toBuffer();
  writeFileSync(join(OUT, `${name}.webp`), output);
  console.log(`${name}.webp  ${Math.round(output.length / 1024)} KB`);
}

mkdirSync(OUT, { recursive: true });
const browser = await launch();
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      colorScheme: scheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    if (scheme === 'light') {
      await visit(page, '/');
      await save(page, 'home-light');
    }

    // Scene 3 is a slide with the teacher's narration under it.
    await openGuideCourse(page, 3);
    await save(page, `classroom-${scheme}`);

    if (scheme === 'light') {
      // Scene 7 is the last one: reaching it opens the course-complete dialog.
      await openGuideCourse(page, 7);
      await save(page, 'finished-light');
    }

    await context.close();
  }
} finally {
  await browser.close();
}
