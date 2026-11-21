// M2-35 part 30: a Properties palette edit while a command's "Select objects" prompt runs. The
// palette shows the objects the prompt has selected; choosing a colour there changes them, and
// MOVE goes on prompting with its selection, then moves the red line. The engine side is
// unit-tested in packages/engine/test/properties/running-command.test.ts; this checks the app
// carries it end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import {
  DOCKED_PALETTES,
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';
import { mkdirSync } from 'node:fs';
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

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines this test drew, as the change sets left them: their colour and ends. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, { color: unknown; ends: number[] }>();
    const put = (e: Entity) => {
      if (e.geom.kind !== 'LINE') return;
      const g = e.geom;
      out.set(e.handle, {
        color: e.color,
        ends: [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v - 1e6)),
      });
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const SHOTS = process.env['TRIYA_SCREENSHOTS'];
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
};

test('edits the objects a running command has selected, and the command goes on', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across it.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'byLayer' }, ends: [70, 50, 90, 50] }]);

  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  const undocked = (await canvas.boundingBox())!.width;
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await expect(objects).toHaveText('No selection');
  // The click below is worked out from the canvas beside the docked palette.
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(undocked);
  await expectDrawn(page, { timeout: 15_000 });
  const docked = (await canvas.boundingBox())!;

  // MOVE, and the line picked at its "Select objects" prompt: the palette shows it.
  await canvas.hover();
  await type(page, 'MOVE', 'Select objects:');
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(objects).toHaveText('Line (1)');
  await expect(prompt(page)).toHaveText('Select objects:');
  await shot(page, '1-move-selecting.png');

  // Red, chosen in the palette, goes to the line; MOVE is still selecting, its line kept.
  await palette.getByRole('combobox', { name: 'Color' }).selectOption({ label: 'Red' });
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'aci', index: 1 }, ends: [70, 50, 90, 50] }]);
  await expect(palette.getByRole('combobox', { name: 'Color' })).toHaveValue('aci:1');
  await expect(prompt(page)).toHaveText('Select objects:');
  await expect(objects).toHaveText('Line (1)');
  await expectDrawn(page, { timeout: 15_000 });
  await shot(page, '2-red-while-selecting.png');

  // MOVE goes on with the line it selected (`#`: Dynamic Input reads a second point as relative).
  await canvas.hover();
  await type(page, '', /^Specify base point/);
  await type(page, '1000070,1000050', /^Specify second point/);
  await type(page, '#1000070,1000060', 'Command:');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'aci', index: 1 }, ends: [70, 60, 90, 60] }]);
  await expectDrawn(page, { timeout: 15_000 });
  await shot(page, '3-moved.png');

  // One U takes back the move and the colour, made in the same command.
  await type(page, 'U', 'Command:');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'byLayer' }, ends: [70, 50, 90, 50] }]);
});
