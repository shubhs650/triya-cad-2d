// M3-05 part 6: a multileader's grips and Ctrl's offset snap in the app. A multileader drawn on
// an empty part of the plan and picked at `Command:` shows grips at its arrowhead, both ends of
// its landing and its text; the cursor resting on the landing's far end lists AutoCAD's Stretch
// and Lengthen Landing, and Lengthen Landing chosen there runs the landing on to the click, the
// text following; the arrowhead's grip stretches it alone. A line's grips: once MOVE has left a
// Ctrl-clicked copy, the next Ctrl click snaps to a whole multiple of that copy's offset. The
// rules are unit-tested in packages/engine (object-grips.test.ts, grip-menu.test.ts) and the
// saves in the corpus gate (export-object-grips.corpus.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MultiLeaderGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The objects this test made, as the change sets last left them. */
const made = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()];
  });

const r3 = (v: number) => Math.round(v * 1e3) / 1e3 + 0;

/** The multileader's leader vertices, landing and dogleg length, less the 1,000,000 offset. */
async function leader(page: Page) {
  const m = (await made(page)).find((e) => e.type === 'MULTILEADER');
  if (!m) return undefined;
  const g = m.geom as MultiLeaderGeometry;
  const b = g.branches[0]!;
  return {
    vertices: b.lines[0]!.vertices.map((p) => [r3(p.x - 1e6), r3(p.y - 1e6)]),
    connection: [r3(b.connection.x - 1e6), r3(b.connection.y - 1e6)],
    dogleg: r3(b.doglegLength),
    text: g.text ? [r3(g.text.position.x - 1e6), r3(g.text.position.y - 1e6)] : undefined,
  };
}

/** Each line's start x, less the offset. */
const lineStarts = async (page: Page) =>
  (await made(page))
    .filter((e) => e.geom.kind === 'LINE')
    .map((e) =>
      e.geom.kind === 'LINE' ? [r3(e.geom.start.x - 1e6), r3(e.geom.start.y - 1e6)] : [],
    )
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('a multileader’s grips: Lengthen Landing and the arrowhead; Ctrl’s offset snap', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // ZOOM Window fits 160 × 100 units about (80, 50) into the canvas.
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const click = async (x: number, y: number, ctrl = false) => {
    const p = at(x, y);
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.click(p.x, p.y);
    if (ctrl) await page.keyboard.up('Control');
  };
  const away = () => page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const menu = page.getByTestId('grip-menu');

  await away();
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(
    page,
    'MLD',
    'Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:',
  );
  await type(page, '1000020,1000020', 'Specify leader landing location:');
  await type(page, '1000060,1000060', 'Enter text:');
  await page.keyboard.type('NOTE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => leader(page))
    .toMatchObject({ vertices: [[20, 20]], connection: [60, 60] });
  const before = (await leader(page))!;
  // The drawing's Standard multileader style is metric: a landing 8 long.
  expect(before.dogleg).toBe(8);

  // Running object snaps would pull the clicks onto the multileader's own points; off.
  await page.keyboard.press('F3');
  await click(40, 40);
  await move(64, 55);
  await shot('1-multileader-grips.png');

  // The landing's far end: its menu, then Lengthen Landing to (80,60).
  await move(68, 60);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Stretch', 'Lengthen Landing']);
  await shot('2-landing-grip-menu.png');
  await menu.getByRole('menuitem', { name: 'Lengthen Landing' }).click();
  await expect(prompt(page)).toHaveText('Specify landing end point or [eXit]:');
  await move(80, 61);
  await shot('3-lengthen-landing-drag.png');
  await click(80, 61);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await leader(page))?.dogleg).toBe(20);
  const lengthened = (await leader(page))!;
  expect(lengthened.connection).toEqual([60, 60]);
  expect(lengthened.text![0]).toBe(r3(before.text![0]! + 12));

  // The arrowhead's grip stretches it alone.
  await click(20, 20);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await click(30, 10);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await leader(page))?.vertices).toEqual([[30, 10]]);
  expect((await leader(page))!.connection).toEqual([60, 60]);
  await shot('4-arrowhead-stretched.png');
  await page.keyboard.press('Escape');

  // Offset snap: a line, its start grip hot, MOVE; a Ctrl click copies it 10 up, and the next
  // Ctrl click, near 28 up, snaps to 30.
  await away();
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000100,1000010', 'Specify next point or [Undo]:');
  await type(page, '1000140,1000010', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await click(120, 10);
  await click(100, 10);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await type(page, '', 'Specify move point or [Base point/Copy/Undo/eXit]:');
  await click(100, 20, true);
  await expect.poll(async () => (await lineStarts(page)).length).toBe(2);
  await page.keyboard.down('Control');
  await move(101, 38);
  await page.waitForTimeout(300);
  await shot('5-offset-snap-drag.png');
  await page.keyboard.up('Control');
  await click(101, 38, true);
  await type(page, '', 'Command:');
  await expect
    .poll(() => lineStarts(page))
    .toEqual([
      [100, 10],
      [100, 20],
      [100, 40],
    ]);
  await shot('6-offset-snapped-copies.png');
});
