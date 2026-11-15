// M3-02 part 6: SPLINEDIT and OVERKILL with its Delete Duplicate Objects dialog, from the app's
// canvas. On an empty part of the plan a spline is drawn through four points and a line is
// drawn twice. SPLINEDIT moves the spline's second fit point; OVERKILL, on a window round both,
// opens Delete Duplicate Objects (its polyline sub-options greyed when Optimize is off; Esc
// cancels the command) and, on OK, deletes the second line. The prompts and geometry are
// unit-tested in packages/engine/test (commands/splinedit.test.ts, commands/overkill.test.ts,
// edit/splinedit.test.ts); this checks that the app's canvas, bus, engine worker and the dialog
// carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The session's objects: type and fit points. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const now = new Map<string, { type: string; geom: unknown }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) now.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (now.has(u.after.handle)) now.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) now.delete(r.entity.handle);
    }
    return [...now.values()].map((e) => {
      const g = e.geom as { fitPoints?: { x: number; y: number }[] };
      return { type: e.type, fit: g.fitPoints?.map((p) => [p.x - 1000000, p.y - 1000000]) };
    });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const at = (x: number, y: number) => `#${1000000 + x},${1000000 + y}`;

test('SPLINEDIT moves a fit point; OVERKILL deletes a duplicate line', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // An empty part of the plan, 140 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000140,1000100', 'Command:');
  await type(page, 'SPL', /^Specify first point or/);
  for (const [x, y] of [
    [10, 20],
    [40, 60],
    [70, 20],
    [100, 60],
  ]) {
    await type(page, at(x!, y!), /^Enter next point/);
  }
  await type(page, '', 'Command:');
  for (let i = 0; i < 2; i++) {
    await type(page, 'L', 'Specify first point:');
    await type(page, at(10, 85), /^Specify next point/);
    await type(page, at(130, 85), /^Specify next point/);
    await type(page, '', 'Command:');
  }
  await expect
    .poll(async () => (await drawn(page)).map((e) => e.type))
    .toEqual(['SPLINE', 'LINE', 'LINE']);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  // SPLINEDIT: the click on the spline at a fit point, Fit data, Move, Next, a new place.
  await type(page, 'SPLINEDIT', 'Select spline:');
  await click(70, 20);
  await expect(prompt(page)).toHaveText(
    'Enter an option [Close/Join/Fit data/Edit vertex/convert to Polyline/Reverse/Undo/eXit] <eXit>:',
  );
  await type(page, 'F', /^Enter a fit data option \[Add\/Close\/Delete\/Kink\/Move/);
  await type(page, 'M', 'Specify new location or [Next/Previous/Select point/eXit] <N>:');
  await type(page, 'N', 'Specify new location or [Next/Previous/Select point/eXit] <N>:');
  await type(page, at(40, 80), 'Specify new location or [Next/Previous/Select point/eXit] <N>:');
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('2-fit-point-moved.png') });
  await type(page, 'X', /^Enter a fit data option/);
  await type(page, 'X', /^Enter an option/);
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).find((e) => e.type === 'SPLINE')?.fit)
    .toEqual([
      [10, 20],
      [40, 80],
      [70, 20],
      [100, 60],
    ]);

  // OVERKILL on a window round everything drawn; Esc at the dialog cancels.
  const select = async () => {
    await type(page, 'OVERKILL', 'Select objects:');
    await click(2, 2);
    await click(138, 98);
    await expect(prompt(page)).toHaveText('Select objects:');
    await page.keyboard.press('Enter');
  };
  await select();
  const dialog = page.getByRole('dialog', { name: 'Delete Duplicate Objects' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Tolerance:' })).toHaveValue('0.000001');
  await expect(
    dialog.getByRole('checkbox', { name: 'Optimize segments within polylines' }),
  ).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Maintain associative objects' }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await select();
  await dialog.getByRole('checkbox', { name: 'Optimize segments within polylines' }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: 'Do not break polylines' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Color' }).check();
  await page.screenshot({ path: test.info().outputPath('3-delete-duplicate-objects.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await drawn(page)).map((e) => e.type)).toEqual(['SPLINE', 'LINE']);
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
