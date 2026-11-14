// M2-02: the command line drives the drawing's command engine (in the engine worker). The
// roadmap's acceptance script `L ↵ 0,0 ↵ @100<45 ↵ ↵` draws the line; the canvas picks points
// for a command waiting at one; the prompt's options are chips; commands complete as typed;
// Up recalls; F2 shows the whole history.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DXF, activeCanvas, expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

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

/** The LINE entities the drawing's commands added, as [x1, y1, x2, y2] to 4 places. */
async function linesAdded(page: Page): Promise<number[][]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: DevHooks }).triyaDev.changes(),
  );
  const added = new Map<string, number[]>();
  for (const cs of changes) {
    for (const { entity } of cs.entities?.removed ?? []) added.delete(entity.handle);
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind !== 'LINE') continue;
      const { start, end } = entity.geom;
      added.set(
        entity.handle,
        [start.x, start.y, end.x, end.y].map((v) => Math.round(v * 1e4) / 1e4),
      );
    }
  }
  return [...added.values()];
}

const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
}

test('L ↵ 0,0 ↵ @100<45 ↵ ↵ draws the line', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await expect(prompt(page)).toHaveText('Command:');
  // Typed with the focus on nothing in particular: keys go to the command line.
  await page.keyboard.type('L');
  await expect(page.getByLabel('Command', { exact: true })).toHaveValue('L');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await page.keyboard.type('0,0');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await page.keyboard.type('@100<45');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const r = Math.round(Math.SQRT1_2 * 100 * 1e4) / 1e4;
  expect(await linesAdded(page)).toEqual([[0, 0, r, r]]);
  await expect(history(page)).toContainText('Specify next point or [Undo]: @100<45');
});

test('a command waiting for points takes clicks, and options are chips', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const before = await ink(page);
  await page.keyboard.type('line ');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(canvas).toHaveAttribute('data-picking', 'true');
  const at = (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await at(0.2, 0.2);
  await at(0.8, 0.2);
  await at(0.8, 0.8);
  const close = page
    .getByRole('region', { name: 'Command line' })
    .getByRole('button', { name: 'Close', exact: true });
  await expect(prompt(page)).toHaveText('Specify next point or [Close/Undo]:');
  await close.click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect(canvas).toHaveAttribute('data-picking', 'false');
  expect(await linesAdded(page)).toHaveLength(3);
  await expect.poll(() => ink(page)).toBeGreaterThan(before);
});

test('Esc cancels and keeps the segments drawn; Up recalls; F2 shows the history', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  const input = page.getByLabel('Command', { exact: true });
  await input.click();
  await page.keyboard.type('LI');
  await expect(page.getByRole('listbox', { name: 'Matching commands' })).toContainText('LINE');
  await page.keyboard.press('Tab');
  await expect(input).toHaveValue('LINE');
  for (const t of ['', '1,1', '2,2', '3,1']) {
    if (t) await page.keyboard.type(t);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(history(page)).toContainText('*Cancel*');
  expect(await linesAdded(page)).toEqual([
    [1, 1, 2, 2],
    [2, 2, 3, 1],
  ]);
  await input.click();
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('3,1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('F2');
  const full = page.getByRole('dialog', { name: 'Command history' });
  await expect(full).toContainText('Command: LINE');
  await expect(full).toContainText('Specify first point: 1,1');
  await page.keyboard.press('F2');
  await expect(full).toBeHidden();
});

/** Key events for `text`, `\n` for Enter, as the browser's input queue gets them from a keyboard. */
interface KeyEvent {
  type: 'keyDown' | 'keyUp';
  key: string;
  code?: string;
  windowsVirtualKeyCode: number;
  text?: string;
}

function keyEvents(text: string): KeyEvent[] {
  const out: KeyEvent[] = [];
  for (const ch of text) {
    const key =
      ch === '\n'
        ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }
        : ch === ' '
          ? { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }
          : { key: ch, text: ch, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) };
    const { text: _typed, ...up } = key;
    out.push({ type: 'keyDown', ...key }, { type: 'keyUp', ...up });
  }
  return out;
}

test('input typed ahead of a prompt is read by the prompt it reaches (M2-47 part 3)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  await expect(prompt(page)).toHaveText('Command:');
  await page.getByLabel('Command', { exact: true }).click();
  // Every key queued at once, as a fast typist's keys reach the page while the engine worker
  // is still answering the one before: the command line cannot know at a space's key press
  // whether the prompt it reaches takes spaces. A name's space is typed; -VIEW's ends it.
  const cdp = await page.context().newCDPSession(page);
  const typed = '-VIEW\nS\nTwo words\n-VIEW S Three words\n';
  await Promise.all(keyEvents(typed).map((e) => cdp.send('Input.dispatchKeyEvent', e)));
  await expect(history(page)).toContainText('Enter view name to save: Three words');
  await expect(prompt(page)).toHaveText('Command:');
  await page.getByRole('button', { name: 'Views' }).click();
  const views = page.getByRole('group', { name: 'Named views' });
  await expect(views.getByRole('button', { name: 'Two words' })).toBeVisible();
  await expect(views.getByRole('button', { name: 'Three words' })).toBeVisible();
  await expect(views.getByRole('listitem')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('typed-ahead-views.png') });
});
