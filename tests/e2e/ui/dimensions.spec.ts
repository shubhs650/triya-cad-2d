// M2-11: the dimension commands in the app as a drafter uses them, on an empty part of the
// acadsharp AC1032 sample's plan (its current dimension style). A triangle is drawn with LINE;
// DIMLINEAR dimensions its base, the dimension following the cursor while its location is
// asked for; DIMCONTINUE carries on along the same dimension line; DIMALIGNED dimensions the
// slope and DIMANGULAR the angle at the first corner. A double click on the first dimension's
// text opens it in the MTEXT editor, and the text typed there becomes its override. The
// commands, their placement rules and grips are unit-tested in packages/engine; what the
// dimension engine draws for them, and their save, in packages/dims and packages/testkit.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry, Entity } from '@triya/engine';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
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

/**
 * The dimensions made in this test as they stand now: type, override, whether their block is
 * drawn, and the texts their block holds.
 */
const dimensions = (page: Page) =>
  page.evaluate(() => {
    const dims = new Map<string, DimensionGeometry>();
    const texts = new Map<string, { owner: string; contents: string }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dims.set(e.handle, e.geom);
        if (e.geom.kind === 'MTEXT')
          texts.set(e.handle, { owner: e.owner, contents: e.geom.contents });
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) {
        dims.delete(r.entity.handle);
        texts.delete(r.entity.handle);
      }
    }
    return [...dims.values()].map((g) => ({
      type: g.dimType,
      text: g.text,
      drawn: [...texts.values()]
        .filter((t) => t.owner === g.block)
        .map((t) => t.contents.replace(/^\\A1;/, '')),
    }));
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;
const LOCATION = /^Specify dimension line location or \[Mtext\/Text\/Angle/;

test('dimension commands, and a dimension text edited by a double click', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor off the canvas, where Dynamic Input does not take them
  // as relative to the last point.
  // (Below the canvas: above it the document tab shows its preview on hover.)
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(15, 7), 'Command:');
  // ZOOM Window fits 16 × 10 units about (7, 2) into the canvas: the current style's text is
  // AutoCAD's imperial 0.18 high.
  const k = Math.min(box.width / 16, box.height / 10);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 7) * k,
    y: box.y + box.height / 2 - (y - 2) * k,
  });
  // Running object snaps would pull the cursor onto the triangle; off.
  await page.keyboard.press('F3');

  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 5), 'Specify next point or [Close/Undo]:');
  await type(page, 'C', 'Command:');
  await shot('1-before.png');

  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), LOCATION);
  // Dragged: the dimension follows the cursor before it is placed.
  const under = at(4, -1.5);
  await page.mouse.move(under.x, under.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('2-dimlinear-drag.png');
  await off();
  await type(page, p(4, -1.5), 'Command:');

  await type(
    page,
    'DIMCONTINUE',
    'Specify a second extension line origin or [Undo/Select] <Select>:',
  );
  await type(page, p(13, 0), 'Specify a second extension line origin or [Undo/Select] <Select>:');
  await type(page, '', 'Select continued dimension:');
  await type(page, '', 'Command:');
  await type(page, 'DIMALIGNED', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 5), LOCATION);
  await type(page, p(3, 4), 'Command:');
  await type(page, 'DIMANGULAR', 'Select arc, circle, line, or <specify vertex>:');
  await type(page, '', 'Specify angle vertex:');
  await type(page, p(0, 0), 'Specify first angle endpoint:');
  await type(page, p(8, 0), 'Specify second angle endpoint:');
  await type(page, p(8, 5), /^Specify dimension arc line location/);
  await type(page, p(4, 1), 'Command:');

  await expect
    .poll(() => dimensions(page))
    .toEqual([
      { type: 'linear', text: '', drawn: [expect.stringMatching(/^8/)] },
      { type: 'linear', text: '', drawn: [expect.stringMatching(/^5/)] },
      { type: 'aligned', text: '', drawn: [expect.stringMatching(/^9\.43/)] },
      { type: 'angular3pt', text: '', drawn: [expect.stringMatching(/^32/)] },
    ]);
  await page.waitForTimeout(300);
  await shot('3-dimensioned.png');

  // A double click on the first dimension's text: TEXTEDIT in the MTEXT editor, the measurement
  // shown in place of `<>` (M2-31 part 2).
  const textAt = await page.evaluate(() => {
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'DIMENSION') return a.entity.geom.textPosition;
      }
    }
    return undefined;
  });
  const mid = at(textAt!.x - O, textAt!.y - O);
  await page.mouse.dblclick(mid.x, mid.y);
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(/^8(\.0*)?$/);
  await expect(editor.locator('.mtext-field')).toHaveText(/^8/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' TYP');
  await shot('4-editing-text.png');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Select an annotation object or [Undo/Mode]:');
  await type(page, '', 'Command:');
  await expect
    .poll(() => dimensions(page).then((d) => d[0]))
    .toEqual({ type: 'linear', text: '<> TYP', drawn: [expect.stringMatching(/^8.* TYP$/)] });
  await page.waitForTimeout(300);
  await shot('5-after-edit.png');
});

