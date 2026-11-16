// M4-02 part 4: DIMBREAK and DIMINSPECT in the app as a drafter uses them, on an empty part of
// the acadsharp AC1032 sample's plan. A DIMLINEAR dimension is drawn across a line; DIMBREAK
// picks it and Enter (Auto) breaks it where the line crosses; then, with the dimension selected,
// DIMINSPECT opens the Inspection Dimension dialog, where Angular, a label and the default
// inspection rate are set and OK makes it an inspection dimension. The commands are unit-tested
// in packages/engine, the drawing in packages/dims, and the save over the corpus in testkit.
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

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The records made, and the texts the dimension's block holds now. */
const state = (page: Page) =>
  page.evaluate(() => {
    const objects = new Map<string, { type: string; shape?: string; label?: string }>();
    let block: string | undefined;
    const texts = new Map<string, { owner: string; contents: string }>();
    let pieces = 0;
    const lines = new Map<string, { owner: string; y: number }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const o of cs.objects?.added ?? []) objects.set(o.handle, o as never);
      for (const u of cs.objects?.updated ?? []) objects.set(u.after.handle, u.after as never);
      for (const o of cs.objects?.removed ?? []) objects.delete(o.handle);
      for (const e of [
        ...(cs.entities?.added ?? []).map((a) => a.entity),
        ...(cs.entities?.updated ?? []).map((u) => u.after),
      ]) {
        if (e.geom.kind === 'DIMENSION') block = (e.geom as { block?: string }).block;
        if (e.geom.kind === 'MTEXT')
          texts.set(e.handle, { owner: e.owner, contents: e.geom.contents });
        if (e.geom.kind === 'LINE') lines.set(e.handle, { owner: e.owner, y: e.geom.start.y });
      }
      for (const r of cs.entities?.removed ?? []) {
        texts.delete(r.entity.handle);
        lines.delete(r.entity.handle);
      }
    }
    for (const l of lines.values())
      if (l.owner === block && Math.abs(l.y - (1e6 - 2)) < 1e-6) pieces++;
    return {
      records: [...objects.values()]
        .filter((o) => o.type.startsWith('TRIYA_DIM'))
        .map((o) => ({ type: o.type, shape: o.shape, label: o.label }))
        .sort((a, b) => a.type.localeCompare(b.type)),
      texts: [...texts.values()]
        .filter((t) => t.owner === block)
        .map((t) => t.contents.replace(/^\\A1;/, '')),
      pieces,
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('DIMBREAK and DIMINSPECT', async ({ page }) => {
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
  await type(page, p(-1, -5), 'Specify opposite corner:');
  await type(page, p(9, 3), 'Command:');
  const k = Math.min(box.width / 10, box.height / 8);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 4) * k,
    y: box.y + box.height / 2 - (y + 1) * k,
  });
  await page.keyboard.press('F3');
  await type(page, 'LINE', /^Specify first point/);
  await type(page, p(1.5, -4), /^Specify next point/);
  await type(page, p(1.5, 1), /^Specify next point/);
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -2), 'Command:');
  // The dimension line either side of the text centred on it.
  await expect.poll(async () => (await state(page)).pieces).toBe(2);
  await shot('1-before.png');

  await type(page, 'DIMBREAK', 'Select dimension to add/remove break or [Multiple]:');
  const q = at(6, -2);
  await page.mouse.click(q.x, q.y);
  await off();
  await expect(prompt(page)).toHaveText(
    'Select object to break dimension or [Auto/Manual/Remove] <Auto>:',
  );
  await type(page, '', 'Command:');
  // A gap where the line at x = 1.5 crosses: one more piece.
  await expect.poll(async () => (await state(page)).pieces).toBe(3);
  await page.waitForTimeout(300);
  await shot('2-broken.png');

  await page.mouse.click(q.x, q.y);
  await off();
  await type(page, 'DIMINSPECT', 'Inspection Dimension:');
  const dialog = page.getByRole('dialog', { name: 'Inspection Dimension' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('1 dimension selected');
  await dialog.getByRole('radio', { name: 'Angular' }).check();
  await dialog.getByRole('checkbox', { name: 'Label', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Label value' }).fill('A1');
  await expect(dialog.getByRole('textbox', { name: 'Inspection rate value' })).toHaveValue('100%');
  await shot('3-inspection-dialog.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => state(page))
    .toMatchObject({
      records: [
        { type: 'TRIYA_DIMBREAK' },
        { type: 'TRIYA_DIMINSPECT', shape: 'angular', label: 'A1' },
      ],
      texts: expect.arrayContaining(['A1', '100%']),
    });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('4-inspection.png');
});

// M4-15: DIMBREAK on a multileader. A line is drawn and a multileader across it; DIMBREAK picks
// the multileader's leader line and Enter (Auto) breaks it where the line crosses, the record in
// the multileader's own extension dictionary (DEC-065). The gap is drawn by the renderer
// (packages/render/test/canvas2d-leaders.test.ts) and the command is unit-tested in
// packages/engine/test/commands/leader-break.test.ts.
test('DIMBREAK on a multileader', async ({ page }) => {
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
  await type(page, p(-1, -5), 'Specify opposite corner:');
  await type(page, p(9, 3), 'Command:');
  const k = Math.min(box.width / 10, box.height / 8);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 4) * k,
    y: box.y + box.height / 2 - (y + 1) * k,
  });
  await page.keyboard.press('F3');
  await type(page, 'LINE', /^Specify first point/);
  await type(page, p(3, -4.5), /^Specify next point/);
  await type(page, p(3, 2), /^Specify next point/);
  await type(page, '', 'Command:');
  await type(
    page,
    'MLEADER',
    'Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:',
  );
  await type(page, p(0, -3), 'Specify leader landing location:');
  await type(page, p(5, 0), 'Enter text:');
  await page.keyboard.type('BREAK HERE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await page.waitForTimeout(300);
  await shot('5-multileader-before.png');

  await type(page, 'DIMBREAK', 'Select dimension to add/remove break or [Multiple]:');
  // On the leader line, which runs from (0,-3) towards the landing at (5,0).
  const q = at(4, -0.6);
  await page.mouse.click(q.x, q.y);
  await off();
  await expect(prompt(page)).toHaveText(
    'Select object to break dimension or [Auto/Manual/Remove] <Auto>:',
  );
  await type(page, '', 'Command:');
  const holder = () =>
    page.evaluate(() => {
      const objects = new Map<string, { type: string; dimension?: string }>();
      const kinds = new Map<string, string>();
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const o of cs.objects?.added ?? []) objects.set(o.handle, o as never);
        for (const o of cs.objects?.removed ?? []) objects.delete(o.handle);
        for (const a of cs.entities?.added ?? []) kinds.set(a.entity.handle, a.entity.geom.kind);
      }
      return [...objects.values()]
        .filter((o) => o.type === 'TRIYA_DIMBREAK')
        .map((o) => kinds.get(o.dimension!));
    });
  await expect.poll(holder).toEqual(['MULTILEADER']);
  await page.waitForTimeout(300);
  await shot('6-multileader-broken.png');
});
