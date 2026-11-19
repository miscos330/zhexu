import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * A saved course, exported as a handout and as a worksheet.
 *
 * The course is stored through the app's own persistence endpoint, as the
 * browser under test, so it belongs to that browser's owner. The stand-in model
 * only names the course in a tool call; reading the course, laying its text
 * out, rendering, storing and serving the files are real.
 */

/** The first visit opens a tour over the page; close it when it is there. */
async function dismissTour(page: Page) {
  const skip = page.getByTestId('workspace-tour-skip');
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return;
  }
  await skip.click();
  await expect(page.getByTestId('workspace-tour')).toHaveCount(0);
}

const slide = (
  stageId: string,
  order: number,
  title: string,
  text: string,
  said: string,
  more: object[] = [],
) => ({
  id: `${stageId}-s${order}`,
  stageId,
  type: 'slide',
  title,
  order,
  createdAt: 1785899990000,
  updatedAt: 1785900000000,
  content: {
    type: 'slide',
    canvas: {
      id: `slide-${order}`,
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: {
        backgroundColor: '#ffffff',
        themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
        fontColor: '#333333',
        fontName: 'Microsoft Yahei',
      },
      elements: [
        {
          type: 'text',
          id: `text-${order}`,
          content: `<p>${text}</p>`,
          left: 50,
          top: 50,
          width: 900,
          height: 100,
        },
        ...more,
      ],
    },
  },
  actions: [{ id: `speech-${order}`, type: 'speech', text: said }],
});

/** Store a three-page course (two slides and a quiz) as the page's owner. */
async function seedCourse(page: Page, name: string): Promise<string> {
  // The workspace packages are ESM-only while Playwright loads specs as CommonJS.
  const { DSL_VERSION } = await import('@openmaic/dsl');
  const stageId = `zhexu-e2e-${crypto.randomUUID().slice(0, 8)}`;
  // A picture in the course's own asset pool, uploaded as the page's owner;
  // the handout reads it back through that owner's pool.
  const upload = await page.request.post('/api/persistence/assets', {
    // An allocation takes its metadata first, then the bytes, both as files.
    multipart: {
      meta: {
        name: 'metadata.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ contentType: 'image/png' })),
      },
      bytes: {
        name: 'asset',
        mimeType: 'image/png',
        buffer: readFileSync(join(__dirname, '..', 'fixtures', 'cell-diagram.png')),
      },
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const { id: pictureId } = (await upload.json()) as { id: string };
  const response = await page.request.put(`/api/persistence/documents/${stageId}`, {
    data: {
      dslVersion: DSL_VERSION,
      stage: {
        id: stageId,
        name,
        description: '',
        style: 'professional',
        createdAt: 1785899990000,
        updatedAt: 1785900000000,
      },
      scenes: [
        slide(stageId, 0, '什么是折射', '光的传播方向发生偏折', '今天我们学习光的折射。', [
          {
            type: 'image',
            id: `image-${stageId}`,
            src: pictureId,
            fixedRatio: true,
            left: 50,
            top: 200,
            width: 400,
            height: 300,
            rotate: 0,
          },
        ]),
        slide(
          stageId,
          1,
          '折射规律',
          // An inline formula, stored the way upstream's editor stores one; the handout typesets it.
          '入射角增大，折射角也增大：<span data-inline-math="n_1\\sin i=n_2\\sin r">n_1\\sin i=n_2\\sin r</span>',
          '注意两个角的关系。',
        ),
        {
          id: `${stageId}-quiz`,
          stageId,
          type: 'quiz',
          title: '小测',
          order: 2,
          createdAt: 1785899990000,
          updatedAt: 1785900000000,
          content: {
            type: 'quiz',
            questions: [
              {
                id: 'q1',
                type: 'single',
                question:
                  '光从空气斜射入水中（$n=\\frac{\\sin i}{\\sin r}>1$），折射角与入射角相比？',
                options: [
                  { label: '更大', value: 'A' },
                  { label: '更小，$r<i$', value: 'B' },
                ],
                answer: ['B'],
                points: 1,
              },
            ],
          },
        },
      ],
      outline: { outlines: [], createdAt: 1785899990000, updatedAt: 1785900000000 },
    },
  });
  expect(response.status(), await response.text()).toBe(204);
  return stageId;
}

async function ask(page: Page, prompt: string) {
  await page.getByTestId('pro-launch-prompt').click();
  await page.keyboard.type(prompt);
  await page.getByTestId('pro-launch-start').click();
}

async function downloadAll(
  page: Page,
  card: ReturnType<Page['getByTestId']>,
): Promise<Map<string, Buffer>> {
  const bodies = new Map<string, Buffer>();
  const files = await card.locator('a[download]').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href') ?? '',
      name: link.getAttribute('download') ?? '',
    })),
  );
  expect(files.some((file) => file.name.endsWith('.pdf'))).toBe(true);
  for (const file of files) {
    const response = await page.request.get(file.href);
    expect(response.status(), file.name).toBe(200);
    const head = (await response.body()).subarray(0, 4).toString('latin1');
    if (file.name.endsWith('.pdf')) expect(head, file.name).toBe('%PDF');
    if (file.name.endsWith('.png')) expect(head, file.name).toBe('\u0089PNG');
    bodies.set(file.name, await response.body());
  }
  return bodies;
}

/** Pixels of the cell diagram's purple nucleus, which nothing else on a page has. */
async function nucleusPixels(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
    if (r > 120 && r < 160 && g > 95 && g < 125 && b > 160 && b < 195) count += 1;
  }
  return count;
}

test('a saved course becomes a handout whose files download', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);
  const name = `光的折射 ${crypto.randomUUID().slice(0, 6)}`;
  const stageId = await seedCourse(page, name);

  await ask(page, `把课程 ${stageId} 导出成讲义`);

  const card = page.getByTestId('zhexu-deliverable-card');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-delivery-state', 'delivered');
  await expect(card).toContainText(name);
  const files = await downloadAll(page, card);
  // The first page carries the course's picture, read from the owner's asset pool.
  const firstPage = [...files].find(([fileName]) => fileName.endsWith('.png'))?.[1];
  expect(firstPage).toBeDefined();
  expect(await nucleusPixels(firstPage!)).toBeGreaterThan(5_000);
});

test('the quiz of a saved course becomes a worksheet', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);
  const name = `光的折射 ${crypto.randomUUID().slice(0, 6)}`;
  const stageId = await seedCourse(page, name);

  await ask(page, `把课程 ${stageId} 的测验做成练习`);

  const card = page.getByTestId('zhexu-deliverable-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${name} 练习`);
  await downloadAll(page, card);
});

test('a course of another visitor is not exported', async ({ page, browser }) => {
  // Another browser, another owner: it stores the course and keeps its id.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/');
  await otherPage.locator('.ws-root').waitFor();
  const stageId = await seedCourse(otherPage, '别人的课');
  await other.close();

  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);
  await ask(page, `把课程 ${stageId} 导出成讲义`);

  // The stand-in model says so once the tool has refused; no card with files appears.
  await expect(page.getByText('这次没有生成文件')).toBeVisible();
  await expect(page.getByTestId('zhexu-deliverable-card').locator('a[download]')).toHaveCount(0);
});
