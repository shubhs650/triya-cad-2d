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
    'Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style/Modify] <Object>:',
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

/** The cloud `handle` as the change sets last left it: its vertices. */
const cloudNow = (page: Page, handle: string) =>
  page.evaluate((h) => {
    let out: Entity | undefined;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) if (a.entity.handle === h) out = a.entity;
      for (const u of cs.entities?.updated ?? []) if (u.after.handle === h) out = u.after;
    }
    const g = out?.geom;
    return g?.kind === 'LWPOLYLINE'
      ? g.vertices.map((v) => ({ x: v.x, y: v.y, bulge: Math.round(v.bulge * 1e6) / 1e6 }))
      : [];
  }, handle);

/** How many vertices of `v` turn a corner (REVCLOUDGRIPS shows these). */
function corners(v: readonly { x: number; y: number }[]): number {
  let n = 0;
  v.forEach((b, i) => {
    const a = v[(i - 1 + v.length) % v.length]!;
    const c = v[(i + 1) % v.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const l = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y);
    if (Math.abs(cross) > 1e-9 * l) n++;
  });
  return n;
}

/** Grip-blue pixels (ACI 150) in a small square of the page around a point. */
async function blue(page: Page, p: { x: number; y: number }, r = 6): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 180 && d[i]! < 80) n++;
    return n;
  }, png.toString('base64'));
}

// M2-24: a cloud's corner grip dragged (REVCLOUDGRIPS on: grips at the corners only) and part of
// it redrawn with REVCLOUD Modify, the cloud keeping its handle throughout. Drawn in an empty
// part of the drawing, zoomed so 160 × 100 units fill the canvas.
test('REVCLOUD corner grips and Modify', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const O = 1_000_000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 100}`, 'Command:');
  // Running object snaps would pull the clicks below onto the cloud's own points; off.
  await page.keyboard.press('F3');

  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'A', /^Specify minimum length of arc/);
  await type(page, '5', /^Specify maximum length of arc/);
  await type(page, '5', /^Specify first corner point or/);
  await type(page, `${O + 20},${O + 20}`, 'Specify opposite corner:');
  await type(page, `${O + 100},${O + 80}`, 'Command:');
  await expect.poll(async () => (await added(page)).length).toBe(1);
  const handle = await page.evaluate(() => {
    const cs = (window as unknown as Dev).triyaDev.changes();
    return cs.flatMap((c) => c.entities?.added ?? []).at(-1)!.entity.handle;
  });
  const drawn = await cloudNow(page, handle);
  expect(drawn).toHaveLength(56);
  expect(corners(drawn)).toBe(4);

  // Selected, the cloud shows its four corners, and no grip where two arcs meet along a side;
  // the upper right corner dragged out.
  await click(100, 80);
  await expect.poll(() => blue(page, at(20, 20))).toBeGreaterThan(20);
  expect(await blue(page, at(60, 20))).toBe(0);
  await shot('1-corner-grips.png');
  await click(100, 80);
  await expect(prompt(page)).toHaveText(/^Specify stretch point/);
  await click(130, 92);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await cloudNow(page, handle)).length).not.toBe(drawn.length);
  const dragged = await cloudNow(page, handle);
  expect(corners(dragged)).toBe(4);
  expect(dragged.every((v) => Math.abs(v.bulge) === BULGE)).toBe(true);
  await shot('2-corner-dragged.png');
  await page.keyboard.press('Escape');

  // Modify: from the upper left corner out round the left and back in at the lower left one,
  // the old left side erased.
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'M', 'Select polyline:');
  await click(20, 80);
  await expect(prompt(page)).toHaveText('Specify next point:');
  await click(5, 65);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await click(5, 35);
  await click(20, 20);
  await expect(prompt(page)).toHaveText('Pick a side to erase:');
  await shot('3-pick-side.png');
  await click(20, 50);
  await expect(prompt(page)).toHaveText('Reverse direction [Yes/No] <No>:');
  await type(page, '', 'Command:');
  await expect(log).toContainText('Revision cloud finished.');
  await expect.poll(async () => (await cloudNow(page, handle)).length).not.toBe(dragged.length);
  const modified = await cloudNow(page, handle);
  expect(corners(modified)).toBe(6);
  expect(modified.every((v) => Math.abs(v.bulge) === BULGE)).toBe(true);
  // Still the one cloud.
  expect(await added(page)).toHaveLength(1);
  await shot('4-modified.png');
});
