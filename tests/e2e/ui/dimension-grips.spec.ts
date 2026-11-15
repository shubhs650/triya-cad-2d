// M3-05 part 4: a dimension's grip menus in the app. On an empty part of the acadsharp AC1032
// sample's plan (its current dimension style), DIMLINEAR dimensions (0,0)–(8,0) with its
// dimension line at y = 2. Picked at `Command:`, the dimension shows its grips; the cursor
// resting on the dimension line's second end lists AutoCAD's Stretch, Continue Dimension,
// Baseline Dimension and Flip Arrow, and Flip Arrow turns that arrowhead round at once. The text
// grip's menu lists Stretch and the six ways to place the text; Move with Leader puts the text
// where the cursor clicks, hung on a leader (DIMTMOVE 1 for this dimension). Continue Dimension
// from the second end's menu goes on as DIMCONTINUE from that extension line. The rules are
// unit-tested in packages/engine (dimension-grips.test.ts) and packages/dims (parts.test.ts).
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

/** The dimensions made in this test, less the offset, with the DSTYLE overrides they carry. */
const dimensions = (page: Page) =>
  page.evaluate((o) => {
    const dims = new Map<string, { g: DimensionGeometry; dstyle: number[] }>();
    const put = (e: Entity) => {
      if (e.geom.kind !== 'DIMENSION') return;
      const values = (e.xdata ?? []).flatMap((a) => a.values);
      const at = values.findIndex((v) => v.value === 'DSTYLE');
      const dstyle =
        at < 0
          ? []
          : values
              .slice(at + 2)
              .filter((v) => v.code === 1070)
              .map((v) => Number(v.value));
      dims.set(e.handle, { g: e.geom, dstyle });
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) dims.delete(r.entity.handle);
    }
    const r = (v: number) => Math.round(v * 1e3) / 1e3 + 0;
    const pt = (p: { x: number; y: number }) => [r(p.x - o), r(p.y - o)];
    return [...dims.values()].map(({ g, dstyle }) => {
      if (g.dimType !== 'linear') return { type: g.dimType };
      return {
        first: pt(g.first),
        second: pt(g.second),
        text: pt(g.textPosition),
        userText: g.textUserPositioned,
        flip: g.flipArrows ?? [false, false],
        dstyle,
      };
    });
  }, O);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;
const LOCATION = /^Specify dimension line location or \[Mtext\/Text\/Angle/;

test('a dimension’s grip menus: Flip Arrow, Move with Leader, Continue Dimension', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor off the canvas (below it), where Dynamic Input does not
  // take them as relative to the last point.
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -2), 'Specify opposite corner:');
  await type(page, p(14, 6), 'Command:');
  // ZOOM Window fits 15 × 8 units about (6.5, 2) into the canvas.
  const k = Math.min(box.width / 15, box.height / 8);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 6.5) * k,
    y: box.y + box.height / 2 - (y - 2) * k,
  });
  const move = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  };
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(q.x, q.y);
  };
  const menu = page.getByTestId('grip-menu');
  // Running object snaps would pull the clicks onto the dimension's own points; off.
  await page.keyboard.press('F3');

  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), LOCATION);
  await type(page, p(4, 2), 'Command:');
  await expect.poll(async () => (await dimensions(page)).length).toBe(1);
  const [made] = (await dimensions(page)) as { text: number[] }[];
  const [tx, ty] = made!.text as [number, number];

  // Picked: its grips. The cursor resting on the second end of its dimension line: the menu.
  await click(2, 2);
  await move(7, 2.5);
  await move(8, 2);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Stretch',
    'Continue Dimension',
    'Baseline Dimension',
    'Flip Arrow',
  ]);
  await shot('1-dimension-line-grip-menu.png');
  await menu.getByRole('menuitem', { name: 'Flip Arrow' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => ((await dimensions(page))[0] as { flip: boolean[] }).flip)
    .toEqual([false, true]);
  await move(10, 5);
  await page.waitForTimeout(300);
  await shot('2-arrow-flipped.png');

  // The text grip's menu; Move with Leader, the text placed up and to the right.
  await move(tx - 0.5, ty + 0.5);
  await move(tx, ty);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Stretch',
    'Move with Dim Line',
    'Move Text Only',
    'Move with Leader',
    'Above Dim Line',
    'Center Vertically',
    'Reset Text Position',
  ]);
  await shot('3-text-grip-menu.png');
  await menu.getByRole('menuitem', { name: 'Move with Leader' }).click();
  await expect(prompt(page)).toHaveText('Specify point to place text or [eXit]:');
  await move(11, 4.5);
  await page.waitForTimeout(300);
  await shot('4-move-with-leader-drag.png');
  await click(11, 4.5);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await dimensions(page))[0])
    .toMatchObject({ userText: true, dstyle: [279, 1] });
  const moved = (await dimensions(page))[0] as { text: number[] };
  expect(moved.text[0]).toBeCloseTo(11, 1);
  expect(moved.text[1]).toBeCloseTo(4.5, 1);
  await move(14, 6);
  await page.waitForTimeout(300);
  await shot('5-text-on-leader.png');

  // Continue Dimension from the second end: DIMCONTINUE from (8, 0).
  await move(7, 2.5);
  await move(8, 2);
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Continue Dimension' }).click();
  await expect(prompt(page)).toHaveText(
    'Specify a second extension line origin or [Undo/Select] <Select>:',
  );
  await off();
  await type(page, p(13, 0), 'Specify a second extension line origin or [Undo/Select] <Select>:');
  await type(page, '', 'Select continued dimension:');
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await dimensions(page))[1])
    .toMatchObject({ first: [8, 0], second: [13, 0] });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('6-continued.png');
});
