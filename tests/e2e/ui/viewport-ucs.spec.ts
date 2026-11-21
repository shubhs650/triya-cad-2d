// M6-02 part 20 (M3-15's UCSVP item): a layout viewport made current with its UCSVP on works in
// its own UCS (AutoCAD 2024 Help, "UCSVP": "UCS stored in viewport is independent of the UCS of
// the current viewport"), and a UCS set in it is kept in it. self-authored/viewport-overrides.dxf's
// Layout1 has four floating viewports with UCSVP 0 (DXF 71); in viewport 43 SETVAR UCSVP 1 and UCS
// Z 90 turn the status bar's coordinates there, while viewport 44 and model space keep the WCS.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const viewport = (page: Page) => activeCanvas(page).getAttribute('data-viewport');
const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Each viewport's frame centre on the sheet (paper millimetres). */
const CENTRES = {
  '43': { x: 105, y: 212 },
  '44': { x: 305, y: 212 },
} as const;

test('a viewport keeping its own UCS works in it; the others keep model space’s', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  const v = await viewOf(page);
  const at = (h: keyof typeof CENTRES, dx = 0, dy = 0) => {
    const p = v.at(CENTRES[h].x + dx, CENTRES[h].y + dy);
    return { x: v.box.x + p.x, y: v.box.y + p.y };
  };
  /** The status bar's X and Y with the cursor at `p`. */
  const coordsAt = async (p: { x: number; y: number }) => {
    await page.mouse.move(p.x - 3, p.y);
    await page.mouse.move(p.x, p.y);
    const text = (await page.getByTestId('coords').textContent()) ?? '';
    const [x, y] = text.split(',').map((t) => Number(t.trim()));
    return { x: x!, y: y! };
  };

  // Viewport 43 made current: the WCS, as model space's.
  const tl = at('43', 12, -8);
  await page.mouse.dblclick(tl.x, tl.y);
  await expect.poll(() => viewport(page)).toBe('43');
  const world = await coordsAt(tl);
  // Its UCSVP on, then turned 90° about Z there.
  await type(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await type(page, 'UCSVP', 'Enter new value for UCSVP <0>:');
  await type(page, '1', 'Command:');
  await type(page, 'UCS', /^Specify origin of UCS or \[NAmed/);
  await type(page, 'Z', /^Specify rotation angle about Z axis/);
  await type(page, '90', 'Command:');
  // The point in the turned UCS: X along world Y, Y along world -X.
  await expect
    .poll(async () => {
      const c = await coordsAt(tl);
      return [Math.round(c.x - world.y), Math.round(c.y + world.x)];
    })
    .toEqual([0, 0]);
  await shot(page, '1-viewport-43-own-ucs');

  // Viewport 44 (UCSVP 0) and model space keep the WCS.
  const tr = at('44', 12, -8);
  await page.mouse.click(tr.x, tr.y);
  await expect.poll(() => viewport(page)).toBe('44');
  await type(page, 'UCS', /^Specify origin of UCS or \[NAmed/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Current ucs name:  *WORLD*',
  );
  // Back in 43, its own UCS still.
  await page.mouse.click(tl.x, tl.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await type(page, 'UCS', /^Specify origin of UCS or \[NAmed/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  const c = await coordsAt(tl);
  expect([Math.round(c.x - world.y), Math.round(c.y + world.x)]).toEqual([0, 0]);
});
