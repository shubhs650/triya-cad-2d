// M6-02 part 17: each layout viewport keeps its own snap and grid spacing (VIEWPORT DXF 14, 15,
// 61), as AutoCAD keeps SNAPUNIT, GRIDUNIT and GRIDMAJOR in the viewport worked in.
// self-authored/viewport-overrides.dxf's Layout1 has four floating viewports (43 top left, 44 top
// right, 45 bottom left, 46 bottom right), each at the file's 10 × 10. SNAP in viewport 43 sets
// 43's alone: the cursor snaps 7 apart there and 10 apart in 44, and paper space keeps its own.
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
const toggle = (page: Page, name: string) =>
  page.getByRole('contentinfo').getByRole('button', { name, exact: true });
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

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

test('SNAP and GRID set the layout viewport worked in, which keeps its own', async ({ page }) => {
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
  /** ID's answer for a click at `p`: where the cursor's snap put the point. */
  const idAt = async (p: { x: number; y: number }) => {
    await type(page, 'ID', 'Specify point:');
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await expect(prompt(page)).toHaveText('Command:');
    const last = (await history(page).textContent()) ?? '';
    const m = [...last.matchAll(/X = (-?[\d.]+)\s+Y = (-?[\d.]+)/g)].at(-1);
    return { x: Number(m?.[1]), y: Number(m?.[2]) };
  };
  const multipleOf = (n: number, step: number) => Math.abs(n / step - Math.round(n / step)) < 1e-6;

  // Object snaps off, so the points the cursor gives are the snap's.
  await toggle(page, 'OSNAP').click();
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'false');
  // Paper space first: its own snap spacing, as the file has it.
  await activeCanvas(page).hover();
  await type(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await type(page, 'SNAPUNIT', 'Enter new value for SNAPUNIT <10.0000,10.0000>:');
  await type(page, '', 'Command:');

  // Viewport 43 made current: SNAP 7 and GRID 14 there, SNAP and GRID on.
  const tl = at('43');
  await page.mouse.dblclick(tl.x, tl.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await type(page, 'SNAP', 'Specify snap spacing or [ON/OFF/Aspect/Type] <10.0000>:');
  await type(page, '7', 'Command:');
  await type(page, 'GRID', /^Specify grid spacing\(X\) or .* <10\.0000>:$/);
  await type(page, '14', 'Command:');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(tl.x + 13, tl.y - 9);
  await expectDrawn(page);
  await shot(page, '1-viewport-43-snap-7-grid-14');
  const a = await idAt({ x: tl.x + 13, y: tl.y - 9 });
  expect(multipleOf(a.x, 7) && multipleOf(a.y, 7), `${a.x}, ${a.y}`).toBe(true);

  // Viewport 44 keeps the file's 10 × 10.
  const tr = at('44');
  await page.mouse.click(tr.x, tr.y);
  await expect.poll(() => viewport(page)).toBe('44');
  await type(page, 'SNAP', 'Specify snap spacing or [ON/OFF/Aspect/Type] <10.0000>:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(tr.x + 13, tr.y - 9);
  await expectDrawn(page);
  await shot(page, '2-viewport-44-keeps-10');
  const b = await idAt({ x: tr.x + 13, y: tr.y - 9 });
  expect(multipleOf(b.x, 10) && multipleOf(b.y, 10), `${b.x}, ${b.y}`).toBe(true);

  // Back in 43, its own still; paper space's untouched.
  await page.mouse.click(tl.x, tl.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await type(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await type(page, 'GRIDUNIT', 'Enter new value for GRIDUNIT <14.0000,14.0000>:');
  await type(page, '', 'Command:');
  await type(page, 'PSPACE', 'Command:');
  await expect.poll(() => viewport(page)).toBe('');
  await type(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await type(page, 'SNAPUNIT', 'Enter new value for SNAPUNIT <10.0000,10.0000>:');
  await type(page, '', 'Command:');
});
