// M2-23: undo in the app. Ctrl+Z runs U and Ctrl+Y REDO on the drawing shown; the title bar's
// Quick Access Undo and Redo buttons follow the drawing's undo history, named by the step each
// would undo or redo; an undo shows a toast with what it did and how many steps are left; and a
// layer freeze from the Layers palette is a step of its own, which U undoes.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DXF, expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

interface DevHooks {
  changes(): readonly ChangeSet[];
}

/** The LINE entities the drawing's commands added and did not take away, by handle. */
async function linesAdded(page: Page): Promise<string[]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: DevHooks }).triyaDev.changes(),
  );
  const added = new Set<string>();
  for (const cs of changes) {
    for (const { entity } of cs.entities?.removed ?? []) added.delete(entity.handle);
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind === 'LINE') added.add(entity.handle);
    }
  }
  return [...added];
}

const prompt = (page: Page) => page.getByTestId('command-prompt');
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });
const toast = (page: Page) => page.getByTestId('undo-toast');

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
}

/** Draws a line typed at the command line, from `a` to `b`. */
async function line(page: Page, a: string, b: string): Promise<void> {
  await page.keyboard.type('L');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify first point:');
  for (const p of [a, b]) {
    await page.keyboard.type(p);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
}

test('draw two lines: Ctrl+Z removes the second, Ctrl+Y restores it', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await expect(undoButton(page)).toBeDisabled();
  await expect(undoButton(page)).toHaveAttribute('title', 'Nothing to undo');
  await expect(redoButton(page)).toBeDisabled();

  await line(page, '0,0', '@100<0');
  const [first] = await linesAdded(page);
  await line(page, '0,10', '@100<0');
  const two = await linesAdded(page);
  expect(two).toHaveLength(2);
  await expect(undoButton(page)).toBeEnabled();
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo LINE (Ctrl+Z)');

  await page.keyboard.press('Control+z');
  await expect.poll(() => linesAdded(page)).toEqual([first]);
  await expect(toast(page)).toHaveText('Undone: LINE · 1 more to undo');
  await expect(redoButton(page)).toBeEnabled();
  await expect(redoButton(page)).toHaveAttribute('title', 'Redo LINE (Ctrl+Y)');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('LINE');

  await page.keyboard.press('Control+y');
  await expect.poll(() => linesAdded(page)).toEqual(two);
  await expect(toast(page)).toHaveText('Redone: LINE');
  await expect(redoButton(page)).toBeDisabled();

  // The buttons do the same, and the toast goes after a while.
  await undoButton(page).click();
  await expect.poll(() => linesAdded(page)).toEqual([first]);
  await redoButton(page).click();
  await expect.poll(() => linesAdded(page)).toEqual(two);
  await expect(toast(page)).toBeHidden({ timeout: 5000 });
});

test('Ctrl+Z in the middle of LINE ends it and undoes all of it', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await page.keyboard.type('L');
  await page.keyboard.press('Enter');
  for (const p of ['0,0', '@50<0', '@50<90']) {
    await page.keyboard.type(p);
    await page.keyboard.press('Enter');
  }
  await expect.poll(async () => (await linesAdded(page)).length).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => linesAdded(page)).toEqual([]);
  await expect(prompt(page)).toHaveText('Command:');
});

test('Ctrl+Z with text typed at the command line undoes the text, not the drawing', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  await line(page, '0,0', '@100<0');
  await page.keyboard.type('CIR');
  await page.keyboard.press('Control+z');
  // The browser's own undo took the typing; the line is still there.
  expect(await linesAdded(page)).toHaveLength(1);
  await expect(undoButton(page)).toBeEnabled();
});

test('a layer freeze is undone by U', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const shown = await ink(page);
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  const freeze = palette.getByRole('button', { name: 'Freeze HATCH' });
  await freeze.click();
  await expect(freeze).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ink(page)).toBeLessThan(shown / 2);
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo LAYER (Ctrl+Z)');

  await page.getByLabel('Command', { exact: true }).focus();
  await page.keyboard.type('U');
  await page.keyboard.press('Enter');
  await expect(freeze).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => ink(page)).toBeGreaterThan(shown * 0.9);
  await expect(toast(page)).toHaveText('Undone: LAYER · nothing more to undo');

  await page.keyboard.press('Control+y');
  await expect(freeze).toHaveAttribute('aria-pressed', 'true');
});
