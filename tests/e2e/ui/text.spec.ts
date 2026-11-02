// M1-72: text draws in the app. The drawing's TEXT uses the STANDARD style's font, txt, which
// no device has; it draws with the bundled Hershey fonts, which ship inside the app, so this
// holds offline too.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** A LINE along the bottom and, unless `bare`, a TEXT above it filling most of the view. */
function drawing(bare: boolean): string {
  const text = bare
    ? []
    : [
        ...['0', 'TEXT', '5', '101', '100', 'AcDbEntity', '8', '0', '100', 'AcDbText'],
        ...['10', '0', '20', '10', '30', '0', '40', '12', '1', 'TRIYA TEXT 2D', '100', 'AcDbText'],
      ];
  return [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015'],
    ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
    ...['0', 'LINE', '5', '100', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine'],
    ...['10', '0', '20', '0', '30', '0', '11', '150', '21', '0', '31', '0'],
    ...text,
    ...['0', 'ENDSEC', '0', 'EOF', ''],
  ].join('\r\n');
}

test('draws TEXT with the bundled fonts', async ({ page }) => {
  const bare = test.info().outputPath('line.dxf');
  const withText = test.info().outputPath('text.dxf');
  writeFileSync(bare, drawing(true));
  writeFileSync(withText, drawing(false));

  await page.goto(app.url);
  await openWithPicker(page, bare);
  await expectShown(page, 'line.dxf');
  const lineOnly = await ink(page);

  await openWithPicker(page, withText);
  await expectShown(page, 'text.dxf');
  // Thirteen characters 12 units tall across a 150-unit view: thousands of stroked pixels.
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(lineOnly + 3_000);
});
