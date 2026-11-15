// M3-02 part 3: FILLET and CHAMFER from the app's canvas. On an empty part of the plan two
// corners are drawn: a closed corner of two lines and two lines short of meeting. FILLET at
// radius 10 rounds the first with two clicks; CHAMFER at 8 and 12 cuts the second, extending
// the lines to it; a Shift+click with FILLET then makes a sharp corner of a third pair.
// The prompts and geometry are unit-tested in packages/engine/test (commands/fillet.test.ts,
// edit/corner.test.ts); this checks that the app's canvas, bus and engine worker carry them:
// clicks with the pickbox (no snaps) and Shift with the second. M3-12 part 5 adds an ellipse, a
// spline and a polyline arc segment filleted to lines.
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

/** The lines and arcs the session drew, less (1000000, 1000000), rounded, sorted. */
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
    const r = (v: number) => Math.round((v - 1000000) * 1000) / 1000;
    const lines = [...now.values()]
      .filter((e) => e.type === 'LINE')
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
    const arcs = [...now.values()]
      .filter((e) => e.type === 'ARC')
      .map((e) => {
        const g = e.geom as { center: { x: number; y: number }; radius: number };
        return [r(g.center.x), r(g.center.y), Math.round(g.radius * 1000) / 1000];
      });
    return { lines, arcs };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const FILLET_FIRST = 'Select first object or [Undo/Polyline/Radius/Trim/Multiple]:';
const FILLET_SECOND = 'Select second object or shift-select to apply corner or [Radius]:';
const CHAMFER_FIRST = 'Select first line or [Undo/Polyline/Distance/Angle/Trim/mEthod/Multiple]:';
const CHAMFER_SECOND =
  'Select second line or shift-select to apply corner or [Distance/Angle/Method]:';

test('FILLET and CHAMFER with clicks, and Shift for a sharp corner', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const draw = async (a: string, b: string) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  };
  // A closed corner at (20,20), two lines short of a corner at (100,20), and a third pair.
  await draw('1000020,1000060', '1000020,1000020');
  await draw('1000020,1000020', '1000060,1000020');
  await draw('1000080,1000020', '1000090,1000020');
  await draw('1000100,1000030', '1000100,1000060');
  await draw('1000120,1000080', '1000150,1000080');
  await draw('1000130,1000070', '1000130,1000095');
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(6);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  await type(page, 'F', FILLET_FIRST);
  await expect(log).toContainText('Current settings: Mode = TRIM, Radius = ');
  await type(page, 'R', /^Specify fillet radius/);
  await type(page, '10', FILLET_FIRST);
  await click(20, 45);
  await expect(prompt(page)).toHaveText(FILLET_SECOND);
  await click(45, 20);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await drawn(page)).arcs).toEqual([[30, 30, 10]]);
  await expect.poll(async () => (await drawn(page)).lines).toContainEqual([20, 60, 20, 30]);
  await expect.poll(async () => (await drawn(page)).lines).toContainEqual([30, 20, 60, 20]);

  await type(page, 'CHA', CHAMFER_FIRST);
  await type(page, 'D', /^Specify first chamfer distance/);
  await type(page, '8', /^Specify second chamfer distance <8/);
  await type(page, '12', CHAMFER_FIRST);
  await click(85, 20);
  await expect(prompt(page)).toHaveText(CHAMFER_SECOND);
  await click(100, 50);
  await expect(prompt(page)).toHaveText('Command:');
  // Both lines extended toward (100,20) and cut 8 and 12 short of it.
  await expect
    .poll(async () => (await drawn(page)).lines)
    .toEqual(
      expect.arrayContaining([
        [80, 20, 92, 20],
        [100, 32, 100, 60],
        [92, 20, 100, 32],
      ]),
    );

  // Shift with the second pick: a sharp corner whatever the radius.
  await type(page, 'F', FILLET_FIRST);
  await click(140, 80);
  await page.keyboard.down('Shift');
  await click(130, 90);
  await page.keyboard.up('Shift');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await drawn(page)).lines)
    .toEqual(
      expect.arrayContaining([
        [130, 80, 150, 80],
        [130, 80, 130, 95],
      ]),
    );
  await expect.poll(async () => (await drawn(page)).arcs).toHaveLength(1);
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('2-after.png') });
});

