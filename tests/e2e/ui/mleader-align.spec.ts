// M4-04 part 3: MLEADERALIGN and MLEADERCOLLECT from the app's command line, as a drafter tidies
// callouts: three text multileaders lined up a set spacing apart over the last one, then three
// tag balloons collected in a row under the first one's leader. The commands' prompts and
// geometry are unit-tested in packages/engine/test/commands/mleader-align.test.ts and the save in
// the corpus gate; this checks that the app's bus, canvas and render worker (which measures the
// text for the spacing) carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MultiLeaderGeometry } from '@triya/engine';
import {
  DXF,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  openWithPicker,
  worldAt,
} from '../app/page';
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

/** The multileaders this test changed or made, as the change sets last left them. */
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
          text: g.contentType === 2 ? g.text?.content : 'TAG',
          x: g.contentBase.x,
          y: g.contentBase.y,
          leaders: g.branches.length,
        };
      });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Enters `answers` one by one, each once the engine has read the one before. */
async function enter(page: Page, ...answers: string[]): Promise<void> {
  for (const a of answers) await enterCommand(page, a);
}

test('MLEADERALIGN spaces text callouts and MLEADERCOLLECT gathers tag balloons', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  // Points typed absolute (`#`) at fractions of the canvas: with Dynamic Input on, a point typed
  // bare after the first is relative.
  const box = (await activeCanvas(page).boundingBox())!;
  const lo = await worldAt(page, 100, 100);
  const hi = await worldAt(page, box.width - 100, box.height - 100);
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  const map = (f: number, a: number, b: number, size: number) =>
    (a + ((f * size - 100) / (size - 200)) * (b - a)).toFixed(4);
  const at = (fx: number, fy: number) =>
    `#${map(fx, lo.x, hi.x, box.width)},${map(fy, lo.y, hi.y, box.height)}`;
  // Three tag balloons (AutoCAD's built-in _TagCircle), then three text callouts, scattered.
  await enter(page, 'MLD', 'O', 'C', 'B', '_TagCircle', 'X', at(0.55, 0.85), at(0.62, 0.7), '1');
  await expect(prompt(page)).toHaveText('Command:');
  await enter(page, 'MLD', at(0.6, 0.35), at(0.72, 0.22), '2');
  await expect(prompt(page)).toHaveText('Command:');
  await enter(page, 'MLD', at(0.92, 0.6), at(0.85, 0.48), '3');
  await expect(prompt(page)).toHaveText('Command:');
  await enter(page, 'MLD', 'O', 'C', 'M', 'X');
  for (const [arrow, landing, text] of [
    [at(0.03, 0.85), at(0.12, 0.72), 'SEE NOTE 1'],
    [at(0.05, 0.3), at(0.15, 0.2), 'SEE NOTE 2'],
    [at(0.02, 0.55), at(0.1, 0.47), 'SEE NOTE 3'],
  ] as const) {
    if ((await prompt(page).textContent()) === 'Command:') await enter(page, 'MLD');
    await enter(page, arrow, landing);
    await expect(prompt(page)).toHaveText('Enter text:');
    await page.keyboard.type(text);
    await page.keyboard.press('Control+Enter');
    await expect(prompt(page)).toHaveText('Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // The text callouts, by a crossing that misses the tags, lined up 2 apart over the last one
  // (straight up from its content).
  await enter(page, 'MLA', 'C', at(0, 0.02), at(0.35, 0.98), '');
  await expect(prompt(page)).toHaveText('Select multileader to align to or [Options]:');
  await enter(page, 'O', 'S', '2', 'L');
  await expect(prompt(page)).toHaveText('Specify direction:');
  const last = (await leaders(page)).find((l) => l.text === 'SEE NOTE 3')!;
  await enter(page, `#${last.x},${last.y + 50}`);
  await expect(prompt(page)).toHaveText('Command:');
  // One above the other over SEE NOTE 3's content.
  await expect
    .poll(async () => {
      const xs = (await leaders(page)).filter((l) => l.text !== 'TAG').map((l) => l.x);
      return Math.max(...xs) - Math.min(...xs);
    })
    .toBeLessThan(1e-6);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-aligned.png') });

  // The tags, by a crossing that misses the text, collected in a row under the first one's leader.
  await enter(page, 'MLC', 'C', at(0.5, 0.02), at(0.99, 0.98), '');
  await expect(prompt(page)).toHaveText(
    'Specify collected multileader location or [Vertical/Horizontal/Wrap] <Horizontal>:',
  );
  await enter(page, at(0.72, 0.62));
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () =>
      (await leaders(page))
        .filter((l) => l.text === 'TAG')
        .map((l) => l.leaders)
        .sort(),
    )
    .toEqual([0, 0, 1]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('3-collected.png') });
});
