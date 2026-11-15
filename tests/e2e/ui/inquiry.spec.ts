// M3-07: the inquiry commands from the app's command line. ID, DIST, AREA, MEASUREGEOM and LIST
// write their results in the command history, AREA shows the path measured while its points are
// given, SETVAR reads the AREA variable back, and MEASUREGEOM's Quick mode measures under the
// cursor and fills the spaces clicked (part 2). The prompts and every result line are
// unit-tested in packages/engine/test/commands/{inquiry,list,quick-measure}.test.ts. The
// drawing's AUPREC is 2.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function answer(page: Page, text: string, next: string | RegExp): Promise<void> {
  await enterCommand(page, text);
  await expect(prompt(page)).toHaveText(next);
}

test('ID, DIST, AREA and MEASUREGEOM report at the command line', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await answer(page, 'ID', 'Specify point:');
  await answer(page, '-260,600', 'Command:');
  await expect(log).toContainText('X = -260.0000     Y = 600.0000     Z = 0.0000');

  await answer(page, 'DI', 'Specify first point:');
  await answer(page, '-290,595', 'Specify second point or [Multiple points]:');
  await answer(page, '-260,635', 'Command:');
  await expect(log).toContainText(
    'Distance = 50.0000,  Angle in XY Plane = 53.13,  Angle from XY Plane = 0.00',
  );
  await expect(log).toContainText('Delta X = 30.0000,  Delta Y = 40.0000,  Delta Z = 0.0000');

  // AREA across the drawing's right edge: the polygon given so far is shown, closed.
  await answer(
    page,
    'AREA',
    'Specify first corner point or [Object/Add area/Subtract area] <Object>:',
  );
  await answer(page, '-260,575', 'Specify next point or [Arc/Length/Undo]:');
  await answer(page, '-200,575', 'Specify next point or [Arc/Length/Undo]:');
  await answer(page, '-200,600', 'Specify next point or [Arc/Length/Undo/Total] <Total>:');
  await shot('1-area-points.png');
  await answer(page, '-260,600', 'Specify next point or [Arc/Length/Undo/Total] <Total>:');
  await answer(page, '', 'Command:');
  await expect(log).toContainText('Area = 1500.0000, Perimeter = 170.0000');
  await shot('2-area-measured.png');
  await answer(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await answer(page, 'AREA', 'Command:');
  await expect(log).toContainText('AREA = 1500.0000 (read only)');

  await answer(page, 'MEA', QUICK);
  await answer(page, 'A', 'Select arc, circle, line, or <Specify vertex>:');
  await answer(page, '', 'Specify angle vertex:');
  await answer(page, '-260,600', 'Specify first angle endpoint:');
  await answer(page, '-250,600', 'Specify second angle endpoint:');
  await answer(
    page,
    '-260,610',
    'Enter an option [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:',
  );
  await expect(log).toContainText('Angle = 90.00°');
  await answer(page, '', 'Command:');
});

const QUICK = 'Move cursor or [Distance/Radius/Angle/ARea/Volume/Quick/Mode/eXit] <eXit>:';

// M3-07 part 2: MEASUREGEOM Quick measures under the cursor and the spaces clicked; AREA's Arc
// option; LIST. Away from the drawing's own objects: a 100×60 rectangle at (1000,1000) with a
// circle of radius 10 inside it at (1020,1030), zoomed so the rectangle's centre is the canvas's.
test('MEASUREGEOM Quick, the Arc option and LIST', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const canvas = page.locator('canvas.drawing-canvas').first();

  await answer(page, 'RECTANG', /^Specify first corner point/);
  await answer(page, '1000,1000', /^Specify other corner point/);
  await answer(page, '1100,1060', 'Command:');
  await answer(page, 'CIRCLE', /^Specify center point for circle/);
  await answer(page, '1020,1030', /^Specify radius of circle/);
  await answer(page, '10', 'Command:');
  const coords = await page.getByTestId('coords').textContent();
  await answer(page, 'ZOOM', /^Specify corner of window/);
  await answer(page, 'W', /^Specify first corner/);
  await answer(page, '980,980', /^Specify opposite corner/);
  await answer(page, '1120,1080', 'Command:');
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.width / 2, y: box.height / 2 };
  // The view's centre is the rectangle's; the circle's is 30 units to its left.
  await canvas.hover({ position: centre });
  await expect(page.getByTestId('coords')).not.toHaveText(coords ?? '');
  const scale = Math.min(box.width / 140, box.height / 100);
  const circle = { x: centre.x - 30 * scale, y: centre.y };

  // LIST the circle, the last object drawn.
  await answer(page, 'LIST', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', 'Command:');
  // The recent lines show LIST's last: the circle's circumference and area.
  await expect(log).toContainText('circumference 62.8319');
  await expect(log).toContainText('area 314.1593');

  // AREA with an arc: the rectangle's right side bulged out into a half circle.
  await answer(page, 'AREA', /^Specify first corner point/);
  await answer(page, '1000,1000', 'Specify next point or [Arc/Length/Undo]:');
  await answer(page, '1100,1000', 'Specify next point or [Arc/Length/Undo]:');
  await answer(
    page,
    'A',
    'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo]:',
  );
  await canvas.hover({ position: { x: centre.x + 60 * scale, y: centre.y - 10 * scale } });
  await shot('1-area-arc-dragged.png');
  await answer(
    page,
    '1100,1060',
    'Specify endpoint of arc or [Angle/CEnter/CLose/Direction/Line/Radius/Second pt/Undo/Total] <Total>:',
  );
  await answer(page, 'L', 'Specify next point or [Arc/Length/Undo/Total] <Total>:');
  await answer(page, '1000,1060', 'Specify next point or [Arc/Length/Undo/Total] <Total>:');
  await answer(page, '', 'Command:');
  await expect(log).toContainText('Area = 7413.7167, Perimeter = 354.2478');

  // Quick: the distances across the cursor, wall to circle and floor to ceiling.
  await answer(page, 'MEASUREGEOM', QUICK);
  const labels = page.getByTestId('quick-measure').locator('.quick-measure-label');
  await canvas.hover({ position: { x: centre.x + 5, y: centre.y + 5 } });
  await canvas.hover({ position: centre });
  await expect(labels.filter({ hasText: /^70\.0000$/ })).toHaveCount(1);
  await expect(labels.filter({ hasText: /^60\.0000$/ })).toHaveCount(1);
  await shot('2-quick-hover.png');
  // Over the rectangle's bottom edge: its length and the right angles at its ends.
  await canvas.hover({ position: { x: centre.x, y: centre.y + 30 * scale } });
  await expect(labels.filter({ hasText: /^100\.0000$/ })).toHaveCount(1);
  await expect(labels.filter({ hasText: '90.00°' })).toHaveCount(2);
  await shot('3-quick-edge.png');
  // A click measures the space, the circle taken out; Shift-click adds the circle's.
  await canvas.click({ position: centre });
  await expect(log).toContainText('Area = 5685.8407, Perimeter = 382.8319');
  await shot('4-quick-clicked.png');
  await canvas.click({ position: circle, modifiers: ['Shift'] });
  await expect(log).toContainText('Total area = 6000.0000, Total perimeter = 445.6637');
  await shot('5-quick-shift-clicked.png');
  await answer(page, '', 'Command:');
  await expect(labels).toHaveCount(0);
});
