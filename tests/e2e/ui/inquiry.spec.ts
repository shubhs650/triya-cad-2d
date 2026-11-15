// M3-07: the inquiry commands from the app's command line. ID, DIST, AREA and MEASUREGEOM write
// their results in the command history, AREA shows the polygon measured while its points are
// given, and SETVAR reads the AREA variable back. The prompts and every result line are
// unit-tested in packages/engine/test/commands/inquiry.test.ts. The drawing's AUPREC is 2.
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

  await answer(page, 'MEA', 'Enter an option [Distance/Radius/Angle/ARea/Volume] <Distance>:');
  await answer(page, 'A', 'Select arc, circle, line, or <Specify vertex>:');
  await answer(page, '', 'Specify angle vertex:');
  await answer(page, '-260,600', 'Specify first angle endpoint:');
  await answer(page, '-250,600', 'Specify second angle endpoint:');
  await answer(
    page,
    '-260,610',
    'Enter an option [Distance/Radius/Angle/ARea/Volume/eXit] <eXit>:',
  );
  await expect(log).toContainText('Angle = 90.00°');
  await answer(page, '', 'Command:');
});
