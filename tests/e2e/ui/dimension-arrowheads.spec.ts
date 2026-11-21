// M2-35 part 22: the Properties palette offers every AutoCAD arrowhead for a dimension's Arrow 1
// and Arrow 2, and one the drawing lacks is authored as its `_NAME` block when chosen. On an
// empty part of the acadsharp AC1032 sample's plan, DIMLINEAR dimensions a line; Arrow 1 becomes
// Open 30 and Arrow 2 a dot, neither of which the drawing holds (it has `_ArchTick`), and the
// dimension's block draws each as an INSERT of the new block. U takes Arrow 2 back. The blocks'
// shapes and the one-undo-step authoring are unit-tested in
// packages/engine/test/edit/arrowhead-blocks.test.ts and properties/dimension-rows.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry, Entity } from '@triya/engine';
import {
  DOCKED_PALETTES,
  activeCanvas,
  expectDrawn,
  expectShown,
  openWithPicker,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';
import path from 'node:path';

// The palettes dock beside the drawing area (M7-03; narrower windows slide them over it).
test.use({ viewport: DOCKED_PALETTES });

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

/** The names of the blocks the dimension this test made draws its arrowheads with. */
const arrowheads = (page: Page) =>
  page.evaluate(() => {
    let dim: DimensionGeometry | undefined;
    const names = new Map<string, string>();
    const inserts = new Map<string, { owner: string; block: string }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const b of cs.blocks?.added ?? []) names.set(b.handle, b.name);
      for (const b of cs.blocks?.removed ?? []) names.delete(b.handle);
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dim = e.geom;
        if (e.geom.kind === 'INSERT')
          inserts.set(e.handle, { owner: e.owner, block: e.geom.block });
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) inserts.delete(r.entity.handle);
    }
    if (!dim) return undefined;
    return [...inserts.values()]
      .filter((i) => i.owner === dim!.block)
      .map((i) => names.get(i.block) ?? i.block)
      .sort();
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('a dimension takes an arrowhead the drawing lacks, its block made', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-2, -4), 'Specify opposite corner:');
  await type(page, p(10, 3), 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -1.5), 'Command:');
  // The sample's Standard style draws its arrowheads with a block of the drawing's own.
  await expect.poll(async () => (await arrowheads(page))?.length).toBe(2);
  expect(await arrowheads(page)).not.toContain('_OPEN30');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  // Click the dimension line where the docked palette's narrower canvas draws it, the pointer
  // parked off the canvas first.
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(box.width);
  await expectDrawn(page, { timeout: 15_000 });
  const docked = (await canvas.boundingBox())!;
  // The zoom window's scale stays as the undocked canvas fitted it; the middle follows.
  const k = Math.min(box.width / 12, box.height / 7);
  await page.mouse.click(
    docked.x + docked.width / 2 + (2 - 4) * k,
    docked.y + docked.height / 2 - (-1.5 + 0.5) * k,
  );
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'Dimension (1)',
  );
  await page.mouse.move(docked.x + 40, docked.y + docked.height - 40);
  await shot('1-before.png');

  const arrow1 = palette.getByRole('combobox', { name: 'Arrow 1' });
  const arrow2 = palette.getByRole('combobox', { name: 'Arrow 2' });
  // Every AutoCAD arrowhead is offered, in AutoCAD's order (then a user arrow in use, if any).
  const offered = await arrow1.locator('option').allTextContents();
  expect(offered.slice(0, 20)).toEqual([
    'Closed filled',
    'Closed blank',
    'Closed',
    'Dot',
    'Architectural tick',
    'Oblique',
    'Open',
    'Origin indicator',
    'Origin indicator 2',
    'Right angle',
    'Open 30',
    'Dot small',
    'Dot blank',
    'Dot small blank',
    'Box',
    'Box filled',
    'Datum triangle',
    'Datum triangle filled',
    'Integral',
    'None',
  ]);
  await arrow1.selectOption({ label: 'Open 30' });
  await expect.poll(async () => (await arrowheads(page))?.includes('_OPEN30')).toBe(true);
  await arrow2.selectOption({ label: 'Dot' });
  await expect.poll(() => arrowheads(page)).toEqual(['_DOT', '_OPEN30']);
  await expect(arrow1.locator('option:checked')).toHaveText('Open 30');
  await expect(arrow2.locator('option:checked')).toHaveText('Dot');
  await page.mouse.move(docked.x + 40, docked.y + docked.height - 40);
  await expectDrawn(page);
  await shot('2-after-open30-and-dot.png');

  // U takes Arrow 2 back (the dot's block with it); Arrow 1 keeps Open 30.
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await page.locator('#command-input').click();
  await type(page, 'U', 'Command:');
  await expect.poll(async () => (await arrowheads(page))?.includes('_DOT')).toBe(false);
  expect(await arrowheads(page)).toContain('_OPEN30');
});
