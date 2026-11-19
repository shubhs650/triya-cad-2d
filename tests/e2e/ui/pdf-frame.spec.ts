// M5-04 part 17: PDFFRAME on the PDF underlay test drawing (packages/testkit/src/underlay/
// fixture.ts: page 1, 8.5 × 11 in, at the origin, a unit an inch), its PDF dropped. Page 1's
// left edge is outlined at PDFFRAME's initial 1; 0 hides the outline, which comes back as the
// selection's while the underlay is selected; 2 shows it again. Plots are unit-tested (render
// plot/job.test.ts, pdf import.test.ts and svg.test.ts), the variable in engine setvar.test.ts.
// SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { colourAt, expectShown, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Off the canvas, so neither the selection preview nor Dynamic Input shows. */
const park = (page: Page) => page.mouse.move(640, 708);

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await park(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

type Rgb = readonly number[];
/** The dark model canvas, #212830 (UI_SPEC.md §6). */
const isCanvas = ([r, g, b]: Rgb) =>
  Math.abs(r! - 0x21) + Math.abs(g! - 0x28) + Math.abs(b! - 0x30) < 24;

test('PDFFRAME 0 hides the underlay frame but for the selection, 2 shows it again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'pdf-underlay.dxf');
  await openWithDrop(page, PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '-1,-1', 'Specify opposite corner:');
  await type(page, '10,12', 'Command:');
  const v = await viewOf(page);
  // viewOf leaves the cursor on the canvas, inside page 1: once the page's size is known the
  // selection preview outlines the underlay under it, PDFFRAME or not (CI run 44463018807).
  await park(page);
  // The page's left edge, where page 1 has no content: the frame, a pixel wide, lies within a
  // pixel of world x 0 whichever way it rounds.
  const edge = v.at(0, 6);
  const framed = async () => {
    for (const dx of [-1, 0, 1])
      if (!isCanvas(await colourAt(page, { x: edge.x + dx, y: edge.y }))) return true;
    return false;
  };
  const poll = (shown: boolean) =>
    expect.poll(framed, { timeout: 30_000, intervals: [250] }).toBe(shown);

  await poll(true);
  // Under the resting cursor, the preview shows the frame at PDFFRAME 0 as the selection does.
  const inside = v.at(4, 5);
  await page.mouse.move(v.box.x + inside.x, v.box.y + inside.y);
  await page.mouse.move(v.box.x + inside.x + 1, v.box.y + inside.y);
  await type(page, 'PDFFRAME', 'Enter new value for PDFFRAME <1>:');
  await type(page, '0', 'Command:');
  await poll(true);
  await park(page);
  await poll(false);
  await type(page, 'PDFFRAME', 'Enter new value for PDFFRAME <0>:');
  await type(page, '1', 'Command:');
  await poll(true);
  await shot(page, '1-pdfframe-1');

  await type(page, 'PDFFRAME', 'Enter new value for PDFFRAME <1>:');
  await type(page, '0', 'Command:');
  await poll(false);
  await shot(page, '2-pdfframe-0');

  // Picked by its page's edge, it shows the outline as the selection's.
  await page.mouse.click(v.box.x + edge.x, v.box.y + edge.y);
  await park(page);
  await poll(true);
  await shot(page, '3-pdfframe-0-selected');
  await page.keyboard.press('Escape');
  await poll(false);

  await type(page, 'PDFFRAME', 'Enter new value for PDFFRAME <0>:');
  await type(page, '2', 'Command:');
  await poll(true);
});