// M3-12 part 5: FILLET rounds an ellipse, a spline and a polyline's arc segment to lines.
test('FILLET with an ellipse, a spline and a polyline arc segment', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const kinds = () =>
    page.evaluate(() => {
      const now = new Map<string, { type: string }>();
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const a of cs.entities?.added ?? []) now.set(a.entity.handle, a.entity);
        for (const r of cs.entities?.removed ?? []) now.delete(r.entity.handle);
      }
      return [...now.values()].map((e) => e.type).sort();
    });
  const line = async (a: string, b: string) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  };
  // An ellipse round (40,50), semi-axes 20 and 10, and the line y = 65 above it.
  await type(page, 'EL', /^Specify axis endpoint of ellipse/);
  await type(page, 'C', /^Specify center of ellipse/);
  await type(page, '1000040,1000050', /^Specify endpoint of axis/);
  await type(page, '1000060,1000050', /^Specify distance to other axis/);
  await type(page, '10', 'Command:');
  await line('1000010,1000065', '1000070,1000065');
  // A spline through (90,20), (100,35), (115,30), (130,45), and the line x = 100 across it.
  await type(page, 'SPL', /^Specify first point/);
  await type(page, '1000090,1000020', /^Enter next point/);
  await type(page, '1000100,1000035', /^Enter next point/);
  await type(page, '1000115,1000030', /^Enter next point/);
  await type(page, '1000130,1000045', /^Enter next point/);
  await type(page, '', 'Command:');
  await line('1000100,1000060', '1000100,1000005');
  // A polyline down (135,90)-(135,75), then a half circle to (150,75); the line x = 148 across it.
  await type(page, 'PL', /^Specify start point/);
  await type(page, '1000135,1000090', /^Specify next point/);
  await type(page, '1000135,1000075', /^Specify next point/);
  await type(page, 'A', /^Specify endpoint of arc/);
  await type(page, '1000150,1000075', /^Specify endpoint of arc/);
  await type(page, '', 'Command:');
  await line('1000148,1000060', '1000148,1000090');
  await expect.poll(kinds).toEqual(['ELLIPSE', 'LINE', 'LINE', 'LINE', 'LWPOLYLINE', 'SPLINE']);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('3-curves-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  await type(page, 'F', FILLET_FIRST);
  await type(page, 'R', /^Specify fillet radius/);
  await type(page, '3', FILLET_FIRST);
  await type(page, 'M', FILLET_FIRST);
  // The ellipse (at (52,58) on it) to the line: an arc, the ellipse left whole.
  await click(52, 58);
  await expect(prompt(page)).toHaveText(FILLET_SECOND);
  await click(60, 65);
  await expect(prompt(page)).toHaveText(FILLET_FIRST);
  await expect.poll(async () => (await kinds()).filter((k) => k === 'ARC')).toHaveLength(1);
  // The spline (at its fit point (115,30)) to the line x = 100 above it.
  await click(115, 30);
  await expect(prompt(page)).toHaveText(FILLET_SECOND);
  await click(100, 55);
  await expect(prompt(page)).toHaveText(FILLET_FIRST);
  await expect.poll(async () => (await kinds()).filter((k) => k === 'ARC')).toHaveLength(2);
  // The half circle (at −110° on it) to the line inside it: joined into the polyline.
  const turn = (-110 * Math.PI) / 180;
  await click(142.5 + 7.5 * Math.cos(turn), 75 + 7.5 * Math.sin(turn));
  await expect(prompt(page)).toHaveText(FILLET_SECOND);
  await click(148, 80);
  await expect(prompt(page)).toHaveText(FILLET_FIRST);
  await type(page, '', 'Command:');
  await expect
    .poll(kinds)
    .toEqual(['ARC', 'ARC', 'ELLIPSE', 'LINE', 'LINE', 'LWPOLYLINE', 'SPLINE']);
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('4-curves-after.png') });
});
