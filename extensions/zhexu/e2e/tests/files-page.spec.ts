import { expect, test, type Page } from '@playwright/test';

/**
 * "My files": what was delivered in a conversation shows on the extension's
 * rail page and downloads from there, and a visitor who has nothing sees an
 * empty page, not somebody else's files.
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

test('a delivered handout is listed on the My files page and downloads from there', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);

  await page.getByTestId('pro-launch-prompt').click();
  await page.keyboard.type('把光的折射整理成一份讲义');
  await page.getByTestId('pro-launch-start').click();
  await expect(page.getByTestId('zhexu-deliverable-card')).toBeVisible();

  await page.goto('/workspace?view=zhexu-files');
  const files = page.getByTestId('zhexu-files-page');
  await expect(files).toHaveAttribute('data-state', 'ready');
  const entry = files.getByTestId('zhexu-files-entry');
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute('data-kind', 'handout');
  // The stand-in model's fixed title for a handout.
  await expect(entry).toContainText('光的折射 课堂要点');

  const links = await entry.locator('a[download]').evaluateAll((all) =>
    all.map((link) => ({
      href: link.getAttribute('href') ?? '',
      name: link.getAttribute('download') ?? '',
    })),
  );
  expect(links.some((link) => link.name.endsWith('.pdf'))).toBe(true);
  for (const link of links) {
    const response = await page.request.get(link.href);
    expect(response.status(), link.name).toBe(200);
    const head = (await response.body()).subarray(0, 4).toString('latin1');
    if (link.name.endsWith('.pdf')) expect(head, link.name).toBe('%PDF');
  }
  // One conversation: nothing older to load.
  await expect(files.getByTestId('zhexu-files-more')).toHaveCount(0);

  // On a phone the page fits the screen: no sideways scrolling, every
  // download button whole and inside it.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(files).toHaveAttribute('data-state', 'ready');
  await expect(entry).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  for (const link of await entry.locator('a[download]').all()) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
});

test('a visitor with no files sees an empty page', async ({ page }) => {
  await page.goto('/workspace?view=zhexu-files');
  const files = page.getByTestId('zhexu-files-page');
  await expect(files).toHaveAttribute('data-state', 'ready');
  await expect(files.getByTestId('zhexu-files-entry')).toHaveCount(0);
});
