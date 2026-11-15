// M3-05 part 3: grips on hatches and layout viewports in the app. ezdxf's hatch_issues.dxf has
// four ANSI31 hatches whose extents centre on (0,0), (10,0), (0,10) and (10,10): selected at
// `Command:`, each shows its control grip there, and the cursor resting on one lists AutoCAD's
// Stretch, Origin Point, Hatch Angle and Hatch Scale; Hatch Angle chosen there asks for the
// angle, and a tap of Ctrl at the hot grip goes on to Origin Point. VP4.dxf's layout has four
// viewports: a corner grip of one resizes it about the opposite corner. The rules are
// unit-tested in packages/engine (shape-grips.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
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

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The geometry of each object the commands changed, by handle, as it is now. */
const changed = (page: Page, kind: string) =>
  page.evaluate((kind) => {
    const out: Record<string, Entity['geom']> = {};
    for (const cs of (window as unknown as Dev).triyaDev.changes())
      for (const u of cs.entities?.updated ?? [])
        if (u.after.geom.kind === kind) out[u.after.handle] = u.after.geom;
    return out;
  }, kind);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screen points for drawing points, once ZOOM Window has fitted `w` × `h` about `c`. */
async function fitted(page: Page, c: { x: number; y: number }, w: number, h: number) {
  const box = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(box.width / w, box.height / h);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - c.x) * k,
    y: box.y + box.height / 2 - (y - c.y) * k,
  });
  return {
    at,
    move: async (x: number, y: number) => {
      const p = at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 4 });
    },
    click: async (x: number, y: number) => {
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
    },
    /** Off the canvas, below it: typed input goes to the command line, not Dynamic Input. */
    away: () => page.mouse.move(box.x + box.width / 2, box.y + box.height + 40),
  };
}

async function zoomWindow(page: Page, a: string, b: string): Promise<void> {
  // The cursor off the canvas: the typed corners go to the command line, not Dynamic Input
  // (which would read the second as relative).
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, a, 'Specify opposite corner:');
  await type(page, b, 'Command:');
}

test('a hatch’s control grip: its menu, Hatch Angle and Ctrl to Origin Point', async ({ page }) => {
  test.setTimeout(120_000);
  const file = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_issues.dxf');
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const menu = page.getByTestId('grip-menu');
  await zoomWindow(page, '-6,-6', '16,16');
  const v = await fitted(page, { x: 5, y: 5 }, 22, 22);
  // Running object snaps would pull the clicks onto the boundaries; off.
  await page.keyboard.press('F3');
  await page.keyboard.press('Control+a');
  await v.move(9, 9);
  await v.move(10, 10);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Stretch',
    'Origin Point',
    'Hatch Angle',
    'Hatch Scale',
  ]);
  await shot('1-hatch-grip-menu.png');

  await menu.getByRole('menuitem', { name: 'Hatch Angle' }).click();
  await expect(menu).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify hatch angle or [eXit]:');
  await v.move(15, 10);
  await shot('2-hatch-angle-dragged.png');
  await v.away();
  await type(page, '0', 'Command:');
  // AD was at 315°: its lines now run at ANSI31's own 45°.
  await expect
    .poll(async () => {
      const g = (await changed(page, 'HATCH'))['AD'];
      if (g?.kind !== 'HATCH') return -1;
      return (Math.round((g.patternLines[0]!.angle * 180) / Math.PI) + 720) % 360;
    })
    .toBe(45);
  await shot('3-hatch-angle-set.png');

  // The grip hot, a tap of Ctrl goes on to Origin Point.
  await v.click(0, 0);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await page.keyboard.press('Control');
  await expect(prompt(page)).toHaveText('Specify origin point or [eXit]:');
  await v.click(1, 1);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => {
      const g = (await changed(page, 'HATCH'))['A1'];
      const b = g?.kind === 'HATCH' ? g.patternLines[0]!.base : undefined;
      return b && [Math.round(b.x * 1e3) / 1e3, Math.round(b.y * 1e3) / 1e3];
    })
    .toEqual([1, 1]);
});

test('a layout viewport’s corner grip resizes it', async ({ page }) => {
  test.setTimeout(120_000);
  const file = path.join(CORPUS, 'ezdxf/examples_dxf/VP4.dxf');
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' });
  await tabs.getByRole('tab').nth(1).click();
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expectDrawn(page, { timeout: 15_000 });
  await zoomWindow(page, '0,0', '240,200');
  const v = await fitted(page, { x: 120, y: 100 }, 240, 200);
  await page.keyboard.press('F3');
  // The top-left viewport's frame, picked on its bottom edge: its four corners show grips.
  await v.click(45.5, 131.5);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: test.info().outputPath('4-viewport-grips.png') });
  await v.click(73.3, 179.5);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await v.move(95, 190);
  await page.screenshot({ path: test.info().outputPath('5-viewport-corner-dragged.png') });
  await v.click(95, 190);
  await expect(prompt(page)).toHaveText('Command:');
  const r1 = (n: number) => Math.round(n * 10) / 10;
  await expect
    .poll(async () => {
      const g = (await changed(page, 'VIEWPORT'))['A3'];
      return g?.kind === 'VIEWPORT' ? [r1(g.width), r1(g.height)] : undefined;
    })
    .toEqual([77.3, 58.5]);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: test.info().outputPath('6-viewport-resized.png') });
});
