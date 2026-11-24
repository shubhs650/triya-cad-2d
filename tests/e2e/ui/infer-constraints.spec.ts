// M9-05 part 7: Infer Constraints (CONSTRAINTINFER). On an empty part of the plan the status
// bar's INFER is off at first; turned on, a line drawn from another line's end (a click the
// running ENDpoint snap takes) and closed takes Coincident at each joint, and RECTANG two
// Parallel and one Perpendicular: DELCONSTRAINT on them counts 7. The Constraint Settings'
// "Infer geometric constraints" shows it on; Ctrl+Shift+I turns it off and the same drawing
// takes none. Which constraints are inferred is tested in
// packages/engine/test/commands/infer-constraints.test.ts and with PlaneGCS in
// packages/constraints/test/infer.test.ts; this checks the status bar, the key, the dialog and
// that a click's object snap reaches the engine.
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
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  await page.locator('#command-input').click();
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Infer Constraints constrains what is drawn from snaps, LINE and RECTANG', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const infer = page.getByRole('contentinfo').getByRole('button', { name: 'INFER', exact: true });
  await expect(infer).toHaveAttribute('aria-pressed', 'false');
  await expect(infer).toHaveAttribute('title', 'Infer Constraints (Ctrl+Shift+I)');
  await infer.click();
  await expect(infer).toHaveAttribute('aria-pressed', 'true');

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  const O = 1000000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 100}`, 'Command:');
  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  /** A line from (20,20) to (60,20), then one from its end (a click) round and closed. */
  const sketch = async (dy: number) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, `${O + 20},${O + 20 + dy}`, 'Specify next point or [Undo]:');
    await type(page, `${O + 60},${O + 20 + dy}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
    await type(page, 'L', 'Specify first point:');
    // The running ENDpoint snap (on at first) takes the click at the first line's end.
    await click(60, 20 + dy);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await type(page, `${O + 75},${O + 35 + dy}`, 'Specify next point or [Undo]:');
    await type(page, `${O + 45},${O + 40 + dy}`, 'Specify next point or [Close/Undo]:');
    await type(page, 'C', 'Command:');
    await type(page, 'RECTANG', /^Specify first corner point/);
    await type(page, `${O + 100},${O + 20 + dy}`, /^Specify other corner point/);
    await type(page, `${O + 140},${O + 40 + dy}`, 'Command:');
  };
  await sketch(0);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  await shot('1-inferred-bars.png');

  /** DELCONSTRAINT on every object: the count it removes. */
  const removed = async (message: string) => {
    await enterCommand(page, 'DELCONSTRAINT');
    await expect(prompt(page)).toHaveText(/^Select objects/);
    await type(page, 'ALL', /^Select objects/);
    await type(page, '', 'Command:');
    await expect(history(page)).toContainText(message, { timeout: 15_000 });
  };
  // Coincident with the first line's end, at the two joints and at Close; RECTANG's three.
  await removed('7 constraints removed.');

  // The dialog shows it on; Ctrl+Shift+I turns it off, and the same sketch takes none.
  await enterCommand(page, 'CONSTRAINTSETTINGS');
  const dialog = page.getByRole('dialog', { name: 'Constraint Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Infer geometric constraints' })).toBeChecked();
  await shot('2-constraint-settings.png');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('#command-input').click();
  await page.keyboard.press('Control+Shift+I');
  await expect(infer).toHaveAttribute('aria-pressed', 'false');
  await sketch(50);
  await enterCommand(page, 'DELCONSTRAINT');
  await type(page, 'ALL', /^Select objects/);
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('0 constraints removed.');
});
