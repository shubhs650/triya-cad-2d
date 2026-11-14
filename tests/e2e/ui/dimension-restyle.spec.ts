// M2-30 part 2: a dimension redrawn when the Properties palette restyles it, in the app. On an
// empty part of the acadsharp AC1032 sample's plan (current dimension style Standard, text
// 0.18 high), DIMLINEAR dimensions a line; the dimension is picked and the palette gives it
// the drawing's ISO-25 style (text 2.5 high), then a Text height override of 0.5 and a text
// override, each redrawing its block at once; U takes the last back. What regenerates and the
// DSTYLE xdata written are unit-tested in packages/engine/test/commands/restyle.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry, Entity } from '@triya/engine';
import { activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The dimension this test made: its text override and the texts its block holds. */
const dimension = (page: Page) =>
  page.evaluate(() => {
    let dim: DimensionGeometry | undefined;
    const texts = new Map<string, { owner: string; contents: string; height: number }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dim = e.geom;
        if (e.geom.kind === 'MTEXT') {
          texts.set(e.handle, { owner: e.owner, contents: e.geom.contents, height: e.geom.height });
        }
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) texts.delete(r.entity.handle);
    }
    if (!dim) return undefined;
    const drawn = [...texts.values()].filter((t) => t.owner === dim!.block);
    return {
      text: dim.text,
      drawn: drawn.map((t) => ({
        contents: t.contents.replace(/^\\A1;/, ''),
        height: Math.round(t.height * 1000) / 1000,
      })),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('the Properties palette restyles a dimension, which is redrawn at once', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor below the canvas, where Dynamic Input leaves them.
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-4, -8), 'Specify opposite corner:');
  await type(page, p(12, 6), 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -1.5), 'Command:');
  await expect
    .poll(() => dimension(page))
    .toEqual({ text: '', drawn: [{ contents: expect.stringMatching(/^8/), height: 0.18 }] });

  const palette = page.getByRole('complementary', { name: 'Properties' });
  const undocked = (await canvas.boundingBox())!.width;
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  // The palette narrowed the canvas: pick the dimension line at (2, -1.5) where it is now.
  // The click below is worked out from the canvas beside the docked palette: wait for the canvas
  // to take that size and draw at it (CI once clicked the undocked canvas's spot and missed).
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(undocked);
  await expectDrawn(page, { timeout: 15_000 });
  const docked = (await canvas.boundingBox())!;
  const k = Math.min(docked.width / 16, docked.height / 14);
  await page.mouse.click(
    docked.x + docked.width / 2 + (2 - 4) * k,
    docked.y + docked.height / 2 - (-1.5 + 1) * k,
  );
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'Dimension (1)',
  );
  const style = palette.getByRole('combobox', { name: 'Dim style' });
  await expect(style).toHaveValue(/.+/);
  await shot('1-before-restyle.png');

  await style.selectOption({ label: 'ISO-25' });
  await expect
    .poll(() => dimension(page))
    .toEqual({ text: '', drawn: [{ contents: expect.stringMatching(/^8/), height: 2.5 }] });
  await shot('2-iso-25.png');

  const height = palette.getByRole('textbox', { name: 'Text height', exact: true });
  await height.fill('0.5');
  await height.press('Enter');
  await expect
    .poll(() => dimension(page))
    .toEqual({ text: '', drawn: [{ contents: expect.stringMatching(/^8/), height: 0.5 }] });

  const override = palette.getByRole('textbox', { name: 'Text override' });
  await override.fill('<> TYP');
  await override.press('Enter');
  await expect
    .poll(() => dimension(page))
    .toEqual({
      text: '<> TYP',
      drawn: [{ contents: expect.stringMatching(/^8.* TYP$/), height: 0.5 }],
    });
  await shot('3-height-and-override.png');

  await palette.getByRole('heading', { name: 'Properties' }).click();
  await canvas.hover();
  await off();
  await type(page, 'U', 'Command:');
  await expect
    .poll(() => dimension(page))
    .toEqual({ text: '', drawn: [{ contents: expect.stringMatching(/^8/), height: 0.5 }] });
});
