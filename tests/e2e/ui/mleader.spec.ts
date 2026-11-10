// M2-09: MLEADER and MLEADEREDIT from the app's command line, as a drafter calls out part of a
// drawing: a multileader picked arrowhead first with its text typed in place in the MTEXT editor,
// then MLEADEREDIT adding a leader beside the first and one from the text's other side, whose
// landing needs the text's width, which the render worker measures. The commands' prompts and
// geometry are unit-tested in packages/engine/test/commands/mleader.test.ts and the save in the
// corpus gate; this checks that the app's bus, editor, canvas and workers carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MultiLeaderGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectShown, ink, openWithPicker } from '../app/page';
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

/** The multileaders this test made, as the change sets last left them. */
const leaders = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
    }
    return [...out.values()]
      .filter((e) => e.type === 'MULTILEADER')
      .map((e) => {
        const g = e.geom as MultiLeaderGeometry;
        return {
          text: g.text?.content,
          branches: g.branches.map((b) => ({ lines: b.lines.length, toRight: b.direction.x > 0 })),
        };
      });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('MLEADER with in-place text, then MLEADEREDIT adds leaders on both sides', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const click = async (fx: number, fy: number) =>
    page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await expect.poll(() => ink(page)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });
  const before = await ink(page);

  await type(
    page,
    'MLD',
    'Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:',
  );
  await click(0.59, 0.55);
  await expect(prompt(page)).toHaveText('Specify leader landing location:');
  await click(0.61, 0.12);
  await expect(prompt(page)).toHaveText('Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('SEE DETAIL A');
  await page.screenshot({ path: test.info().outputPath('2-typing.png') });
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => leaders(page))
    .toEqual([{ text: 'SEE DETAIL A', branches: [{ lines: 1, toRight: true }] }]);
  await expect.poll(() => ink(page)).toBeGreaterThan(before);
  await page.screenshot({ path: test.info().outputPath('3-multileader.png') });

  // MLEADEREDIT: one more leader on the landing's side, one from the far side of the text.
  await type(page, 'MLE', 'Select a multileader:');
  await type(page, 'L', 'Specify leader arrowhead location or [Remove leaders]:');
  await click(0.6, 0.8);
  await expect.poll(async () => (await leaders(page))[0]!.branches[0]!.lines).toBe(2);
  await click(0.88, 0.62);
  await expect
    .poll(async () => (await leaders(page))[0]!.branches)
    .toEqual([
      { lines: 2, toRight: true },
      { lines: 1, toRight: false },
    ]);
  await type(page, '', 'Command:');
  await page.screenshot({ path: test.info().outputPath('4-leaders-added.png') });

  // Remove leaders: the one beside the first goes.
  await type(page, 'MLE', 'Select a multileader:');
  await type(page, 'L', 'Specify leader arrowhead location or [Remove leaders]:');
  await type(page, 'R', 'Specify leaders to remove:');
  await click(0.6, 0.8);
  await expect.poll(async () => (await leaders(page))[0]!.branches[0]!.lines).toBe(1);
  await type(page, '', 'Command:');
});

// M2-25: a multileader with AutoCAD's built-in `_TagCircle` block, which MLEADER authors as the
// drawing lacks it, and a double click on a multileader's text, which opens it in the MTEXT
// editor (TEXTEDIT). Shown on an empty part of the plan: the drawing's Standard style is metric
// (text 4, landing 8), so a ZOOM Window 160 × 100 units across shows them at a readable size.
test('MLEADER authors _TagCircle; a double click edits a multileader’s text', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const tags = () =>
    page.evaluate(() => {
      const out = new Map<string, Entity>();
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
        for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
      }
      return [...out.values()].map((e) =>
        e.type === 'MULTILEADER'
          ? `MULTILEADER ${(e.geom as MultiLeaderGeometry).block?.attributes?.[0]?.value ?? (e.geom as MultiLeaderGeometry).text?.content}`
          : e.type,
      );
    });

  await type(page, 'MLD', /^Specify leader arrowhead location or/);
  await type(page, 'O', /^Enter an option/);
  await type(page, 'C', 'Select a content type [Block/Mtext/None] <Mtext>:');
  await type(page, 'B', 'Enter block name or [?]:');
  await type(page, '_TagCircle', /^Enter an option/);
  await type(page, 'X', /^Specify leader arrowhead location or/);
  await type(page, '1000020,1000020', 'Specify leader landing location:');
  await type(page, '1000040,1000060', 'Enter tag number <TAGNUMBER>:');
  await type(page, '12', 'Command:');
  // The block's circle and tag, then the multileader showing it.
  await expect.poll(tags).toEqual(['CIRCLE', 'ATTDEF', 'MULTILEADER 12']);
  await page.screenshot({ path: test.info().outputPath('2-tag-circle.png') });

  await type(page, 'MLD', /^Specify leader arrowhead location or/);
  await type(page, 'O', /^Enter an option/);
  await type(page, 'C', 'Select a content type [Block/Mtext/None] <Block>:');
  await type(page, 'M', /^Enter an option/);
  await type(page, 'X', /^Specify leader arrowhead location or/);
  await type(page, '1000090,1000020', 'Specify leader landing location:');
  await type(page, '1000100,1000060', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('SEE NOTE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');

  // The text starts a dogleg (8) and a gap (2) past the landing, its first line about y = 60.
  const word = at(118, 59);
  await page.mouse.dblclick(word.x, word.y);
  await expect(prompt(page)).toHaveText('Enter text:');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('SEE NOTE');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' 4');
  await page.screenshot({ path: test.info().outputPath('3-editing-in-place.png') });
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Select an annotation object or [Undo/Mode]:');
  await type(page, '', 'Command:');
  await expect.poll(tags).toEqual(['CIRCLE', 'ATTDEF', 'MULTILEADER 12', 'MULTILEADER SEE NOTE 4']);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
