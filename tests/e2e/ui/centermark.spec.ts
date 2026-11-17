// M4-08: CENTERMARK and CENTERLINE in the app as a drafter uses them, on an empty part of an
// ezdxf sample that has the CENTER2 linetype. A circle gets a center mark, two parallel lines a
// centerline, and the mark follows the circle when it is moved; saved and opened again, it still
// does (part 2, DEC-066). The commands are unit-tested in packages/engine and the save in testkit
// (center-marks.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
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

const FILE = path.join(CORPUS, 'ezdxf/integration_tests/mtext_text_frame.dxf');
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The marks' records, and where each mark's block reference is now. */
const state = (page: Page) =>
  page.evaluate(() => {
    const records = new Map<string, { insert: string; kind: string }>();
    const inserts = new Map<string, { x: number; y: number; linetype: string }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const o of cs.objects?.added ?? []) {
        if (o.type === 'TRIYA_CENTERMARK') records.set(o.handle, o as never);
      }
      for (const o of cs.objects?.removed ?? []) records.delete(o.handle);
      for (const e of [
        ...(cs.entities?.added ?? []).map((a) => a.entity),
        ...(cs.entities?.updated ?? []).map((u) => u.after),
      ]) {
        if (e.geom.kind === 'INSERT') {
          inserts.set(e.handle, { ...e.geom.position, linetype: e.linetype });
        }
      }
    }
    return [...records.values()].map((r) => ({ kind: r.kind, ...inserts.get(r.insert)! }));
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('CENTERMARK and CENTERLINE', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  // The window x −20…50, y −20…20 about (15, 0).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-20, -20), 'Specify opposite corner:');
  await type(page, p(50, 20), 'Command:');
  const k = Math.min(box.width / 70, box.height / 40);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 15) * k,
    y: box.y + box.height / 2 - y * k,
  });
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(q.x, q.y);
    await off();
  };
  await page.keyboard.press('F3');
  await type(page, 'CIRCLE', /^Specify center point/);
  await type(page, p(0, 0), /^Specify radius/);
  await type(page, '10', 'Command:');
  for (const y of [-10, 10]) {
    await type(page, 'LINE', /^Specify first point/);
    await type(page, p(20, y), /^Specify next point/);
    await type(page, p(40, y), /^Specify next point/);
    await type(page, '', 'Command:');
  }
  await page.waitForTimeout(300);
  await shot('1-before.png');

  await type(page, 'CENTERMARK', 'Select circle or arc to add center mark:');
  await click(10, 0);
  await expect.poll(async () => (await state(page)).length).toBe(1);
  await expect(prompt(page)).toHaveText('Select circle or arc to add center mark:');
  await type(page, '', 'Command:');
  await type(page, 'CENTERLINE', 'Select first line:');
  await click(30, -10);
  await expect(prompt(page)).toHaveText('Select second line:');
  await click(30, 10);
  await expect(prompt(page)).toHaveText('Command:');
  const made = await state(page);
  expect(made.map(({ kind, x, y }) => ({ kind, x: x - O, y: y - O }))).toEqual([
    { kind: 'mark', x: 0, y: 0 },
    { kind: 'line', x: 30, y: 0 },
  ]);
  // Both in the drawing's CENTER2 linetype, not ByLayer.
  expect(made.every((m) => m.linetype !== 'ByLayer')).toBe(true);
  await page.waitForTimeout(300);
  await shot('2-marked.png');

  // The circle, picked where the mark draws nothing, moved down: the mark follows.
  await type(page, 'MOVE', 'Select objects:');
  await click(10 * Math.SQRT1_2, 10 * Math.SQRT1_2);
  await type(page, '', /^Specify base point/);
  await type(page, p(0, 0), /^Specify second point/);
  await type(page, p(0, -6), 'Command:');
  await expect
    .poll(async () => (await state(page)).map(({ x, y }) => [x - O, y - O]))
    .toEqual([
      [0, -6],
      [30, 0],
    ]);
  await page.waitForTimeout(300);
  await shot('3-circle-moved.png');

  // Saved (downloaded, as without File System Access) and opened again: the mark's record came
  // back with it, so moving the circle back takes the mark along.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const saved = test.info().outputPath('centermarks-saved.dxf');
  await (await download).saveAs(saved);
  await openWithPicker(page, saved);
  await expectShown(page, path.basename(saved));
  expect(await state(page)).toEqual([]);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-20, -20), 'Specify opposite corner:');
  await type(page, p(50, 20), 'Command:');
  await page.waitForTimeout(300);
  await shot('4-reopened.png');
  await type(page, 'MOVE', 'Select objects:');
  await click(10 * Math.SQRT1_2, 10 * Math.SQRT1_2 - 6);
  await type(page, '', /^Specify base point/);
  await type(page, p(0, 0), /^Specify second point/);
  await type(page, p(0, 6), 'Command:');
  const followed = () =>
    page.evaluate(() =>
      (window as unknown as Dev).triyaDev
        .changes()
        .flatMap((cs) => cs.entities?.updated ?? [])
        .filter((u) => u.after.geom.kind === 'INSERT')
        .map((u) => (u.after.geom as { position: { x: number; y: number } }).position),
    );
  await expect
    .poll(async () => (await followed()).map(({ x, y }) => [x - O, y - O]))
    .toEqual([[0, 0]]);
  await page.waitForTimeout(300);
  await shot('5-reopened-circle-moved.png');
});

