// M6-02 part 2: clipped layout viewports. sample_AC1018.dwg's MyLayout has one floating viewport
// showing model space on most of the sheet. VPCLIP clips it to a small triangle in a corner of a
// band across it, so the rest of the band turns blank paper, and U takes the clip back. With it
// turned off, MVIEW Polygonal makes a viewport clipped by a polygon drawn in the band, showing
// model space there again; VPCLIP Delete keeps it showing as a rectangle, and U takes each back.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  lightPixels,
  openWithPicker,
  worldAt,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('VPCLIP and MVIEW Polygonal clip layout viewports to polygons', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });

  // A band across the middle of the sheet, inside the viewport's frame, where model space shows.
  const box = (await activeCanvas(page).boundingBox())!;
  const a = { x: box.width * 0.22, y: box.height * 0.3 };
  const b = { x: box.width * 0.45, y: box.height * 0.8 };
  const area = Math.round((b.x - a.x) * (b.y - a.y));
  const blank = () => lightPixels(page, { x: a.x + 4, y: a.y + 4 }, { x: b.x - 4, y: b.y - 4 });
  const at = async (x: number, y: number) => {
    const p = await worldAt(page, x, y);
    return `${p.x},${p.y}`;
  };
  // The cursor off the band, where no crosshair or rollover tooltip covers it.
  const park = () => page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
  const shown = await blank();
  expect(shown).toBeLessThan(area * 0.97);

  // VPCLIP: the layout's viewport (ALL takes it with the rest) clipped to a triangle in the
  // band's top left corner; Enter after the third point closes it.
  const w = b.x - a.x;
  const h = b.y - a.y;
  const triangle = [
    await at(a.x - 10, a.y - 10),
    await at(a.x + w * 0.25, a.y - 10),
    await at(a.x - 10, a.y + h * 0.25),
  ];
  await park();
  await enterCommand(page, 'VPCLIP');
  await enterCommand(page, 'ALL');
  await enterCommand(page, 'P');
  for (const p of triangle) await enterCommand(page, p);
  await enterCommand(page, '');
  await expectInputsRead(page);
  await expect.poll(blank).toBeGreaterThan(shown + 200);
  const clipped = await blank();
  await enterCommand(page, 'U');
  await expect.poll(blank).toBeLessThan(clipped - 200);

  // MVIEW OFF, then a polygonal viewport across the band shows model space in it again.
  await enterCommand(page, 'MVIEW');
  await enterCommand(page, 'OFF');
  await enterCommand(page, 'ALL');
  await enterCommand(page, '');
  await expect.poll(blank).toBeGreaterThan(shown + 200);
  const off = await blank();
  const polygon = [
    await at(a.x, a.y),
    await at(b.x, a.y),
    await at(b.x, (a.y + b.y) / 2),
    await at((a.x + b.x) / 2, b.y),
    await at(a.x, b.y),
  ];
  await park();
  await enterCommand(page, 'MV');
  await enterCommand(page, 'P');
  for (const p of polygon) await enterCommand(page, p);
  await enterCommand(page, 'C');
  await expectInputsRead(page);
  await expect.poll(blank).toBeLessThan(off - 200);

  // VPCLIP Delete: the polygon goes and the viewport is a rectangle on its box, still showing.
  await enterCommand(page, 'VPCLIP');
  await enterCommand(page, 'L');
  await enterCommand(page, 'D');
  await expectInputsRead(page);
  await expect.poll(blank).toBeLessThan(off - 200);
  await enterCommand(page, 'U');
  await enterCommand(page, 'U');
  await expect.poll(blank).toBeGreaterThan(off - 50);
});
