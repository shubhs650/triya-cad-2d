// M4-10 part 1: UPDATEFIELD from the app's command line. uncommon.dxf has a block reference
// whose DATE attribute is a Date field (`\AcVar Date \f "dd/MM/yyyy"`) last evaluated on
// 21/04/2020; UPDATEFIELD on everything shows today's date in its place. The evaluation and the
// save are unit-tested in packages/engine (test/edit/fields.test.ts, test/commands/
// updatefield.test.ts) and packages/testkit (src/export/fields.test.ts); this checks that the
// app's bus, its clock and the file name it gives the command carry it end to end.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertGeometry } from '@triya/engine';
import { expectDrawn, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, 'ezdxf/examples_dxf/uncommon.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The DATE attribute's values as the changes made in the app leave them. */
const dates = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        const g = u.after.geom as InsertGeometry;
        if (g.kind !== 'INSERT') continue;
        for (const a of g.attributes) if (a.tag === 'DATE') out.push(a.value);
      }
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test("UPDATEFIELD shows today's date in a Date field", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '30,25', 'Specify opposite corner:');
  await type(page, '85,55', 'Command:');
  // Away from the navigation bar, whose menu opens on hover.
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('1-before-updatefield.png') });

  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  });
  await type(page, 'UPDATEFIELD', 'Select objects:');
  await type(page, 'ALL', /Select objects:/);
  await type(page, '', 'Command:');
  await expect(page.getByText('1 field(s) found.').last()).toBeAttached();
  await expect(page.getByText('1 field(s) updated.').last()).toBeAttached();
  await expect.poll(() => dates(page)).toEqual([today]);
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-after-updatefield.png') });

  // One undo step puts the date back.
  await type(page, 'U', 'Command:');
  await expect.poll(() => dates(page)).toEqual([today, '21/04/2020']);
});
