// M2-04: precision input on the canvas, as AutoCAD 2024 behaves. While a command waits for a
// point, AutoSnap marks the running object snap under the aperture and names it, and a click
// takes the marked point; F3 turns object snaps off. POLAR locks the cursor onto the polar
// angles with a "Polar:" tooltip, F8 ORTHO keeps it horizontal or vertical (turning POLAR off),
// and the OSNAP button's menu chooses the modes.
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

test('AutoSnap marks and takes the endpoint; POLAR, ORTHO and F3; the OSNAP menu', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'POLAR')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'ORTHO')).toHaveAttribute('aria-pressed', 'false');

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

  // A few pixels off the line's end: the Endpoint marker, and the click takes the end itself.
  await type(page, 'L', 'Specify first point:');
  await move(X0 + 100, Y0, -4, 3);
  await expect(tip(page)).toHaveText('Endpoint');
  await expect(tip(page)).toHaveAttribute('data-mode', 'END');
  await click(X0 + 100, Y0, -4, 3);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');

  // Near the horizontal from it: polar tracking locks on at 0°.
  await move(X0 + 140, Y0, 0, -3);
  await expect(tip(page)).toHaveText(/^Polar: \d+\.\d{4} < 0°$/);
  await click(X0 + 140, Y0, 0, -3);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');

  // F8: ORTHO on turns POLAR off; a click well off the vertical lands on it.
  await page.keyboard.press('F8');
  await expect(toggle(page, 'ORTHO')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'POLAR')).toHaveAttribute('aria-pressed', 'false');
  await click(X0 + 150, Y0 + 30);
  await type(page, '', 'Command:');

  const lines = await linesAdded(page);
  expect(lines.slice(1)).toHaveLength(2);
  const [first, second] = lines.slice(1) as [number[], number[]];
  expect(first.slice(0, 2)).toEqual([X0 + 100, Y0]);
  expect(first[3]).toBe(Y0);
  // ORTHO from (x, Y0): the vertical, as the cursor is nearer to it than to the horizontal.
  expect(second[2]).toBe(first[2]);
  expect(second[3]!).toBeGreaterThan(Y0 + 20);

  // F3: no object snaps, no marker.
  await page.keyboard.press('F8');
  await page.keyboard.press('F3');
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'L', 'Specify first point:');
  await move(X0 + 100, Y0, -4, 3);
  await move(X0 + 100, Y0, -4, 2);
  await expect(tip(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // The OSNAP menu: a checkbox per mode; choosing Midpoint turns object snaps back on.
  await page.getByRole('button', { name: 'Object snap modes' }).click();
  const menu = page.getByRole('menu', { name: 'Object snap modes' });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(14);
  const mid = menu.getByRole('menuitemcheckbox', { name: 'Midpoint' });
  await expect(mid).toHaveAttribute('aria-checked', 'false');
  await mid.click();
  await expect(mid).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await type(page, 'L', 'Specify first point:');
  await move(X0 + 45, Y0, 0, 3);
  await expect(tip(page)).toHaveText('Midpoint');
  await page.keyboard.press('Escape');
  await expect(activeCanvas(page)).toHaveAttribute('data-picking', 'false');
});
