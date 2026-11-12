// M2-42: a system variable's name typed at `Command:`, as AutoCAD takes it, and SETVAR, from the
// app's command line: a header variable (MIRRTEXT, an undoable edit of the drawing), a drafting
// aid the status bar shows (ORTHOMODE is the ORTHO button), and REVCLOUDGRIPS 0, which gives a
// revision cloud a grip at every arc's end instead of its corners. The prompts and refusals are
// unit-tested in packages/engine/test/commands/setvar.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
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

/** The value the change sets last gave header variable `name`. */
const headerNow = (page: Page, name: string) =>
  page.evaluate((n) => {
    let out: unknown;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const h of cs.header ?? []) if (h.name === n) out = h.after;
    }
    return out;
  }, name);

/** Grip-blue pixels (ACI 150) in a small square of the page around a point. */
async function blue(page: Page, p: { x: number; y: number }, r = 6): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 180 && d[i]! < 80) n++;
    return n;
  }, png.toString('base64'));
}

test('variables typed at Command:, SETVAR, and REVCLOUDGRIPS 0', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // A header variable by its name: MIRRTEXT, from the drawing's 1 to 0, one undo step.
  await type(page, 'MIRRTEXT', 'Enter new value for MIRRTEXT <1>:');
  await type(page, '2', 'Enter new value for MIRRTEXT <1>:');
  await expect(log).toContainText('Value must be between 0 and 1.');
  await type(page, '0', 'Command:');
  await expect.poll(() => headerNow(page, '$MIRRTEXT')).toBe(false);
  await type(page, 'SETVAR', 'Enter variable name or [?]:');
  await type(page, 'mirrtext', 'Enter new value for MIRRTEXT <0>:');
  await type(page, '', 'Command:');
  await type(page, 'U', 'Command:');
  await expect.poll(() => headerNow(page, '$MIRRTEXT')).toBe(true);
  await type(page, 'NOSUCHVARIABLE', 'Command:');
  await expect(log).toContainText('Unknown command "NOSUCHVARIABLE".  Press F1 for help.');

  // A drafting aid: ORTHOMODE is the status bar's ORTHO, and turns POLAR off as F8 does.
  const ortho = page.getByRole('button', { name: 'ORTHO', exact: true });
  const polar = page.getByRole('button', { name: 'POLAR', exact: true });
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'ORTHOMODE', 'Enter new value for ORTHOMODE <0>:');
  await type(page, '1', 'Command:');
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect(polar).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('F8');
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'ORTHOMODE', 'Enter new value for ORTHOMODE <0>:');
  await type(page, '', 'Command:');

  // REVCLOUDGRIPS: a 80 × 60 cloud of 5-unit arcs in an empty part of the drawing, zoomed so
  // 160 × 100 units fill the canvas.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const O = 1_000_000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 100}`, 'Command:');
  // Running object snaps would pull the clicks onto the cloud's own points; off.
  await page.keyboard.press('F3');
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'A', /^Specify minimum length of arc/);
  await type(page, '5', /^Specify maximum length of arc/);
  await type(page, '5', /^Specify first corner point or/);
  await type(page, `${O + 20},${O + 20}`, 'Specify opposite corner:');
  await type(page, `${O + 100},${O + 80}`, 'Command:');

  // REVCLOUDGRIPS 1 (AutoCAD's initial value): the corners only.
  const pick = at(100, 80);
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, at(20, 20))).toBeGreaterThan(20);
  expect(await blue(page, at(60, 20))).toBe(0);
  await shot('1-revcloudgrips-1.png');
  await page.keyboard.press('Escape');
  await expect.poll(() => blue(page, at(20, 20))).toBe(0);

  // REVCLOUDGRIPS 0: a grip at every arc's end, as before AutoCAD 2021.
  await type(page, 'REVCLOUDGRIPS', 'Enter new value for REVCLOUDGRIPS <1>:');
  await type(page, '0', 'Command:');
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, at(60, 20))).toBeGreaterThan(20);
  expect(await blue(page, at(20, 20))).toBeGreaterThan(20);
  await shot('2-revcloudgrips-0.png');
  // Dragging an arc's end moves that vertex only.
  const end = at(60, 20);
  await page.mouse.click(end.x, end.y);
  await expect(prompt(page)).toHaveText(/^Specify stretch point/);
  const to = at(60, 12);
  await page.mouse.click(to.x, to.y);
  await expect(prompt(page)).toHaveText('Command:');
  await shot('3-arc-end-dragged.png');
  await page.keyboard.press('Escape');
  // Back to 1, AutoCAD's initial value, which no header entry means (a save never writes it).
  await type(page, 'REVCLOUDGRIPS', 'Enter new value for REVCLOUDGRIPS <0>:');
  await type(page, '1', 'Command:');
  expect(await headerNow(page, 'REVCLOUDGRIPS')).toBe(undefined);
});
