// M9-02 part 3: ellipses take constraints in the app. An ellipse and two lines are drawn on an
// empty part of the plan; GCTANGENT makes the first line tangent to the ellipse, and
// GCCOINCIDENT puts the second line's start on an end of the ellipse's major axis, the pick
// taking the ellipse's nearest constraint point. The solving is unit-tested in
// packages/constraints/test/ellipse.test.ts; this checks that the commands, the engine worker
// and the solver module carry it.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectDrawn, expectShown, gridOff, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };
type Xy = { x: number; y: number };
type Shapes = {
  ellipses: { center: Xy; majorAxis: Xy; ratio: number }[];
  lines: { start: Xy; end: Xy }[];
};

const O = 1000;

/** The session's ellipses and lines as they stand, less (O, O), in the order drawn. */
const shapes = (page: Page) =>
  page.evaluate((o) => {
    const order: string[] = [];
    const geoms = new Map<string, { kind: string } & Record<string, unknown>>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.type !== 'ELLIPSE' && a.entity.type !== 'LINE') continue;
        order.push(a.entity.handle);
        geoms.set(a.entity.handle, a.entity.geom as never);
      }
      for (const u of cs.entities?.updated ?? [])
        if (geoms.has(u.after.handle)) geoms.set(u.after.handle, u.after.geom as never);
    }
    const less = (p: unknown) => {
      const q = p as { x: number; y: number };
      return { x: q.x - o, y: q.y - o };
    };
    const out: Shapes = { ellipses: [], lines: [] };
    for (const h of order) {
      const g = geoms.get(h)!;
      if (g.kind === 'ELLIPSE') {
        out.ellipses.push({
          center: less(g.center),
          majorAxis: g.majorAxis as Xy,
          ratio: g.ratio as number,
        });
      } else out.lines.push({ start: less(g.start), end: less(g.end) });
    }
    return out;
  }, O);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('GCTANGENT and GCCOINCIDENT take an ellipse (M9-02 part 3)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const xy = (x: number, y: number) => `${O + x},${O + y}`;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, xy(0, -20), 'Specify opposite corner:');
  await type(page, xy(140, 80), 'Command:');

  // An ellipse centred at (50, 20), axes 30 along X and 15.
  await type(page, 'ELLIPSE', /^Specify axis endpoint of ellipse/);
  await type(page, xy(20, 20), 'Specify other endpoint of axis:');
  await type(page, xy(80, 20), /^Specify distance to other axis/);
  await type(page, '15', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, xy(20, 60), 'Specify next point or [Undo]:');
  await type(page, xy(80, 50), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, xy(110, 0), 'Specify next point or [Undo]:');
  await type(page, xy(130, 10), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(async () => (await shapes(page)).lines.length).toBe(2);
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await park();
  await shot('1-before.png');

  await type(page, 'GCTANGENT', 'Select first object:');
  await click(50, 35);
  await expect(prompt(page)).toHaveText('Select second object:');
  await click(50, 55);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  // The line turned or moved to touch the ellipse: in the ellipse's own frame scaled to the
  // unit circle, the line is 1 from the centre.
  await expect
    .poll(async () => {
      const { ellipses, lines } = await shapes(page);
      const e = ellipses[0]!;
      const a = Math.hypot(e.majorAxis.x, e.majorAxis.y);
      const unit = (p: Xy) => ({
        x: (p.x - e.center.x) / a,
        y: (p.y - e.center.y) / (a * e.ratio),
      });
      const p = unit(lines[0]!.start);
      const q = unit(lines[0]!.end);
      return Math.abs(p.x * q.y - p.y * q.x) / Math.hypot(q.x - p.x, q.y - p.y);
    })
    .toBeCloseTo(1, 6);
  await park();
  await shot('2-tangent.png');

  await type(page, 'GCCOINCIDENT', 'Select first point or [Object] <Object>:');
  await click(80, 20);
  await expect(prompt(page)).toHaveText('Select second point:');
  await click(110.5, 0.25);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await expect.poll(async () => (await shapes(page)).lines[1]!.start.x).toBeCloseTo(80, 6);
  const after = await shapes(page);
  expect(after.lines[1]!.start.y).toBeCloseTo(20, 6);
  // The ellipse stayed: centre, axes and ratio as drawn.
  expect(after.ellipses[0]!.center.x).toBeCloseTo(50, 6);
  expect(after.ellipses[0]!.center.y).toBeCloseTo(20, 6);
  // ELLIPSE's major axis runs from the centre to the first endpoint given, (20, 20).
  expect(after.ellipses[0]!.majorAxis.x).toBeCloseTo(-30, 6);
  expect(after.ellipses[0]!.majorAxis.y).toBeCloseTo(0, 6);
  expect(after.ellipses[0]!.ratio).toBeCloseTo(0.5, 6);
  await expectDrawn(page);
  await park();
  await shot('3-coincident.png');
});
