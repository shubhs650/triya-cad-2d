// M2-30 part 3: the Health palette's Dimensions card, the stored-block health check (DEC-011)
// in the app. The acadsharp R12 sample's dimensions name no dimension style, so several of
// their blocks (drawn in ISO-25) differ from what the engine draws in STANDARD (DEC-050's
// legacy file): the card lists them, and Zoom shows one. A dimension drawn in the app gets a
// block the engine drew, so the count checked grows while the differing ones stay. ezdxf's
// duplicate_handles.dxf holds dimensions with no block at all. The check itself is unit-tested
// in packages/dims/test/parts.test.ts and over the corpus in dims-health.corpus.test.ts.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, expectShown, openWithPicker, worldAt } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const R12 = path.join(CORPUS, 'acadsharp/sample_AC1009_ascii.dxf');
const BLOCKLESS = path.join(CORPUS, 'ezdxf/integration_tests/duplicate_handles.dxf');

async function open(page: Page, file: string) {
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
}

const card = (page: Page) =>
  page.getByRole('complementary', { name: 'Health' }).getByRole('group', { name: /^Dimensions/ });

async function openHealth(page: Page) {
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Health' })
    .click();
  await expect(card(page)).toBeVisible();
}

/** "n dimensions checked: …" as a number. */
async function checked(page: Page): Promise<number> {
  const text = await card(page)
    .getByText(/dimensions? checked/)
    .innerText();
  return Number(/^(\d+)/.exec(text)?.[1]);
}

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('lists the dimensions whose stored block differs, zooms to one, and follows edits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, R12);
  await openHealth(page);
  const dims = card(page);
  await expect(dims.locator('summary')).toHaveText(/^Dimensions \(\d+\)$/);
  const count = Number(/\((\d+)\)/.exec(await dims.locator('summary').innerText())?.[1]);
  expect(count).toBeGreaterThan(0);
  const table = dims.getByRole('table', { name: 'Dimensions that differ' });
  await expect(table.locator('tbody tr')).toHaveCount(count);
  await expect(dims).toContainText(`${count} stored blocks differ from what Triya draws`);
  const before = await checked(page);
  expect(before).toBeGreaterThanOrEqual(count);
  // Handle 514 is a linear dimension in model space; its dimension line sits apart from the
  // engine's by DIMSTYLE values the R12 file does not carry.
  const row = table.getByRole('row', { name: /^514 / });
  await expect(row).toContainText('Linear, Model');
  await expect(row).toContainText(/off/);
  const box = (await activeCanvas(page).boundingBox())!;
  await row.scrollIntoViewIfNeeded();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.screenshot({ path: test.info().outputPath('1-dimensions-card.png') });

  const centre = () => worldAt(page, Math.round(box.width / 2), Math.round(box.height / 2));
  const was = await centre();
  await row.getByRole('button', { name: 'Zoom to dimension 514' }).click();
  await expect.poll(async () => (await centre()).x).not.toBeCloseTo(was.x, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.screenshot({ path: test.info().outputPath('2-zoomed-to-514.png') });

  // A new dimension, far from the drawing: its block is the engine's, so it matches.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'LINE', 'Specify first point:');
  await type(page, '5000,5000', 'Specify next point or [Undo]:');
  await type(page, '5100,5000', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, '5000,5000', 'Specify second extension line origin:');
  await type(page, '5100,5000', /^Specify dimension line location/);
  await type(page, '5050,4980', 'Command:');
  await expect.poll(() => checked(page)).toBe(before + 1);
  await expect(table.locator('tbody tr')).toHaveCount(count);
});

test('counts dimensions without a stored block, which a save gives one', async ({ page }) => {
  await open(page, BLOCKLESS);
  await openHealth(page);
  const dims = card(page);
  await expect(dims).toContainText(
    '7 dimensions without a stored block: Triya draws them, and saving gives them one.',
  );
  await expect(dims.locator('summary')).toHaveText('Dimensions (0)');
  await page.screenshot({ path: test.info().outputPath('3-blockless.png') });
});
