// M2-08: REVCLOUD, WIPEOUT, DRAWORDER and HATCHTOBACK from the app's command line, as a drafter
// marks up a drawing: a rectangular cloud picked with two clicks, a freehand cloud drawn by
// guiding the crosshairs round without clicking (the canvas answers the tracing prompt itself),
// a wipeout over part of the plan, then the wipeout sent back under the plan with DRAWORDER.
// The commands' prompts and geometry are unit-tested in packages/engine/test/commands; this
// checks that the app's bus, canvas and engine worker carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, NonGraphicalObject } from '@triya/engine';
import { DXF, activeCanvas, expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

interface Added {
  readonly type: string;
  readonly closed?: boolean;
  /** Every segment's bulge, for clouds. */
  readonly bulges?: number[];
  readonly xdata?: number;
}

/** The entities this test added, in order, as the change sets left them. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((e): Added => {
      const g = e.geom;
      if (g.kind !== 'LWPOLYLINE') return { type: e.type };
      return {
        type: e.type,
        closed: g.closed,
        bulges: g.vertices.map((v) => Math.round(v.bulge * 1e6) / 1e6),
        xdata: e.xdata?.length ?? 0,
      };
    });
  });

/** The draw order tables the commands wrote, as they last stood. */
const sortTables = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, NonGraphicalObject>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const o of cs.objects?.added ?? []) out.set(o.handle, o);
      for (const u of cs.objects?.updated ?? []) out.set(u.after.handle, u.after);
    }
    return [...out.values()].filter((o) => o.type === 'SORTENTSTABLE').length;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const BULGE = 0.520567;

test('REVCLOUD rectangular and freehand, WIPEOUT, DRAWORDER and HATCHTOBACK', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
  };
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // A rectangular cloud: the first in the drawing sizes its arcs from the view.
  await type(
    page,
    'REVCLOUD',
    'Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style] <Object>:',
  );
  await expect(log).toContainText(/Minimum arc length: [\d.]+ {3}Maximum arc length/);
  await click(0.08, 0.12);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await click(0.4, 0.45);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await added(page)).length).toBe(1);
  const [rect] = await added(page);
  expect(rect).toMatchObject({ type: 'LWPOLYLINE', closed: true, xdata: 1 });
  expect(rect!.bulges!.length).toBeGreaterThan(8);
  expect(rect!.bulges!.every((b) => Math.abs(b) === BULGE)).toBe(true);

  // A freehand cloud: one click, then the cursor guided round a circle back to the start.
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'F', /^Specify first point or/);
  const center = at(0.75, 0.3);
  const r = box.height * 0.18;
  await page.mouse.move(center.x + r, center.y);
  await page.mouse.click(center.x + r, center.y);
  await expect(prompt(page)).toHaveText('Guide crosshairs along cloud path:');
  for (let i = 1; i <= 80 && (await prompt(page).textContent()) !== 'Command:'; i++) {
    const t = (i / 72) * 2 * Math.PI;
    await page.mouse.move(center.x + r * Math.cos(t), center.y - r * Math.sin(t), { steps: 2 });
  }
  await expect(prompt(page)).toHaveText('Command:');
  await expect(log).toContainText('Revision cloud finished.');
  await expect.poll(async () => (await added(page)).length).toBe(2);
  const free = (await added(page))[1]!;
  expect(free).toMatchObject({ type: 'LWPOLYLINE', closed: true });
  expect(free.bulges!.length).toBeGreaterThan(5);
  expect(free.bulges!.every((b) => Math.abs(b) === BULGE)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('2-clouds.png') });

  // A wipeout over the middle of the plan.
  const inkBefore = await ink(page);
  await type(page, 'WIPEOUT', 'Specify first point or [Frames/Polyline] <Polyline>:');
  await click(0.35, 0.5);
  await expect(prompt(page)).toHaveText('Specify next point:');
  await click(0.65, 0.5);
  await click(0.65, 0.85);
  await click(0.35, 0.85);
  await expect(prompt(page)).toHaveText('Specify next point or [Close/Undo]:');
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await added(page)).map((a) => a.type))
    .toEqual(['LWPOLYLINE', 'LWPOLYLINE', 'WIPEOUT']);
  // The plan under it is masked.
  await expect.poll(() => ink(page)).toBeLessThan(inkBefore);
  await page.screenshot({ path: test.info().outputPath('3-wipeout.png') });
  const masked = await ink(page);

  // DRAWORDER: the wipeout (the Last object) to the back, under the plan again.
  await type(page, 'DR', 'Select objects:');
  await page.keyboard.type('L');
  await type(page, '', 'Select objects:');
  await type(
    page,
    '',
    'Enter object ordering option [Above objects/Under objects/Front/Back] <Back>:',
  );
  await type(page, '', 'Command:');
  await expect.poll(() => sortTables(page)).toBe(1);
  await expect.poll(() => ink(page)).toBeGreaterThan(masked);
  await page.screenshot({ path: test.info().outputPath('4-wipeout-sent-back.png') });

  await type(page, 'HATCHTOBACK', 'Command:');
  await expect(log).toContainText(/\d+ hatch objects? sent to back\./);
});
