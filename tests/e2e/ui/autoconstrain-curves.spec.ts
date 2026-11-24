// M9-05 part 5: AUTOCONSTRAIN takes splines and ellipses. On an empty part of the plan an
// ellipse is drawn with a line along its top 0.03 above it, a circle 0.02 off its centre, a
// spline from 0.02 off its major axis's end to 0.03 short of a second line's start. AUTOCONSTRAIN
// on the five applies 2 Coincident (the spline's ends), Parallel, Tangent (the line and the
// ellipse), Concentric (the circle and the ellipse) and Horizontal, and the geometry follows.
// Which constraints are found is tested in packages/engine/test/edit/autoconstrain.test.ts and
// with PlaneGCS in packages/constraints/test/autoconstrain.test.ts; this checks the app carries it.
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
type Geom = { kind: string } & Record<string, unknown>;

const O = 1000;

/** The session's lines, circles, ellipses and splines as they stand, in the order drawn. */
const shapes = (page: Page) =>
  page.evaluate(() => {
    const order: string[] = [];
    const geoms = new Map<string, Geom>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (!['LINE', 'CIRCLE', 'ELLIPSE', 'SPLINE'].includes(a.entity.type)) continue;
        order.push(a.entity.handle);
        geoms.set(a.entity.handle, a.entity.geom as never);
      }
      for (const u of cs.entities?.updated ?? [])
        if (geoms.has(u.after.handle)) geoms.set(u.after.handle, u.after.geom as never);
    }
    return order.map((h) => geoms.get(h)!);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('AUTOCONSTRAIN takes splines and ellipses (M9-05 part 5)', async ({ page }) => {
  test.setTimeout(120_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = (name: string) =>
    page.screenshot({ path: shots ? path.join(shots, name) : test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const xy = (x: number, y: number) => `${O + x},${O + y}`;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, xy(0, -20), 'Specify opposite corner:');
  await type(page, xy(160, 70), 'Command:');

  // An ellipse centred at (50, 20), axes 30 along X and 15: its top at y 35.
  await type(page, 'ELLIPSE', /^Specify axis endpoint of ellipse/);
  await type(page, xy(80, 20), 'Specify other endpoint of axis:');
  await type(page, xy(20, 20), /^Specify distance to other axis/);
  await type(page, '15', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, xy(25, 35.03), 'Specify next point or [Undo]:');
  await type(page, xy(75, 35.03), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'C', /^Specify center point for circle/);
  await type(page, xy(50.02, 20.01), /^Specify radius of circle/);
  await type(page, '8', 'Command:');
  await type(page, 'SPLINE', /^Specify first point or/);
  await type(page, xy(80.02, 20.01), /^Enter next point or/);
  await type(page, xy(95, 35), /^Enter next point or/);
  await type(page, xy(115, 10), /^Enter next point or/);
  await type(page, xy(130, 20), /^Enter next point or/);
  await type(page, '', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, xy(130.03, 20), 'Specify next point or [Undo]:');
  await type(page, xy(150, 20), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(async () => (await shapes(page)).length).toBe(5);
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  await park();
  await shot('1-before.png');

  await type(page, 'AUTOCONSTRAIN', 'Select objects or [Settings]:');
  await click(50, 5); // the ellipse's bottom
  await click(30, 35.03); // the line along its top
  await click(42, 20); // the circle
  await click(115, 10); // the spline
  await click(145, 20); // the second line
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('6 constraints applied to 5 objects.', {
    timeout: 15_000,
  });

  const [ellipse, top, circle, spline, last] = (await shapes(page)) as [
    Geom,
    Geom,
    Geom,
    Geom,
    Geom,
  ];
  const c = ellipse['center'] as Xy;
  const m = ellipse['majorAxis'] as Xy;
  const ratio = ellipse['ratio'] as number;
  const a = Math.hypot(m.x, m.y);
  // The circle shares the ellipse's centre.
  expect((circle['center'] as Xy).x).toBeCloseTo(c.x, 6);
  expect((circle['center'] as Xy).y).toBeCloseTo(c.y, 6);
  // The line is horizontal and touches the ellipse's top.
  const [s, e] = [top['start'] as Xy, top['end'] as Xy];
  expect(s.y).toBeCloseTo(e.y, 6);
  expect(s.y - c.y).toBeCloseTo(Math.hypot(m.y, ratio * m.x), 6);
  // The spline starts on the ellipse and ends where the second line starts.
  const cps = spline['controlPoints'] as Xy[];
  const u = { x: m.x / a, y: m.y / a };
  const d = { x: cps[0]!.x - c.x, y: cps[0]!.y - c.y };
  const along = (d.x * u.x + d.y * u.y) / a;
  const across = (-d.x * u.y + d.y * u.x) / (a * ratio);
  expect(along ** 2 + across ** 2).toBeCloseTo(1, 6);
  expect(cps.at(-1)!.x).toBeCloseTo((last['start'] as Xy).x, 6);
  expect(cps.at(-1)!.y).toBeCloseTo((last['start'] as Xy).y, 6);
  await expectDrawn(page);
  await park();
  await shot('2-auto-constrained.png');
});
