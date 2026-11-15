// M3-01 part 6 from the app's canvas: ARC's dragged arc switching direction while Ctrl is held
// and a Ctrl+click drawing it clockwise; ELLIPSE with PELLIPSE 1 making a polyline; and DDPTYPE's
// Point Style dialog (opened, styles picked with the arrow keys and the mouse, the size made
// absolute, OK; Esc cancelling), the point drawn with the style it set. Every method's geometry
// is unit-tested in packages/engine/test/commands (arc-direction, ellipse, point); this checks
// that the canvas, the bus, the engine worker and the dialog carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import path from 'node:path';
import { DXF, expectShown, lightPixels, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The entities this test added, in order. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((e) => ({ type: e.type, geom: e.geom }));
  });

/** The header variables the session set, by name, last value. */
const headerSet = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, unknown> = {};
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const h of cs.header ?? []) out[h.name] = h.after;
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const X0 = 1000000;
const Y0 = 1000000;
const CTRL = ' (hold Ctrl to switch direction)';

test('ARC switched with Ctrl, PELLIPSE 1, and the Point Style dialog', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // An empty part of the plan, 140 × 100 units.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0},${Y0}`, 'Specify opposite corner:');
  await type(page, `${X0 + 140},${Y0 + 100}`, 'Command:');
  // The canvas's scale, from the coordinates shown at two cursor positions.
  const w1 = await worldAt(page, 100, 100);
  const w2 = await worldAt(page, 300, 100);
  const s = (w2.x - w1.x) / 200;
  /** Canvas CSS pixels of a point given from the corner X0, Y0. */
  const px = (x: number, y: number) => ({
    x: 100 + (X0 + x - w1.x) / s,
    y: 100 - (Y0 + y - w1.y) / s,
  });
  const box = (await page.locator('canvas[data-active="true"]').boundingBox())!;
  const move = async (x: number, y: number) => {
    const p = px(x, y);
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 3 });
  };
  /** Light linework round the circle's leftmost point, which only the clockwise arc passes. */
  const left = px(50, 50);
  const atLeft = () =>
    lightPixels(page, { x: left.x - 6, y: left.y - 8 }, { x: left.x + 6, y: left.y + 8 });

  // ARC start, Center: the end dragged up and to the right of the centre.
  await type(page, 'ARC', 'Specify start point of arc or [Center]:');
  await type(page, `#${X0 + 90},${Y0 + 50}`, 'Specify second point of arc or [Center/End]:');
  await type(page, 'C', 'Specify center point of arc:');
  await type(
    page,
    `#${X0 + 70},${Y0 + 50}`,
    `Specify end point of arc${CTRL} or [Angle/chord Length]:`,
  );
  await move(85, 80);
  await expect.poll(atLeft).toBe(0);
  await page.screenshot({ path: test.info().outputPath('1-arc-counter-clockwise.png') });
  // Ctrl pressed with the cursor still: the arc goes the other way round, past the left.
  await page.keyboard.down('Control');
  await expect.poll(atLeft).toBeGreaterThan(4);
  await page.screenshot({ path: test.info().outputPath('2-arc-ctrl-held.png') });
  await page.keyboard.up('Control');
  await expect.poll(atLeft).toBe(0);
  // A Ctrl+click draws it clockwise: the DXF arc runs from the end's direction to the start.
  await page.keyboard.down('Control');
  const end = px(85, 80);
  await page.mouse.click(box.x + end.x, box.y + end.y);
  await page.keyboard.up('Control');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await added(page)).map((e) => e.type)).toEqual(['ARC']);
  const arc = (await added(page))[0]!.geom as { startAngle: number; endAngle: number };
  expect(Math.abs(arc.endAngle) < 1e-6 || Math.abs(arc.endAngle - 2 * Math.PI) < 1e-6).toBe(true);
  expect(arc.startAngle).toBeGreaterThan(Math.PI / 4);
  expect(arc.startAngle).toBeLessThan(Math.PI / 2);

  // PELLIPSE 1: ELLIPSE makes a closed polyline, and offers no Arc.
  await type(page, 'PELLIPSE', /^Enter new value for PELLIPSE/);
  await type(page, '1', 'Command:');
  await type(page, 'EL', 'Specify axis endpoint of ellipse or [Center]:');
  await type(page, `#${X0 + 10},${Y0 + 20}`, 'Specify other endpoint of axis:');
  await type(page, `#${X0 + 40},${Y0 + 20}`, /^Specify distance to other axis/);
  await type(page, '8', 'Command:');
  await expect
    .poll(async () => (await added(page)).map((e) => e.type))
    .toEqual(['ARC', 'LWPOLYLINE']);
  expect((await added(page))[1]!.geom).toMatchObject({ kind: 'LWPOLYLINE', closed: true });
  expect((await added(page))[1]!.geom).toHaveProperty('vertices.length', 16);

  // DDPTYPE: the Point Style dialog, opened on PDMODE 0 and PDSIZE 0 (5% of the screen).
  await type(page, 'DDPTYPE', 'Point Style:');
  const dialog = page.getByRole('dialog', { name: 'Point Style' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Dot (PDMODE 0)' })).toBeChecked();
  await expect(dialog.getByLabel('Point Size:')).toHaveValue('5.0000');
  await expect(dialog.getByRole('radio', { name: 'Set Size Relative to Screen' })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('3-point-style-dialog.png') });
  // Esc cancels: nothing set.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'DDPTYPE', 'Point Style:');
  // The styles are a radio group: the arrow keys move through them.
  await dialog.getByRole('radio', { name: 'Dot (PDMODE 0)' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Nothing (PDMODE 1)' })).toBeChecked();
  await dialog.getByTitle('Cross in a circle (PDMODE 35)').click();
  await dialog.getByText('Set Size in Absolute Units').click();
  await expect(dialog.getByText('Units', { exact: true })).toBeVisible();
  await dialog.getByLabel('Point Size:').fill('0');
  await expect(dialog.getByRole('alert')).toHaveText('Point Size must be a number above zero.');
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  await dialog.getByLabel('Point Size:').fill('6');
  await page.screenshot({ path: test.info().outputPath('4-point-style-chosen.png') });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  expect(await headerSet(page)).toMatchObject({ $PDMODE: 35, $PDSIZE: 6 });

  // A point drawn with it: the circle round it, 6 units across.
  await type(page, 'POINT', 'Specify a point:');
  await type(page, `#${X0 + 110},${Y0 + 50}`, 'Command:');
  await move(130, 90);
  const p = px(110, 50);
  const r = 3 / s;
  await expect
    .poll(() => lightPixels(page, { x: p.x + r - 3, y: p.y - 3 }, { x: p.x + r + 3, y: p.y + 3 }))
    .toBeGreaterThan(2);
  await page.screenshot({ path: test.info().outputPath('5-after.png') });
});
