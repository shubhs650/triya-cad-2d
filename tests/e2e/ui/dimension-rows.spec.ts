// M2-35 part 5: a dimension's other Properties rows, in the app. On an empty part of the
// acadsharp AC1032 sample's plan, DIMLINEAR dimensions a line; the palette then gives the
// dimension a red dimension line through Select Color (Index Color only: DSTYLE overrides keep
// ACIs), a prefix, a symmetrical tolerance and a lower text position, each redrawing its block
// at once; U takes the last (the tolerance's value) back. The rows and the DSTYLE xdata they write are unit-tested in
// packages/engine/test/properties/dimension-rows.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Color, DimensionGeometry, Entity } from '@triya/engine';
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

/** The dimension this test made: the text its block holds and its lines' colours. */
const dimension = (page: Page) =>
  page.evaluate(() => {
    let dim: DimensionGeometry | undefined;
    const parts = new Map<string, { owner: string; text?: string; color: Color }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dim = e.geom;
        if (e.geom.kind === 'MTEXT') {
          parts.set(e.handle, { owner: e.owner, text: e.geom.contents, color: e.color });
        }
        if (e.geom.kind === 'LINE') parts.set(e.handle, { owner: e.owner, color: e.color });
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) parts.delete(r.entity.handle);
    }
    if (!dim) return undefined;
    const drawn = [...parts.values()].filter((t) => t.owner === dim!.block);
    const colors = (c: Color) => (c.kind === 'aci' ? `aci:${c.index}` : c.kind);
    return {
      text: drawn.find((t) => t.text !== undefined)?.text?.replace(/^\\A1;/, ''),
      lines: [...new Set(drawn.filter((t) => t.text === undefined).map((t) => colors(t.color)))],
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('a dimension’s colour, prefix and tolerance rows redraw it at once', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-4, -8), 'Specify opposite corner:');
  await type(page, p(12, 6), 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -1.5), 'Command:');
  await expect.poll(() => dimension(page)).toMatchObject({ text: expect.stringMatching(/^8/) });
  const before = (await dimension(page))!;
  expect(before.lines).not.toContain('aci:1');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  const docked = (await canvas.boundingBox())!;
  const k = Math.min(docked.width / 16, docked.height / 14);
  await page.mouse.click(
    docked.x + docked.width / 2 + (2 - 4) * k,
    docked.y + docked.height / 2 - (-1.5 + 1) * k,
  );
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText(
    'Dimension (1)',
  );
  for (const group of ['Lines & Arrows', 'Text', 'Fit', 'Alternate Units', 'Tolerances']) {
    await expect(palette.getByRole('table', { name: group })).toBeVisible();
  }
  await shot('1-dimension-rows.png');

  // Dim line color: Select Color, its Index Color tab only.
  const dimColor = palette.getByRole('combobox', { name: 'Dim line color' });
  await dimColor.selectOption({ label: 'Select Color...' });
  const dialog = page.getByRole('dialog', { name: 'Select Color' });
  await expect(dialog.getByRole('tab', { name: 'True Color' })).toBeDisabled();
  await expect(dialog.getByRole('tab', { name: 'Color Books' })).toBeDisabled();
  const field = dialog.getByRole('textbox', { name: 'Color' });
  await field.fill('10,20,30');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'A dimension’s colors take an index color only.',
  );
  await field.fill('1');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(dimColor).toHaveValue('aci:1');
  await expect.poll(async () => (await dimension(page))?.lines).toContain('aci:1');

  const prefix = palette.getByRole('textbox', { name: 'Dim prefix' });
  await prefix.fill('L=');
  await prefix.press('Enter');
  await expect.poll(async () => (await dimension(page))?.text).toMatch(/^L=8/);

  await palette.getByRole('combobox', { name: 'Tolerance display' }).selectOption('Symmetrical');
  const upper = palette.getByRole('textbox', { name: 'Tolerance limit upper' });
  await upper.fill('0.05');
  await upper.press('Enter');
  await expect.poll(async () => (await dimension(page))?.text).toMatch(/^.*L=8.*%%p0\.05/);
  await expect(palette.getByRole('textbox', { name: 'Tolerance limit lower' })).toHaveValue(
    /0\.05/,
  );
  await shot('2-red-prefix-tolerance.png');

  await palette.getByRole('heading', { name: 'Properties' }).click();
  await canvas.hover();
  await off();
  await type(page, 'U', 'Command:');
  // The tolerance's value went back; its display stays Symmetrical.
  await expect.poll(async () => (await dimension(page))?.text).toMatch(/^L=8[.0]*%%p0[.0]*$/);
});
