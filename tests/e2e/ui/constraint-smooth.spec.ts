// M9-02 part 2: GCSMOOTH in the app. A line and a fit-point spline are drawn on an empty part
// of the plan, the spline starting near the line's end but bent away from it; GCSMOOTH picks
// the spline by its start and the line by its end. The spline's start moves onto the line's
// end, runs on along the line and leaves it with no curvature (G2), its far control points
// stay, and it loses its fit points, which no longer lie on it. The solving is unit-tested in
// packages/constraints/test/smooth.test.ts; this checks that the command, the engine worker
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
type Spline = {
  controlPoints: { x: number; y: number }[];
  fitPoints?: { x: number; y: number }[];
};

const O = 1000;

/** The session's last spline, less (O, O). */
const spline = (page: Page) =>
  page.evaluate((o) => {
    let out: Spline | undefined;
    let handle: string | undefined;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.type !== 'SPLINE') continue;
        handle = a.entity.handle;
        out = a.entity.geom as never;
      }
      for (const u of cs.entities?.updated ?? [])
        if (u.after.handle === handle) out = u.after.geom as never;
    }
    if (!out) return undefined;
    return {
      controlPoints: out.controlPoints.map((p) => ({ x: p.x - o, y: p.y - o })),
      fitPoints: out.fitPoints?.length ?? 0,
    };
  }, O);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('GCSMOOTH joins a spline to the end of a line with G2 continuity (M9-02 part 2)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const xy = (x: number, y: number) => `${O + x},${O + y}`;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, xy(0, -30), 'Specify opposite corner:');
  await type(page, xy(160, 70), 'Command:');

  await type(page, 'L', 'Specify first point:');
  await type(page, xy(20, 20), 'Specify next point or [Undo]:');
  await type(page, xy(70, 20), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'SPLINE', /^Specify first point or/);
  await type(page, xy(76, 26), /^Enter next point or/);
  await type(page, xy(95, 45), /^Enter next point or/);
  await type(page, xy(115, 30), /^Enter next point or/);
  await type(page, xy(140, 50), /^Enter next point or/);
  await type(page, '', 'Command:');
  await expect.poll(async () => (await spline(page))?.fitPoints).toBe(4);
  await expectDrawn(page, { timeout: 15_000 });
  const before = (await spline(page))!;

  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await park();
  await shot('1-before.png');

  await type(page, 'GCSMOOTH', 'Select first spline curve:');
  const s = at(76, 26);
  await page.mouse.click(s.x, s.y);
  await expect(prompt(page)).toHaveText('Select second curve:');
  const l = at(68, 20);
  await page.mouse.click(l.x, l.y);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });

  await expect.poll(async () => (await spline(page))?.fitPoints, { timeout: 15_000 }).toBe(0);
  const after = (await spline(page))!;
  const [q0, q1, q2] = after.controlPoints as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  // On the line's end, its next two control points on the line beyond it: tangent and no curvature.
  expect(q0.x).toBeCloseTo(70, 6);
  expect(q0.y).toBeCloseTo(20, 6);
  expect(q1.y).toBeCloseTo(20, 6);
  expect(q2.y).toBeCloseTo(20, 6);
  expect(q1.x).toBeGreaterThan(70);
  expect(q2.x).toBeGreaterThan(q1.x);
  // The rest of the spline stays.
  expect(after.controlPoints.slice(3)).toEqual(before.controlPoints.slice(3));
  await expectDrawn(page);
  await park();
  await shot('2-smoothed.png');
});