// M4-08 part 3: the CENTER* variables and the commands that edit marks. A mark made with a
// larger CENTERCROSSSIZE is let go of its circle (CENTERDISASSOCIATE: the circle moves without
// it), put on another circle (CENTERREASSOCIATE) and given CENTEREXE's new extension
// (CENTERRESET); MATCHPROP's Property Settings offers Center object (pedit.spec.ts).
test('the CENTER* variables, CENTERDISASSOCIATE, CENTERREASSOCIATE and CENTERRESET', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-20, -20), 'Specify opposite corner:');
  await type(page, p(50, 20), 'Command:');
  const k = Math.min(box.width / 70, box.height / 40);
  const click = async (x: number, y: number) => {
    await page.mouse.click(box.x + box.width / 2 + (x - 15) * k, box.y + box.height / 2 - y * k);
    await off();
  };
  await page.keyboard.press('F3');
  for (const [x, r] of [
    [0, 10],
    [35, 6],
  ] as const) {
    await type(page, 'CIRCLE', /^Specify center point/);
    await type(page, p(x, 0), /^Specify radius/);
    await type(page, String(r), 'Command:');
  }
  // A variable's name at Command: sets it (SETVAR).
  await type(page, 'CENTERCROSSSIZE', 'Enter new value for CENTERCROSSSIZE <"0.1x">:');
  await type(page, '0.25x', 'Command:');
  await type(page, 'CENTERMARK', 'Select circle or arc to add center mark:');
  await click(-10, 0);
  await expect.poll(async () => (await state(page)).length).toBe(1);
  await type(page, '', 'Command:');
  await page.waitForTimeout(300);
  await shot('1-cross-size.png');

  // Let go of its circle: the circle moves down without it.
  await type(page, 'CENTERDISASSOCIATE', 'Select center marks or centerlines to disassociate:');
  await click(2, 0);
  await type(page, '', 'Command:');
  await type(page, 'MOVE', 'Select objects:');
  await click(-10 * Math.SQRT1_2, 10 * Math.SQRT1_2);
  await type(page, '', /^Specify base point/);
  await type(page, p(0, 0), /^Specify second point/);
  await type(page, p(0, -6), 'Command:');
  await page.waitForTimeout(300);
  await shot('2-disassociated.png');
  expect((await state(page)).map(({ x, y }) => [x - O, y - O])).toEqual([[0, 0]]);

  // Put on the second circle, then given a CENTEREXE of 8.
  await type(page, 'CENTERREASSOCIATE', 'Select center mark or centerline:');
  await click(2, 0);
  await expect(prompt(page)).toHaveText('Select circle or arc:');
  await click(41, 0);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await state(page)).map(({ x, y }) => [x - O, y - O]))
    .toEqual([[35, 0]]);
  await type(page, 'CENTEREXE', /^Enter new value for CENTEREXE/);
  await type(page, '8', 'Command:');
  await type(page, 'CENTERRESET', 'Select center marks or centerlines to reset:');
  await click(36, 0);
  await type(page, '', 'Command:');
  await page.waitForTimeout(300);
  await shot('3-reassociated-and-reset.png');
  const lines = await page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.entities?.added ?? [])
      .map((a) => a.entity.geom)
      .filter((g) => g.kind === 'LINE')
      .map((g) => (g as { end: { x: number } }).end.x),
  );
  // The last lines drawn reach 6 + 8 past the centre.
  expect(Math.max(...lines.slice(-6).map(Math.abs))).toBeCloseTo(14);
});

