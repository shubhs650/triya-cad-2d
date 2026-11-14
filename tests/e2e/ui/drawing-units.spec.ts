// M2-35 part 17: the command line shows lengths and angles in the drawing's units, as AutoCAD's
// RTOS and ANGTOS write them: set LUNITS to architectural and AUNITS to degrees/minutes/seconds,
// and TEXT reports its height and asks for the next one in feet and inches, and its rotation in
// degrees. The formats are unit-tested in packages/engine/test/commands/units.test.ts.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('TEXT reports and asks in feet and inches once LUNITS is architectural', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // Decimal first, as the drawing has it.
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await expect(log).toContainText(/Text height: {2}\d+\.\d{4} {2}Annotative/);
  await type(page, '10,10', /^Specify height <\d+\.\d{4}>:$/);
  await shot(page, '1-before-decimal');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'LUNITS', /^Enter new value for LUNITS <\d>:$/);
  await type(page, '4', 'Command:');
  await type(page, 'AUNITS', /^Enter new value for AUNITS <\d>:$/);
  await type(page, '1', 'Command:');

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await expect(log).toContainText(/Text height: {2}\d+'-\d+(?: \d+\/\d+)?" {2}Annotative/);
  await type(page, '10,10', /^Specify height <\d+'-\d+(?: \d+\/\d+)?">:$/);
  // A height typed in feet and inches, then the rotation's default in degrees.
  await type(page, `1'-6"`, /^Specify rotation angle of text <0d[0-9'".]*>:$/);
  await shot(page, '2-after-architectural');
  await type(page, '', 'Enter text:');
  await type(page, 'Note', 'Enter text:');
  await type(page, '', 'Command:');

  // The height the text took is the next default, shown as it was given.
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '10,10', `Specify height <1'-6">:`);
});

// M2-35 part 18: in surveyor's units the rotation's default is a bearing, a bearing typed at the
// prompt reads (with no spaces, as a space ends the input), and it is the next default.
test('TEXT takes and offers its rotation as a bearing once AUNITS is surveyor', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'AUNITS', /^Enter new value for AUNITS <\d>:$/);
  await type(page, '4', 'Command:');
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '10,10', /^Specify height <[^>]+>:$/);
  await type(page, '', 'Specify rotation angle of text <E>:');
  await type(page, 'N30dW', 'Enter text:');
  await type(page, 'Bearing', 'Enter text:');
  await shot(page, '3-after-bearing-text');
  await type(page, '', 'Command:');

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '20,20', /^Specify height <[^>]+>:$/);
  // The drawing's AUPREC may show minutes (`N 30d0' W`).
  await type(page, '', /^Specify rotation angle of text <N 30d[0-9'"]* W>:$/);
  await shot(page, '4-after-bearing-default');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});
