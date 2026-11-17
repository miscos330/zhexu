import { expect, test, type Page } from '@playwright/test';

/**
 * A request for a handout, from the home page to files that download.
 *
 * The stand-in model answers the request by calling the handout tool; everything
 * after that is the real thing: the tool, the renderer, the material store, the
 * card in the conversation and the download route.
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

test('a request for a handout ends in a card whose files download', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);

  await page.getByTestId('pro-launch-prompt').click();
  await page.keyboard.type('把光的折射整理成一份讲义');
  await page.getByTestId('pro-launch-start').click();

  const card = page.getByTestId('zhexu-deliverable-card');
  await expect(card).toBeVisible();

  // The first page shows in the card.
  const preview = card.locator('img').first();
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

  const files = await card.locator('a[download]').evaluateAll((links) =>
    links.map((link) => ({
      href: link.getAttribute('href') ?? '',
      name: link.getAttribute('download') ?? '',
    })),
  );
  expect(files.some((file) => file.name.endsWith('.pdf'))).toBe(true);
  expect(files.some((file) => /\.(png|zip)$/.test(file.name))).toBe(true);

  for (const file of files) {
    const response = await page.request.get(file.href);
    expect(response.status(), file.name).toBe(200);
    const head = (await response.body()).subarray(0, 4).toString('latin1');
    if (file.name.endsWith('.pdf')) expect(head, file.name).toBe('%PDF');
    if (file.name.endsWith('.png')) expect(head, file.name).toBe('\u0089PNG');
    if (file.name.endsWith('.zip')) expect(head.slice(0, 2), file.name).toBe('PK');
  }
});
