import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * An attached image, annotated and exported.
 *
 * The stand-in model lists the materials, looks at the image and calls the
 * annotation tool with four fixed notes. The upload, the image the model is
 * shown, the renderer, the store, the card and the download route are real.
 */

const IMAGE = join(__dirname, '..', 'fixtures', 'cell-diagram.png');

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

test('an attached image comes back annotated, as files that download', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ws-root').waitFor();
  await dismissTour(page);

  // The file input sits right before the attach button and is hidden.
  const uploaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/materials' &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await page
    .getByTestId('pro-launch-attach')
    .locator('xpath=preceding::input[@type="file"][1]')
    .setInputFiles(IMAGE);
  await uploaded;

  await page.getByTestId('pro-launch-prompt').click();
  await page.keyboard.type('给这张图加上标注');
  await page.getByTestId('pro-launch-start').click();

  const card = page.getByTestId('zhexu-deliverable-card');
  await expect(card).toBeVisible();

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
  expect(files.some((file) => file.name.endsWith('.png'))).toBe(true);
  expect(files.some((file) => file.name.endsWith('.pdf'))).toBe(true);

  for (const file of files) {
    const response = await page.request.get(file.href);
    expect(response.status(), file.name).toBe(200);
    const head = (await response.body()).subarray(0, 4).toString('latin1');
    if (file.name.endsWith('.pdf')) expect(head, file.name).toBe('%PDF');
    if (file.name.endsWith('.png')) expect(head, file.name).toBe('\u0089PNG');
  }
});
