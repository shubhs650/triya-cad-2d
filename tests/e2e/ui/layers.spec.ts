// M1-23: the Layers palette. clockwise_arcs_hatch.dxf has one hatch, on layer HATCH, so turning
// that layer off or freezing it empties the canvas and turning it back on restores it. Each
// toggle is an edit the drawing's engine worker applies (M1-67), and the palette records how
// long toggle → canvas took (acceptance: under 16 ms).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, DXF, expectShown, ink, inkWeight, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function openLayers(page: Page, file: string) {
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  return palette;
}

const toggleMs = async (page: Page) =>
  Number(await page.locator('.layers-palette').getAttribute('data-last-toggle-ms'));

test('turning a layer off and freezing it hide its objects, in under 16 ms', async ({ page }) => {
  const palette = await openLayers(page, DXF);
  const shown = await ink(page);
  const rows = palette.getByRole('table', { name: 'Layers of the drawing' });
  await expect(rows.getByRole('rowheader', { name: 'HATCH', exact: true })).toBeVisible();

  const on = palette.getByRole('button', { name: 'On HATCH' });
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => ink(page)).toBeLessThan(shown / 2);
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ink(page)).toBeGreaterThan(shown * 0.9);

  // Toggle → canvas drawn, over several toggles: the median is the budget (T3 input latency
  // ≤ 16 ms). Most of it is message delivery between the threads, which varies run to run.
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const before = await on.getAttribute('aria-pressed');
    await on.click();
    await expect(on).not.toHaveAttribute('aria-pressed', before!);
    samples.push(await toggleMs(page));
  }
  console.log(`M1-23 toggle → canvas: ${samples.map((s) => s.toFixed(1)).join(', ')} ms`);
  const median = [...samples].sort((a, b) => a - b)[2]!;
  expect(median).toBeLessThan(16);

  // Freeze from the keyboard: every toggle is a button. (HATCH is off after an odd count.)
  await on.click();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  const freeze = palette.getByRole('button', { name: 'Freeze HATCH' });
  await freeze.focus();
  await page.keyboard.press('Space');
  await expect(freeze).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ink(page)).toBeLessThan(shown / 2);
});

test('refuses to freeze the current layer, fades a locked layer, and filters by name', async ({
  page,
}) => {
  const palette = await openLayers(page, DXF);
  const current = palette.locator('tr[data-current="true"] th');
  const name = (await current.textContent())!;
  await palette.getByRole('button', { name: `Freeze ${name}`, exact: true }).click();
  await expect(palette.getByRole('alert')).toHaveText('Cannot freeze the current layer.');

  // Lock keeps the hatch on screen, faded by LAYLOCKFADECTL (50 by default, M1-69): the same
  // pixels at about half strength. The hatch's own share is measured against HATCH off, since
  // the canvas screenshot also holds the navigation bar.
  const shown = await ink(page);
  const on = palette.getByRole('button', { name: 'On HATCH' });
  await on.click();
  await expect.poll(() => ink(page)).toBeLessThan(shown / 2);
  const bare = await inkWeight(page);
  await on.click();
  await expect.poll(() => ink(page)).toBeGreaterThan(shown * 0.9);
  const full = (await inkWeight(page)) - bare;
  const lock = palette.getByRole('button', { name: 'Lock HATCH' });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => inkWeight(page)).toBeLessThan(bare + full * 0.7);
  expect(await ink(page)).toBeGreaterThan(shown * 0.9);
  expect((await inkWeight(page)) - bare).toBeGreaterThan(full * 0.3);
  await lock.click();
  await expect.poll(() => inkWeight(page)).toBeGreaterThan(bare + full * 0.9);

  await palette.getByRole('searchbox', { name: 'Search for layer' }).fill('hat');
  await expect(palette.getByRole('rowheader')).toHaveText(['HATCH']);

  await palette.getByRole('button', { name: 'Close Layers' }).click();
  await expect(palette).toBeHidden();
});

test('a layout shows how many of its viewports freeze each layer', async ({ page }) => {
  const palette = await openLayers(page, DWG);
  await expect(palette.getByRole('columnheader', { name: 'VP Freeze' })).toHaveCount(0);
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(palette.getByRole('columnheader', { name: 'VP Freeze' })).toBeVisible();
  await expect(palette.locator('td.vp-freeze').first()).toHaveText(/^(\d+ of \d+|—)$/);
});

test('shows each layer’s description (M1-104)', async ({ page }) => {
  const palette = await openLayers(page, DWG);
  await expect(palette.getByRole('columnheader', { name: 'Description' })).toBeVisible();
  const row = palette.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Layer_desc', exact: true }),
  });
  await expect(row.locator('td.description')).toHaveText("This layer has it's own description");
});
