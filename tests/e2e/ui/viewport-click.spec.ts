// M6-02 part 9: a single click into another layout viewport. self-authored/viewport-overrides.dxf's
// Layout1 has four floating viewports (handles 43 top left, 44 top right, 45 bottom left, 46
// bottom right). Once one is current, a click inside another makes that one current, at
// Command: and inside a command, which goes on there (AutoCAD 2024 Help, "To Make a Layout
// Viewport Current": "click inside its border"); a double click in another viewport is the
// switch alone, and a click on the sheet between them does nothing. The grid shows through the
// viewport worked in.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
  viewOf,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** The viewport the canvas works in (its handle), '' in paper space. */
const viewport = (page: Page) => activeCanvas(page).getAttribute('data-viewport');
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Each viewport's frame centre on the sheet (paper millimetres). */
const CENTRES = {
  '43': { x: 105, y: 212 },
  '44': { x: 305, y: 212 },
  '45': { x: 105, y: 80 },
  '46': { x: 305, y: 80 },
} as const;

test('a click in another layout viewport makes it current, inside a command too', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  // Screen points of the sheet, read while paper space is worked in.
  const v = await viewOf(page);
  const click = async (h: keyof typeof CENTRES, dx = 0, dy = 0) => {
    const p = v.at(CENTRES[h].x + dx, CENTRES[h].y + dy);
    await page.mouse.click(v.box.x + p.x, v.box.y + p.y);
  };

  // A double click works in the top-left viewport.
  const tl = v.at(CENTRES['43'].x, CENTRES['43'].y);
  await page.mouse.dblclick(v.box.x + tl.x, v.box.y + tl.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await expect(page.getByTestId('space')).toHaveText('MODEL');

  // A single click in another viewport makes it current, and picks nothing: no window opens.
  await click('44');
  await expect.poll(() => viewport(page)).toBe('44');
  await expect(prompt(page)).toHaveText('Command:');
  await click('45');
  await expect.poll(() => viewport(page)).toBe('45');
  await expect(prompt(page)).toHaveText('Command:');

  // A click on the sheet between the viewports does nothing.
  await click('43', 0, -70);
  await expectInputsRead(page);
  expect(await viewport(page)).toBe('45');
  await expect(prompt(page)).toHaveText('Command:');

  // A double click in another viewport is the switch alone: no editor, no window.
  const br = v.at(CENTRES['46'].x, CENTRES['46'].y);
  await page.mouse.dblclick(v.box.x + br.x, v.box.y + br.y);
  await expect.poll(() => viewport(page)).toBe('46');
  await expectInputsRead(page);
  await expect(prompt(page)).toHaveText('Command:');

  // Inside LINE: the first point in the bottom-right viewport, a click in the top-left one
  // switches to it, and the line ends there.
  await enterCommand(page, 'LINE');
  await expect(prompt(page)).toHaveText(/^Specify first point/);
  await click('46', 10, 10);
  await expect(prompt(page)).toHaveText(/^Specify next point/);
  await click('43');
  await expect.poll(() => viewport(page)).toBe('43');
  await expect(prompt(page)).toHaveText(/^Specify next point/);
  await click('43', 20, 20);
  await expect(prompt(page)).toHaveText(/^Specify next point/);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');

  // The grid (F7) shows through the viewport worked in.
  await page.keyboard.press('F7');
  const mid = v.at(205, 146);
  await page.mouse.move(v.box.x + mid.x, v.box.y + mid.y);
  await page.screenshot({ path: test.info().outputPath('viewport-grid.png') });
});
