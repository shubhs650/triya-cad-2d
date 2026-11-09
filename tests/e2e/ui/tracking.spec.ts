// M2-04 part 2: object snap overrides and tracking on the canvas, as AutoCAD 2024 behaves.
// A typed override (`MID`) asks "of" and snaps the next point with its own modes, refusing a
// click it finds nothing at; Shift+right-click opens the same overrides as a menu. Pausing on
// an endpoint acquires it for object snap tracking, and the cursor then runs along the path
// from it ("Endpoint: d < 270°"). Tab steps through the snap points under the cursor. F7
// draws the grid; F11, LWT and TPY toggle on the status bar.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const tip = (page: Page) => page.getByTestId('autosnap-tip');
const toggle = (page: Page, name: string) =>
  page.getByRole('contentinfo').getByRole('button', { name, exact: true });

async function type(page: Page, text: string, next: string): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The LINE entities the drawing's commands added, as [x1, y1, x2, y2] to 4 places. */
async function linesAdded(page: Page): Promise<number[][]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );
  const out: number[][] = [];
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind !== 'LINE') continue;
      const { start, end } = entity.geom;
      out.push([start.x, start.y, end.x, end.y].map((v) => Math.round(v * 1e4) / 1e4));
    }
  }
  return out;
}

const X0 = 1_000_000;
const Y0 = 1_000_000;

test('typed and menu overrides, OTRACK from an acquired endpoint, Tab, GRID and the toggles', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(toggle(page, 'OTRACK')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'false');

  // An empty part of the plan, with one line typed across it.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, `${X0},${Y0 - 50}`, 'Specify opposite corner:');
  await type(page, `${X0 + 160},${Y0 + 50}`, 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, `${X0},${Y0}`, 'Specify next point or [Undo]:');
  await type(page, `${X0 + 100},${Y0}`, 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');

  const view = await viewOf(page);
  const box = view.box;
  const move = (x: number, y: number, dx = 0, dy = 0) => {
    const p = view.at(x, y);
    return page.mouse.move(box.x + p.x + dx, box.y + p.y + dy);
  };
  const click = (x: number, y: number, dx = 0, dy = 0) => {
    const p = view.at(x, y);
    return page.mouse.click(box.x + p.x + dx, box.y + p.y + dy);
  };

  // MID typed: "of", the Midpoint marker (not a running mode), and the click takes it.
  await type(page, 'L', 'Specify first point:');
  await type(page, 'mid', 'of');
  await move(X0 + 50, Y0, 6, 3);
  await expect(tip(page)).toHaveText('Midpoint');
  await click(X0 + 50, Y0, 6, 3);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  // END typed, then a click on empty paper: refused, and "of" asked again.
  await type(page, 'end', 'of');
  await click(X0 + 130, Y0 + 40);
  await expect(page.getByRole('region', { name: 'Command line' })).toContainText('Invalid point.');
  await expect(prompt(page)).toHaveText('of');
  await type(page, '@0,20', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  expect((await linesAdded(page)).at(-1)).toEqual([X0 + 50, Y0, X0 + 50, Y0 + 20]);

  // Shift+right-click: the override menu; Midpoint asks "of".
  await type(page, 'L', 'Specify first point:');
  await move(X0 + 120, Y0 + 30);
  await page.keyboard.down('Shift');
  await page.mouse.click(
    box.x + view.at(X0 + 120, Y0 + 30).x,
    box.y + view.at(X0 + 120, Y0 + 30).y,
    {
      button: 'right',
    },
  );
  await page.keyboard.up('Shift');
  const menu = page.getByRole('menu', { name: 'Object snap overrides' });
  await expect(menu.getByRole('menuitem')).toHaveCount(17);
  await menu.getByRole('menuitem', { name: 'Midpoint' }).click();
  await expect(menu).toBeHidden();
  await expect(prompt(page)).toHaveText('of');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // OTRACK: rest on the line's end to acquire it, then run straight down from it.
  await type(page, 'L', 'Specify first point:');
  await move(X0 + 100, Y0, -3, 2);
  await expect(tip(page)).toHaveText('Endpoint');
  await page.waitForTimeout(800);
  await move(X0 + 100, Y0 - 30, 4, 0);
  await expect(tip(page)).toHaveText(/^Endpoint: \d+\.\d{4} < 270°$/);
  await expect(tip(page)).toHaveAttribute('data-mode', 'track');
  await click(X0 + 100, Y0 - 30, 4, 0);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await type(page, `${X0 + 100},${Y0}`, 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  const tracked = (await linesAdded(page)).at(-1)!;
  expect(tracked[0]).toBe(X0 + 100);
  expect(tracked[1]!).toBeLessThan(Y0 - 20);

  // Tab: where that line meets the first, Endpoint and Intersection; Tab steps to the other.
  await type(page, 'L', 'Specify first point:');
  await move(X0 + 100, Y0, -3, -3);
  await expect(tip(page)).toHaveText('Endpoint');
  await page.keyboard.press('Tab');
  await expect(tip(page)).toHaveText('Intersection');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // F7 draws the grid; F11 turns OTRACK off; LWT and TPY toggle.
  const before = await activeCanvas(page).screenshot();
  await page.keyboard.press('F7');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await activeCanvas(page).screenshot()).equals(before)).toBe(false);
  await page.keyboard.press('F7');
  await page.keyboard.press('F11');
  await expect(toggle(page, 'OTRACK')).toHaveAttribute('aria-pressed', 'false');
  const lwt = await toggle(page, 'LWT').getAttribute('aria-pressed');
  await toggle(page, 'LWT').click();
  await expect(toggle(page, 'LWT')).toHaveAttribute('aria-pressed', String(lwt !== 'true'));
  await expect(toggle(page, 'TPY')).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, 'TPY').click();
  await expect(toggle(page, 'TPY')).toHaveAttribute('aria-pressed', 'false');
});
