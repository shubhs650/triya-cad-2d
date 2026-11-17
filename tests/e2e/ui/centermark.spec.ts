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