// M2-31 part 2: DIMRADIUS on the sample's arc (handle 320, from 341° round to 161°) with its
// location past the arc's end draws an arc extension line along the arc's circle, and the Mtext
// option's editor shows the measurement itself, highlighted, where `<>` stands.
test("DIMRADIUS past an arc's end, its text given in the MTEXT editor", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  const c = { x: 56.35179242595231, y: 4.697601732518876 };
  const r = 3.044494390598888;
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, `${c.x - 10},${c.y - 8}`, 'Specify opposite corner:');
  await type(page, `${c.x + 10},${c.y + 8}`, 'Command:');
  const k = Math.min(box.width / 20, box.height / 16);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - c.x) * k,
    y: box.y + box.height / 2 - (y - c.y) * k,
  });
  await page.keyboard.press('F3');
  await shot('6-arc-before.png');

  await type(page, 'DIMRADIUS', 'Select arc or circle:');
  const top = at(c.x, c.y + r);
  await page.mouse.click(top.x, top.y);
  await expect(prompt(page)).toHaveText(LOCATION);
  await off();
  await type(page, 'M', /^Enter dimension text/);
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await expect(editor.locator('.mtext-field')).toHaveText(/^3\.04/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' TYP');
  await shot('7-mtext-measurement.png');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText(LOCATION);
  // At 230°, 50° past the arc's end at 161°.
  const a = (230 * Math.PI) / 180;
  const loc = { x: c.x + 2.2 * r * Math.cos(a), y: c.y + 2.2 * r * Math.sin(a) };
  const under = at(loc.x, loc.y);
  await page.mouse.move(under.x, under.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('8-dimradius-drag.png');
  await off();
  await type(page, `${loc.x},${loc.y}`, 'Command:');

  const made = () =>
    page.evaluate((radius) => {
      let dim: Entity | undefined;
      const arcs = new Map<string, { owner: string; start: number; end: number }>();
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const x of [
          ...(cs.entities?.added ?? []).map((a) => a.entity),
          ...(cs.entities?.updated ?? []).map((u) => u.after),
        ]) {
          if (x.geom.kind === 'DIMENSION') dim = x;
          if (x.geom.kind === 'ARC' && Math.abs(x.geom.radius - radius) < 1e-6)
            arcs.set(x.handle, { owner: x.owner, start: x.geom.startAngle, end: x.geom.endAngle });
        }
      }
      const g = dim?.geom as DimensionGeometry | undefined;
      return {
        type: g?.dimType,
        text: g?.text,
        extension: [...arcs.values()]
          .filter((x) => x.owner === g?.block)
          .map((x) => [Math.round((x.start * 180) / Math.PI), Math.round((x.end * 180) / Math.PI)]),
      };
    }, r);
  // From a DIMEXO gap past 161° to DIMEXE past 230°, in the dimension's block.
  await expect.poll(made).toMatchObject({ type: 'radius', text: '<> TYP' });
  const { extension } = await made();
  expect(extension).toHaveLength(1);
  expect(extension[0]![0]).toBeGreaterThanOrEqual(161);
  expect(extension[0]![0]).toBeLessThan(170);
  expect(extension[0]![1]).toBeGreaterThan(230);
  expect(extension[0]![1]).toBeLessThan(240);
  await page.waitForTimeout(300);
  await shot('9-arc-extension.png');
});
