// M4-09 part 1: JUSTIFYTEXT and SCALETEXT from the app's command line, as a drafter tidies a
// block of notes: two TEXT lines and an MTEXT given Middle center justification without moving,
// then scaled up about their top left corners. The prompts and geometry are unit-tested in
// packages/engine/test/commands/text-tools.test.ts and the MTEXT frame in packages/render
// (test/mtext-frame.test.ts); this checks that the app's bus and render worker, which measures
// the text in its fonts, carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MTextGeometry, TextGeometry } from '@triya/engine';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
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

/** The texts made in this test as they stand now, positions less the 1,000,000 offset. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Record<string, unknown>>();
    const r3 = (v: number) => Math.round((v - 1e6) * 1e3) / 1e3;
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind === 'TEXT') {
        const t = g as TextGeometry;
        out.set(e.handle, {
          text: t.value,
          height: t.height,
          justify: [t.halign, t.valign],
          at: [r3(t.position.x), r3(t.position.y)],
        });
      } else if (g.kind === 'MTEXT') {
        const t = g as MTextGeometry;
        out.set(e.handle, {
          text: t.contents,
          height: t.height,
          justify: t.attachment,
          at: [r3(t.position.x), r3(t.position.y)],
        });
      }
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

/** Selects every object in the empty part of the plan this test draws in, by a window. */
async function selectNotes(page: Page): Promise<void> {
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'W', 'Specify first corner:');
  await type(page, '#1000000,1000000', 'Specify opposite corner:');
  await type(page, '#1000160,1000100', /Select objects:/);
  await type(page, '', /option/);
}

test('JUSTIFYTEXT keeps notes where they are; SCALETEXT scales them about a corner', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  // Away from the navigation bar, whose menu opens on hover.
  await page.mouse.move(20, 400);

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000080', 'Specify height <2.5000>:');
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  await type(page, 'GENERAL NOTES', 'Enter text:');
  await type(page, 'ALL SIZES IN MM', 'Enter text:');
  await type(page, '', 'Command:');
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(
    page,
    '#1000020,1000050',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '#1000120,1000020', 'Enter text:');
  await type(page, 'REMOVE BURRS\\PBREAK SHARP EDGES', 'Enter text:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });
  const before = await texts(page);
  expect(before.map((t) => t['justify'])).toEqual([[0, 0], [0, 0], 1]);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  await type(page, 'JUSTIFYTEXT', 'Select objects:');
  await selectNotes(page);
  await expect(prompt(page)).toHaveText(
    'Enter a justification option [Left/Align/Fit/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Left>:',
  );
  await type(page, 'MC', 'Command:');
  await expect
    .poll(async () => (await texts(page)).map((t) => t['justify']))
    .toEqual([[1, 2], [1, 2], 5]);
  const justified = await texts(page);
  // The TEXT lines' baseline starts stay; the MTEXT's insertion point moves into its middle.
  expect(justified.slice(0, 2).map((t) => t['at'])).toEqual(before.slice(0, 2).map((t) => t['at']));
  const [mx, my] = justified[2]!['at'] as number[];
  expect(mx).toBeGreaterThan(20);
  expect(my).toBeLessThan(50);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-justified-mc.png') });

  await type(page, 'SCALETEXT', 'Select objects:');
  await selectNotes(page);
  await expect(prompt(page)).toHaveText(
    'Enter a base point option for scaling [Existing/Left/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Existing>:',
  );
  await type(
    page,
    'TL',
    // TEXT's height became TEXTSIZE, the default offered.
    'Specify new model height or [Paper height/Match object/Scale factor] <5.0000>:',
  );
  await type(page, '8', 'Command:');
  await expect.poll(async () => (await texts(page)).map((t) => t['height'])).toEqual([8, 8, 8]);
  // Each keeps Middle center, scaled about its own top left corner: it grows down and right.
  const scaled = await texts(page);
  expect(scaled.map((t) => t['justify'])).toEqual([[1, 2], [1, 2], 5]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('3-scaled-tl.png') });
});

// M4-09 part 3: TEXTALIGN lines three notes up under the first, each keeping its height on the
// page (Current vertical), then spaces them 2 apart (Set spacing). The placing is unit-tested in
// packages/engine/test/commands/text-tools.test.ts; this checks the render worker measures the
// texts in their fonts for it end to end.
test('TEXTALIGN lines notes up under the first and spaces them', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.mouse.move(20, 400);

  // Three notes typed where they fell, at different starts.
  for (const [at, note] of [
    ['1000020,1000080', 'NOTES'],
    ['1000034,1000062', '1. DEBURR ALL EDGES'],
    ['1000027,1000041', '2. PAINT RAL 7035'],
  ] as const) {
    await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
    await type(page, `#${at}`, /Specify height/);
    await type(page, '5', /Specify rotation angle of text/);
    await type(page, '', 'Enter text:');
    await type(page, note, 'Enter text:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  const at = async () => (await texts(page)).map((t) => t['at'] as number[]);
  expect(await at()).toEqual([
    [20, 80],
    [34, 62],
    [27, 41],
  ]);
  await page.mouse.move(640, 560);
  await page.screenshot({ path: test.info().outputPath('4-before-textalign.png') });

  await type(page, 'TEXTALIGN', 'Select text objects to align [alIgnment/Options]:');
  await type(page, 'W', 'Specify first corner:');
  await type(page, '#1000000,1000000', 'Specify opposite corner:');
  await type(page, '#1000160,1000100', /Select text objects to align/);
  await type(page, '', 'Select text object to align to or [Points]:');
  await type(page, '#1000020,1000080', 'Pick second point or [Options]:');
  // The preview follows the cursor: the notes along the line from NOTES to it.
  await page.mouse.move(420, 560);
  await page.mouse.move(430, 570);
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('5-preview-at-cursor.png') });
  await type(page, '#1000020,1000000', 'Command:');
  // Left aligned under NOTES's baseline start, each at its own height.
  await expect.poll(at).toEqual([
    [20, 80],
    [20, 62],
    [20, 41],
  ]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(640, 560);
  await page.screenshot({ path: test.info().outputPath('6-aligned-current-vertical.png') });

  await type(page, 'TEXTALIGN', 'Select text objects to align [alIgnment/Options]:');
  await type(page, 'O', /Enter an option \[Distribute\/Set spacing/);
  await type(page, 'S', 'Specify spacing:');
  await type(page, '2', 'Select text objects to align [alIgnment/Options]:');
  await type(page, 'W', 'Specify first corner:');
  await type(page, '#1000000,1000000', 'Specify opposite corner:');
  await type(page, '#1000160,1000100', /Select text objects to align/);
  await type(page, '', 'Select text object to align to or [Points]:');
  await type(page, '#1000020,1000080', 'Pick second point or [Options]:');
  await type(page, '#1000020,1000000', 'Command:');
  // Each note's box starts 2 below the last one's: the baselines move up, as far apart as
  // the boxes' heights (the font's ascent and descent at 5) and the gap.
  await expect.poll(async () => (await at())[1]![1]!).toBeGreaterThan(62);
  const spaced = await at();
  expect(spaced.map((p) => p[0])).toEqual([20, 20, 20]);
  const step1 = spaced[0]![1]! - spaced[1]![1]!;
  const step2 = spaced[1]![1]! - spaced[2]![1]!;
  expect(step1).toBeCloseTo(step2, 2);
  expect(step1).toBeGreaterThan(7);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(640, 560);
  await page.screenshot({ path: test.info().outputPath('7-set-spacing.png') });
});