// M4-24: a mark's grips and Properties rows. The mark's right extension grip, dragged out, draws
// the mark as it would be and stretches the extension; Properties lists it as a Center Mark, with
// its cross size, gap, extension lines, extensions and Associative, and edits them. The grips and
// rows are unit-tested in packages/engine (center-mark-grips.test.ts).
test('a center mark’s grips and Properties rows (M4-24)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-20, -20), 'Specify opposite corner:');
  await type(page, p(50, 20), 'Command:');
  const k = Math.min(box.width / 70, box.height / 40);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 15) * k,
    y: box.y + box.height / 2 - y * k,
  });
  await page.keyboard.press('F3');
  await type(page, 'CIRCLE', /^Specify center point/);
  await type(page, p(0, 0), /^Specify radius/);
  await type(page, '10', 'Command:');
  await type(page, 'CENTERMARK', 'Select circle or arc to add center mark:');
  const edge = at(10, 0);
  await page.mouse.click(edge.x, edge.y);
  await off();
  await expect.poll(async () => (await state(page)).length).toBe(1);
  await type(page, '', 'Command:');

  /** The mark's record as the changes leave it. */
  const record = () =>
    page.evaluate(() => {
      let r: { extensions: number[]; crossSize?: string; showExtensions?: boolean } | undefined;
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const o of cs.objects?.added ?? []) if (o.type === 'TRIYA_CENTERMARK') r = o as never;
        for (const u of cs.objects?.updated ?? []) {
          if (u.after.type === 'TRIYA_CENTERMARK') r = u.after as never;
        }
      }
      return r;
    });
  expect((await record())!.extensions).toEqual([3.5, 3.5, 3.5, 3.5]);

  // Selected by its centre: its grips are the centre and each extension line's end.
  const centre = at(0, 0);
  await page.mouse.click(centre.x, centre.y);
  await off();
  await page.waitForTimeout(300);
  await shot('6-mark-grips.png');
  // The right extension's grip, dragged out to x 20: the mark is drawn as it will be.
  const grip = at(13.5, 0);
  await page.mouse.click(grip.x, grip.y);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  const to = at(20, 1);
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.waitForTimeout(300);
  await shot('7-extension-dragged.png');
  await type(page, `#${p(20, 1)}`, 'Command:');
  await expect.poll(async () => (await record())!.extensions).toEqual([3.5, 10, 3.5, 3.5]);

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'Center Mark (1)',
  );
  for (const group of ['Geometry', 'Center Mark']) {
    await expect(palette.getByRole('table', { name: group })).toBeVisible();
  }
  await expect(palette.getByRole('textbox', { name: 'Right extension' })).toHaveValue(/^10/);
  await expect(palette.getByRole('textbox', { name: 'Cross size' })).toHaveValue('0.1x');
  await shot('8-mark-rows.png');

  // Left extension 6 and cross size 4 (a length): the mark is drawn again with them.
  const left = palette.getByRole('textbox', { name: 'Left extension' });
  await left.fill('6');
  await left.press('Enter');
  await expect.poll(async () => (await record())!.extensions).toEqual([6, 10, 3.5, 3.5]);
  const size = palette.getByRole('textbox', { name: 'Cross size' });
  await size.fill('4');
  await size.press('Enter');
  await expect.poll(async () => (await record())!.crossSize).toBe('4');
  await palette.getByRole('combobox', { name: 'Show extensions' }).selectOption({ label: 'No' });
  await expect.poll(async () => (await record())!.showExtensions).toBe(false);
  await expect(palette.getByLabel('Associative', { exact: true })).toHaveText('Yes');
  await off();
  await page.waitForTimeout(300);
  await shot('9-mark-edited.png');
});

// M4-29: CENTERLINE on a polyline's straight segments (DEC-068). A U-shaped polyline's bottom
// and top segments get a centerline, which follows the top segment when its end vertex is
// dragged up by its grip.
test('CENTERLINE on polyline segments follows the segment (M4-29)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-20, -20), 'Specify opposite corner:');
  await type(page, p(50, 20), 'Command:');
  const k = Math.min(box.width / 70, box.height / 40);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 15) * k,
    y: box.y + box.height / 2 - y * k,
  });
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(q.x, q.y);
    await off();
  };
  await page.keyboard.press('F3');
  await type(page, 'PLINE', /^Specify start point/);
  await type(page, p(0, -10), /^Specify next point/);
  for (const [x, y] of [
    [30, -10],
    [30, 10],
    [0, 10],
  ] as const) {
    await type(page, p(x, y), /^Specify next point/);
  }
  await type(page, '', 'Command:');
  await page.waitForTimeout(300);
  await shot('1-polyline.png');

  await type(page, 'CENTERLINE', 'Select first line:');
  await click(15, -10);
  await expect(prompt(page)).toHaveText('Select second line:');
  await click(15, 10);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await state(page)).map(({ kind, x, y }) => [kind, x - O, y - O]))
    .toEqual([['line', 15, 0]]);
  await page.waitForTimeout(300);
  await shot('2-centerline-on-segments.png');

  // The polyline picked on its bottom segment, its top-left vertex's grip dragged up to y 16:
  // the centerline turns to the bisector of the bottom and the sloped top segment.
  await click(15, -10);
  const grip = at(0, 10);
  await page.mouse.click(grip.x, grip.y);
  await expect(prompt(page)).toHaveText(/^Specify stretch point/);
  await type(page, `#${p(0, 16)}`, 'Command:');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await state(page)).map(({ x, y }) => [r1(x - O), r1(y - O)]))
    .not.toEqual([[15, 0]]);
  const { x, y } = (await state(page))[0]!;
  // The middle of the ends' middles (0, 3) and (30, 0), moved onto the bisector: above y 0.
  expect(y - O).toBeGreaterThan(0);
  expect(x - O).toBeGreaterThan(10);
  await off();
  await page.waitForTimeout(300);
  await shot('3-vertex-moved.png');
});

const r1 = (v: number) => Math.round(v * 10) / 10;
