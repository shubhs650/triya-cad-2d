// M3-01 part 2: AutoCAD's Deferred Tangent from the app's command line with clicks, as a drafter
// draws a line tangent to two circles (LINE, TAN, pick, TAN, pick) and the ribbon's Tan, Tan,
// Tan circle in a triangle (CIRCLE, 3P, TAN and a pick three times). The snap's marker and tip,
// the click carrying the deferred pick from the canvas through the engine worker, and the
// solved geometry are checked here; every case of the solving is unit-tested in packages/engine.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, EntityGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
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
type Pt = { x: number; y: number };

/** The geometry of the entities the drawing has now that it did not open with, in order. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((e) => e.geom);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');
const tip = (page: Page) => page.getByTestId('autosnap-tip');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

type Line = Extract<EntityGeometry, { kind: 'LINE' }>;
type Circle = Extract<EntityGeometry, { kind: 'CIRCLE' }>;

/** How far `p` is from the infinite line through `l`. */
const lineDistance = (l: Line, p: Pt) => {
  const dx = l.end.x - l.start.x;
  const dy = l.end.y - l.start.y;
  return Math.abs((p.x - l.start.x) * dy - (p.y - l.start.y) * dx) / Math.hypot(dx, dy);
};

test('LINE tangent to two circles, and CIRCLE Tan, Tan, Tan in a triangle', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number): Pt => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (p: Pt) => {
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.click(p.x, p.y);
  };
  // A clear sheet, so that the clicks below snap to nothing but what they draw.
  await type(page, 'ERASE', 'Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');

  // Two circles, centre and radius clicked.
  const r = box.width * 0.06;
  const c1 = at(0.25, 0.3);
  const c2 = at(0.6, 0.35);
  for (const [c, radius] of [
    [c1, r],
    [c2, r * 1.5],
  ] as const) {
    await type(page, 'CIRCLE', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
    await click(c);
    await click({ x: c.x + radius, y: c.y });
    await expect(prompt(page)).toHaveText('Command:');
  }
  await expect.poll(async () => (await added(page)).length).toBe(2);

  // LINE, TAN at its first point: the circle's top shows AutoCAD's Deferred Tangent.
  await type(page, 'LINE', 'Specify first point:');
  await type(page, 'tan', 'to');
  const top1 = { x: c1.x + r * 0.2, y: c1.y - Math.sqrt(r * r - (r * 0.2) ** 2) };
  await page.mouse.move(top1.x, top1.y, { steps: 4 });
  await expect(tip(page)).toHaveText('Deferred Tangent');
  await expect(tip(page)).toHaveAttribute('data-deferred', 'true');
  await page.screenshot({ path: test.info().outputPath('1-deferred-tangent.png') });
  await page.mouse.click(top1.x, top1.y);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await type(page, 'tan', 'to');
  const r2 = r * 1.5;
  const top2 = { x: c2.x - r2 * 0.2, y: c2.y - Math.sqrt(r2 * r2 - (r2 * 0.2) ** 2) };
  await page.mouse.move(top2.x, top2.y, { steps: 4 });
  await expect(tip(page)).toHaveText('Deferred Tangent');
  await page.screenshot({ path: test.info().outputPath('2-second-tangent.png') });
  await page.mouse.click(top2.x, top2.y);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(async () => (await added(page)).length).toBe(3);
  {
    const [a, b, line] = (await added(page)) as [Circle, Circle, Line];
    // The line touches both circles at its ends: each end on its circle, the radius square to it.
    const d = { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
    for (const [c, p] of [
      [a, line.start],
      [b, line.end],
    ] as const) {
      expect(Math.hypot(p.x - c.center.x, p.y - c.center.y)).toBeCloseTo(c.radius, 6);
      expect(lineDistance(line, c.center)).toBeCloseTo(c.radius, 6);
    }
    // Over the tops, as picked (world y runs up the screen).
    expect(line.start.y).toBeGreaterThan(a.center.y);
    expect(line.end.y).toBeGreaterThan(b.center.y);
    expect(Math.hypot(d.x, d.y)).toBeGreaterThan(0);
  }

  // A triangle, clicked corner to corner and closed.
  const corners = [at(0.2, 0.85), at(0.5, 0.85), at(0.3, 0.6)];
  await type(page, 'LINE', 'Specify first point:');
  for (const p of corners) await click(p);
  await type(page, 'C', 'Command:');
  await expect.poll(async () => (await added(page)).length).toBe(6);

  // CIRCLE 3P with TAN at each point: the ribbon's Tan, Tan, Tan.
  const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  await type(page, 'CIRCLE', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
  await type(page, '3P', 'Specify first point on circle:');
  const sides = [
    mid(corners[0]!, corners[1]!),
    mid(corners[1]!, corners[2]!),
    mid(corners[2]!, corners[0]!),
  ];
  const next = ['Specify second point on circle:', 'Specify third point on circle:', 'Command:'];
  for (const [i, p] of sides.entries()) {
    await type(page, 'tan', 'to');
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect(tip(page)).toHaveText('Deferred Tangent');
    if (i === 2) await page.screenshot({ path: test.info().outputPath('3-tan-tan-tan.png') });
    await page.mouse.click(p.x, p.y);
    await expect(prompt(page)).toHaveText(next[i]!);
  }
  await expect.poll(async () => (await added(page)).length).toBe(7);
  const geoms = await added(page);
  const circle = geoms[6] as Circle;
  expect(circle.kind).toBe('CIRCLE');
  // Inscribed: as far from each side as its radius, inside the triangle.
  for (const side of geoms.slice(3, 6) as Line[]) {
    expect(lineDistance(side, circle.center)).toBeCloseTo(circle.radius, 6);
  }
  await page.mouse.move(at(0.95, 0.95).x, at(0.95, 0.95).y);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
