// M3-01 part 3: PLINE, RECTANG and POLYGON from the app's command line with clicks, as a
// drafter draws them: a wide polyline whose arc segment follows the cursor, a filleted rectangle
// dragged to its other corner, and a hexagon dragged out from its centre. Every option's prompts
// and geometry are unit-tested in packages/engine/test/commands; this checks that the bus, the
// canvas's drag preview and the engine worker carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, LwPolylineGeometry } from '@triya/engine';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  lightPixels,
  openWithPicker,
  worldAt,
} from '../app/page';
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

/** The entities this test added, as they are now (PLINE's grows segment by segment). */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('PLINE with an arc segment, a filleted RECTANG and a POLYGON, dragged and clicked', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const px = (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy });
  const at = (fx: number, fy: number) => ({ x: box.x + px(fx, fy).x, y: box.y + px(fx, fy).y });
  const click = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
  };
  const move = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  // Drawing units per CSS pixel, for widths and radii that read well on screen.
  const a = await worldAt(page, 100, 100);
  const b = await worldAt(page, 200, 100);
  const unit = Math.abs(b.x - a.x) / 100;
  const units = (n: number) => (n * unit).toFixed(4);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // PLINE: a wide line, then an arc segment dragged with the cursor, then a line back.
  await type(page, 'PLINE', 'Specify start point:');
  await click(0.1, 0.8);
  await expect(prompt(page)).toHaveText('Specify next point or [Arc/Halfwidth/Length/Undo/Width]:');
  await type(page, 'W', /^Specify starting width <[\d.]+>:$/);
  await type(page, units(4), /^Specify ending width <[\d.]+>:$/);
  await type(page, '', 'Specify next point or [Arc/Halfwidth/Length/Undo/Width]:');
  await click(0.25, 0.8);
  await type(
    page,
    'A',
    'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Halfwidth/Line/Radius/Second pt/Undo/Width]:',
  );
  // The arc from 0.25,0.8 heading east to 0.25,0.5 bulges right: its far side is out at
  // x = 0.25 + half the chord, only once the cursor is up there.
  const chord = box.height * 0.3;
  const apex = { x: px(0.25, 0).x + chord / 2, y: px(0, 0.65).y };
  const atApex = () =>
    lightPixels(page, { x: apex.x - 6, y: apex.y - 6 }, { x: apex.x + 6, y: apex.y + 6 });
  await move(0.27, 0.8);
  await expect.poll(atApex).toBe(0);
  await move(0.25, 0.5);
  await expect.poll(atApex).toBeGreaterThan(4);
  await page.screenshot({ path: test.info().outputPath('2-pline-arc-dragged.png') });
  await click(0.25, 0.5);
  await type(page, 'L', 'Specify next point or [Arc/Close/Halfwidth/Length/Undo/Width]:');
  await click(0.1, 0.5);
  await type(page, '', 'Command:');

  // RECTANG with fillets, dragged to its other corner.
  await type(
    page,
    'RECTANG',
    'Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:',
  );
  await type(page, 'F', /^Specify fillet radius for rectangles <[\d.]+>:$/);
  await type(
    page,
    units(20),
    'Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:',
  );
  await click(0.1, 0.12);
  await expect(prompt(page)).toHaveText(
    'Specify other corner point or [Area/Dimensions/Rotation]:',
  );
  // The rectangle's right side shows at x = 0.32 only once the cursor is that far right.
  const side = px(0.32, 0.25);
  const atSide = () =>
    lightPixels(page, { x: side.x - 5, y: side.y - 10 }, { x: side.x + 5, y: side.y + 10 });
  await move(0.2, 0.38);
  await expect.poll(atSide).toBe(0);
  await move(0.32, 0.38);
  await expect.poll(atSide).toBeGreaterThan(4);
  await page.screenshot({ path: test.info().outputPath('3-rectang-dragged.png') });
  await click(0.32, 0.38);
  await expect(prompt(page)).toHaveText('Command:');

  // POLYGON: six sides, inscribed, its radius dragged out from the centre.
  await type(page, 'POLYGON', /^Enter number of sides <\d+>:$/);
  await type(page, '6', 'Specify center of polygon or [Edge]:');
  await click(0.82, 0.6);
  await expect(prompt(page)).toHaveText(
    'Enter an option [Inscribed in circle/Circumscribed about circle] <I>:',
  );
  await type(page, '', 'Specify radius of circle:');
  await move(0.9, 0.6);
  await page.screenshot({ path: test.info().outputPath('4-polygon-dragged.png') });
  await click(0.9, 0.6);
  await expect(prompt(page)).toHaveText('Command:');

  await expect.poll(async () => (await added(page)).length).toBe(3);
  const [pl, rect, hex] = (await added(page)).map((e) => e.geom as LwPolylineGeometry);
  expect(pl!.vertices).toHaveLength(4);
  expect(pl!.vertices[1]!.bulge).toBeCloseTo(1, 1);
  expect(pl!.constantWidth).toBe(Number(units(4)));
  expect(rect!.closed).toBe(true);
  expect(rect!.vertices).toHaveLength(8);
  expect(hex!.closed).toBe(true);
  expect(hex!.vertices).toHaveLength(6);
  await page.mouse.move(at(0.98, 0.98).x, at(0.98, 0.98).y);
  await page.screenshot({ path: test.info().outputPath('5-after.png') });
});
