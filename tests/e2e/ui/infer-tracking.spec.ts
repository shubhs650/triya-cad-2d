// M9-05 part 8: Infer Constraints from tracking paths. With INFER on, a line placed on the
// PARallel path from a slanted line (the cursor paused on it to acquire it) takes Parallel, and
// a line moved by its end onto object snap tracking's horizontal path from the slanted line's
// end takes Horizontal with that end: DELCONSTRAINT on them counts 2. Which constraints are
// inferred (MOVE, COPY, STRETCH, FILLET, CHAMFER too) is tested in
// packages/engine/test/commands/infer-constraints.test.ts and with PlaneGCS in
// packages/constraints/test/infer.test.ts; this checks that the canvas tells the engine which
// paths a click was placed on, and from which objects.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  enterCommand,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
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
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  await page.locator('#command-input').click();
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Infer Constraints takes Parallel and Horizontal from tracking paths', async ({ page }) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const infer = page.getByRole('contentinfo').getByRole('button', { name: 'INFER', exact: true });
  await infer.click();
  await expect(infer).toHaveAttribute('aria-pressed', 'true');
  /** The running object snaps. */
  const osmode = async (value: number) => {
    await type(page, 'OSMODE', /^Enter new value for OSMODE/);
    await type(page, String(value), 'Command:');
  };

  // An empty part of the plan, 160 × 120 units from (1000000, 1000000), with a slanted line A
  // (20,20)-(60,40) and a level line B (90,70)-(130,70).
  const O = 1000000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 120}`, 'Command:');
  for (const [x1, y1, x2, y2] of [
    [20, 20, 60, 40],
    [90, 70, 130, 70],
  ] as const) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `${O + x1},${O + y1}`, 'Specify next point or [Undo]:');
    await type(page, `${O + x2},${O + y2}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  // PARallel alone (ENDpoint would take A's nearer end, which is not acquired for PARallel):
  // from (20,90), rest on A to acquire it, then run along the Parallel path.
  await osmode(8192);
  await type(page, 'L', 'Specify first point:');
  await type(page, `${O + 20},${O + 90}`, 'Specify next point or [Undo]:');
  await move(40, 30);
  await page.waitForTimeout(800);
  await move(50, 105);
  await expect(tip(page)).toHaveText(/^Parallel: /);
  await click(50, 105);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await type(page, '', 'Command:');

  // ENDpoint: MOVE B by its start onto the horizontal path from A's end (60,40).
  await osmode(1);
  await type(page, 'MOVE', /^Select objects/);
  await click(110, 70);
  await type(page, '', /^Specify base point/);
  await click(90, 70);
  await expect(prompt(page)).toHaveText(/^Specify second point/);
  await move(60, 40);
  await expect(tip(page)).toHaveText('Endpoint');
  await page.waitForTimeout(800);
  await move(100, 40);
  await expect(tip(page)).toHaveText(/^Endpoint: \d+\.\d{4} < 0°$/);
  await click(100, 40);
  await expect(prompt(page)).toHaveText('Command:');
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  await page.screenshot({
    path: shots
      ? path.join(shots, '1-parallel-horizontal-bars.png')
      : test.info().outputPath('1.png'),
  });

  // Parallel and Horizontal.
  await enterCommand(page, 'DELCONSTRAINT');
  await expect(prompt(page)).toHaveText(/^Select objects/);
  await type(page, 'ALL', /^Select objects/);
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('2 constraints removed.', { timeout: 15_000 });
});
