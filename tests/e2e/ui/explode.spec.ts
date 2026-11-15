// M3-12 part 7: EXPLODE of MTEXT from the app's canvas (AutoCAD Help, "EXPLODE (Command)":
// "Multiline Text: Explodes into text objects"). The engine worker has no fonts, so EXPLODE asks
// the canvas to lay each MTEXT out (`textPieces`) and makes a TEXT of each run; the drawing looks
// the same afterwards, and LIST then lists a TEXT where an MTEXT was. What each run becomes is
// unit-tested in packages/render (text-pieces.test.ts) and packages/engine
// (edit/explode-mtext.test.ts).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectDrawn, expectShown, inkWeight, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const MTEXTS = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../corpus/public/third-party/ezdxf/examples_dxf/mtext_complex_inline_codes.dxf',
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('EXPLODE turns MTEXT into TEXTs laid out as the canvas drew it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, MTEXTS);
  await expectShown(page, path.basename(MTEXTS));
  await type(page, 'ZOOM', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const before = await inkWeight(page);
  await closeUp(page, '9-mtext-before-explode');

  await type(page, 'LIST', /^Select objects/);
  await type(page, 'L', /^Select objects/);
  await type(page, '', 'Command:');
  // LIST's last line for an MTEXT is not a TEXT's ("generation", its mirroring).
  await expect(history(page)).not.toContainText('generation');

  await type(page, 'X', /^Select objects/);
  await type(page, 'ALL', /^Select objects/);
  await type(page, '', 'Command:');
  await expect(history(page)).not.toContainText('cannot be laid out');

  await type(page, 'LIST', /^Select objects/);
  await type(page, 'L', /^Select objects/);
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('generation');
  await page.waitForTimeout(500);
  // The same text on the same places: the ink is near what it was.
  const after = await inkWeight(page);
  expect(after).toBeGreaterThan(before * 0.85);
  expect(after).toBeLessThan(before * 1.15);
  await closeUp(page, '10-mtext-after-explode');
});

/** A screenshot of the left column's top close up, the view then put back (ZOOM Previous). */
async function closeUp(page: Page, name: string): Promise<void> {
  if (!process.env['TRIYA_SCREENSHOTS']) return;
  await page.mouse.move(300, 150);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(800);
  await shot(page, name);
  await type(page, 'ZOOM', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
}
