// M3-02 part 5: PEDIT, CHPROP and MATCHPROP with its Property Settings dialog, from the app's
// canvas. On an empty part of the plan a zigzag polyline and a line are drawn. PEDIT turns the
// polyline into a spline-fit one; CHPROP makes the line red; MATCHPROP takes the line as its
// source, opens Property Settings (Esc goes back to the prompt, OK keeps what was unticked) and
// gives the spline the line's colour, the canvas's cursor carrying the paintbrush meanwhile. The prompts and geometry are unit-tested in
// packages/engine/test (commands/pedit.test.ts, commands/chprop.test.ts,
// commands/matchprop.test.ts, edit/pedit.test.ts); this checks that the app's canvas, bus,
// engine worker and the dialog carry them.
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

/** The session's objects: type, colour, fitting and vertex count. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const now = new Map<string, { type: string; color: unknown; geom: unknown }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) now.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (now.has(u.after.handle)) now.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) now.delete(r.entity.handle);
    }
    return [...now.values()].map((e) => {
      const g = e.geom as { fit?: string; vertices?: unknown[] };
      return { type: e.type, color: e.color, fit: g.fit, vertices: g.vertices?.length };
    });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const DESTINATION = 'Select destination object(s) or [Settings]:';

test('PEDIT Spline, CHPROP and MATCHPROP with Property Settings', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // An empty part of the plan, 140 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000140,1000100', 'Command:');
  await type(page, 'PL', 'Specify start point:');
  for (const p of ['10,20', '40,60', '70,20', '100,60', '130,20']) {
    await type(
      page,
      `#${1000000 + Number(p.split(',')[0])},${1000000 + Number(p.split(',')[1])}`,
      /^Specify next point/,
    );
  }
  await type(page, '', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000010,1000085', /^Specify next point/);
  await type(page, '#1000130,1000085', /^Specify next point/);
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).map((e) => e.type))
    .toEqual(['LWPOLYLINE', 'LINE']);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  // PEDIT: the click on the polyline, then Spline.
  await type(page, 'PE', 'Select polyline or [Multiple]:');
  await click(25, 40);
  await expect(prompt(page)).toHaveText(/^Enter an option \[Close\/Join\/Width\/Edit vertex/);
  await type(page, 'S', /^Enter an option \[Close\/Join/);
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).find((e) => e.type === 'POLYLINE'))
    .toMatchObject({ fit: 'cubic', vertices: 33 });

  // CHPROP: the line red.
  await type(page, 'CHPROP', 'Select objects:');
  await click(70, 85);
  await type(page, '', /^Enter property to change \[Color\/LAyer/);
  await type(page, 'C', 'New color [Truecolor/COlorbook] <BYLAYER>:');
  await type(page, 'red', /^Enter property to change/);
  await type(page, '', 'Command:');

  // MATCHPROP: the line is the source; Settings opens Property Settings.
  await type(page, 'MA', 'Select source object:');
  await click(70, 85);
  await expect(prompt(page)).toHaveText(DESTINATION);
  // The paintbrush beside the crosshairs while destinations are picked (M3-16).
  const canvas = page.locator('canvas[data-cursor]').first();
  await expect(canvas).toHaveAttribute('data-cursor', / paintbrush$/);
  await page.keyboard.type('S');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Property Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Color' })).toBeChecked();
  // Viewport is copied (M3-16), Table too (M4-05 part 5), and Center object (M4-08 part 3).
  await expect(dialog.getByRole('checkbox', { name: 'Viewport' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Table' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Center object' })).toBeEnabled();
  await expect(dialog.getByRole('checkbox', { name: 'Center object' })).toBeChecked();
  // Esc goes back to the prompt with the settings as they were.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText(DESTINATION);
  await page.keyboard.type('S');
  await page.keyboard.press('Enter');
  await dialog.getByRole('checkbox', { name: 'Lineweight' }).uncheck();
  await page.screenshot({ path: test.info().outputPath('2-property-settings.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText(DESTINATION);
  // The spline-fit polyline PEDIT made is the last object.
  await type(page, 'L', DESTINATION);
  await type(page, '', 'Command:');
  await expect(canvas).not.toHaveAttribute('data-cursor', / paintbrush$/);
  await expect
    .poll(async () => (await drawn(page)).find((e) => e.type === 'POLYLINE')?.color)
    .toEqual({ kind: 'aci', index: 1 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('3-after.png') });
});
