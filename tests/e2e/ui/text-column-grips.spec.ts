// M2-26 part 2: the grips of an MTEXT set in columns, on the canvas. Picked at `Command:`, an
// MTEXT in dynamic columns shows its insertion point (a square) and triangles for the column
// width, the gutter and the column height; dragging the height grip lower makes the columns
// taller, and the text, needing fewer of them, takes fewer (the canvas counts them, as the
// engine has no fonts). One undo takes it all back. The grips' places and what each does are
// unit-tested in packages/engine (test/edit/mtext-grips.test.ts, test/commands/mtext-grips.test.ts),
// the count in packages/render (test/column-counter.test.ts).
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * An R2018 DXF with a line under an MTEXT of six one-line paragraphs, 2.5 high, at (20, 80)
 * top left, in dynamic columns of auto height: 30 wide, gutter 5, 10 high. Two lines fit a
 * column 10 high, so the text takes three columns.
 */
function dynamicColumns(): string {
  return [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1032'],
    ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
    ...['0', 'LINE', '5', '100', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine'],
    ...['10', '0', '20', '0', '30', '0', '11', '160', '21', '0', '31', '0'],
    ...['0', 'MTEXT', '5', '101', '100', 'AcDbEntity', '8', '0', '100', 'AcDbMText'],
    ...['10', '20', '20', '80', '30', '0', '40', '2.5', '41', '30', '46', '10', '71', '1'],
    ...['1', 'one\\Ptwo\\Pthree\\Pfour\\Pfive\\Psix', '101', 'Embedded Object', '70', '1'],
    ...['10', '1', '20', '0', '30', '0', '11', '20', '21', '80', '31', '0'],
    ...['40', '30', '41', '10', '42', '100', '43', '10', '71', '2', '72', '3', '44', '30'],
    ...['45', '5', '73', '1', '74', '0'],
    ...['0', 'ENDSEC', '0', 'EOF', ''],
  ].join('\r\n');
}

/** The MTEXT as the edits so far left it, or undefined before any. */
const edited = (page: Page) =>
  page.evaluate(() => {
    let out: MTextGeometry | undefined;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        if (u.after.geom.kind === 'MTEXT') out = u.after.geom as MTextGeometry;
      }
    }
    return out;
  });

/**
 * The pixels around a point, counted: `bright` near white (the text, ACI 7 on the dark canvas),
 * `blue` grips (ACI 150) and `red` the hot one (ACI 12).
 */
async function gripPixels(page: Page, x: number, y: number, r = 7) {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let bright = 0;
    let blue = 0;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (R > 200 && G > 200 && B > 200) bright++;
      else if (B > 180 && R < 80) blue++;
      else if (R > 150 && G < 60 && B < 60) red++;
    }
    return { bright, blue, red };
  }, png.toString('base64'));
}

test('a columned MTEXT shows its column grips; the height grip makes taller columns', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const file = test.info().outputPath('dynamic-columns.dxf');
  writeFileSync(file, dynamicColumns());
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, 'dynamic-columns.dxf');
  // A zoom typed the moment the drawing shows can find no canvas yet ("There is no view to
  // change.", the race M2-37 tracks): asked again until it zooms.
  const lines = page.getByRole('log', { name: 'Recent command lines' });
  await expect
    .poll(
      async () => {
        await type(
          page,
          'Z',
          'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
        );
        await type(page, '0,0', 'Specify opposite corner:');
        await type(page, '160,100', 'Command:');
        return (await lines.textContent())?.endsWith('There is no view to change.');
      },
      { timeout: 20_000 },
    )
    .toBe(false);
  const canvas = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(canvas.width / 160, canvas.height / 100);
  const at = (x: number, y: number) => ({
    x: canvas.x + canvas.width / 2 + (x - 80) * k,
    y: canvas.y + canvas.height / 2 - (y - 50) * k,
  });

  // Picked by its first line, "one", once its font has drawn it: the grips show.
  const one = at(23, 79);
  await expect
    .poll(async () => (await gripPixels(page, one.x, one.y)).bright, { timeout: 15_000 })
    .toBeGreaterThan(4);
  await page.screenshot({ path: 'test-results/text-column-grips/0-opened.png' });
  await page.mouse.click(one.x, one.y);
  const width = at(50, 80);
  const gutter = at(55, 80);
  const height = at(35, 70);
  await expect
    .poll(async () => (await gripPixels(page, height.x, height.y)).blue)
    .toBeGreaterThan(8);
  await page.screenshot({ path: 'test-results/text-column-grips/1-column-grips.png' });
  expect((await gripPixels(page, width.x, width.y)).blue).toBeGreaterThan(8);
  expect((await gripPixels(page, gutter.x, gutter.y)).blue).toBeGreaterThan(8);

  // The height grip goes hot; dragged 10 lower the columns are 20 high.
  await page.mouse.click(height.x, height.y);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  const to = at(35, 60);
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.screenshot({ path: 'test-results/text-column-grips/2-height-dragged.png' });
  // The point typed, so the height is exact.
  await type(page, '35,60', 'Command:');
  await expect.poll(async () => (await edited(page))?.columns?.count).toBe(2);
  const after = (await edited(page))!;
  expect(after.definedHeight).toBeCloseTo(20, 6);
  expect(after.columns).toMatchObject({ type: 2, autoHeight: true, width: 30, gutter: 5 });
  // The MTEXT stays selected, its grips where the taller columns put them.
  const away = at(120, 30);
  await page.mouse.move(away.x, away.y);
  await page.screenshot({ path: 'test-results/text-column-grips/3-taller-columns.png' });

  // One undo takes back the height and the count.
  await type(page, 'U', 'Command:');
  await expect.poll(async () => (await edited(page))?.columns?.count).toBe(3);
  expect((await edited(page))!.definedHeight).toBeCloseTo(10, 6);
});
