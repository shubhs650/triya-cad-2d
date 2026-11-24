// M9-03 part 5: the Parameters Manager. On an empty part of the plan a line is drawn and DCALIGNED
// puts `width=60` on it; Parametric > Manage > Parameters Manager opens the palette, which lists
// width with its expression, value and type. A new expression typed in place moves the line (its
// dynamic constraint reaches further right); a self-reference is refused on the command line and
// the cell shows the expression again; a rename and a description are kept; the search narrows
// the list; Delete removes the constraint; PARAMETERSCLOSE closes the palette. Part 6: New makes
// a user parameter, its name ready to type, which the constraint's expression then names. The edits'
// behaviour is unit-tested in packages/engine/test/commands/parameters.test.ts and, with
// PlaneGCS, packages/constraints/test/solver.test.ts; this checks the palette, ribbon and worker.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Pixels of the dynamic constraints' blue (#5ab4ff) between `a` and `b` of the active canvas. */
async function bluePixels(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, x0, y0, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 2]! > 150 && d[i + 2]! - d[i]! > 70 && d[i + 1]! > d[i]!) n++;
      }
      return n;
    },
    {
      b64: png,
      x0: Math.round(Math.min(a.x, b.x)),
      y0: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y)),
    },
  );
}

test('the Parameters Manager lists, edits, renames, searches and deletes parameters', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000020,1000040', 'Specify next point or [Undo]:');
  await type(page, '1000080,1000040', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** Right of the line's end: blue once the line reaches past x = 84. */
  const right = () => bluePixels(page, at(84, 46), at(104, 70));

  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 40);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, 'width=60', 'Command:');
  await expect.poll(() => bluePixels(page, at(10, 46), at(90, 70))).toBeGreaterThan(100);
  expect(await right()).toBe(0);

  // Parametric > Manage > Parameters Manager.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  await page
    .getByRole('group', { name: 'Manage' })
    .getByRole('button', { name: 'Parameters Manager', exact: true })
    .click();
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(palette).toBeVisible();
  const table = palette.getByRole('table', { name: 'Parameters' });
  const rows = table.locator('tbody tr[data-name]');
  await expect(rows).toHaveCount(1);
  const expression = palette.getByRole('textbox', { name: 'Expression of width' });
  await expect(palette.getByRole('textbox', { name: 'Name of width' })).toHaveValue('width');
  await expect(expression).toHaveValue('60');
  await expect(rows.first()).toContainText('60.0000');
  await expect(rows.first()).toContainText('Aligned');
  await shot('1-parameters-manager.png');

  // A new expression moves the line: its constraint now reaches past x = 84.
  await expression.fill('80');
  await expression.press('Enter');
  await expect(rows.first()).toContainText('80.0000');
  await expect.poll(right, { timeout: 15_000 }).toBeGreaterThan(20);
  await shot('2-expression-edited.png');

  // A self-reference is refused: the command line says why, the cell shows 80 again.
  await expression.fill('width*2');
  await expression.press('Enter');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    /circular|cycle|itself/i,
  );
  await expect(expression).toHaveValue('80');

  // A rename and a description are kept.
  const name = palette.getByRole('textbox', { name: 'Name of width' });
  await name.fill('span');
  await name.press('Enter');
  const description = palette.getByRole('textbox', { name: 'Description of span' });
  await expect(description).toBeVisible();
  await description.fill('Bracket span');
  await description.press('Enter');
  await expect(description).toHaveValue('Bracket span');
  await shot('3-renamed-described.png');

  // The search narrows the list.
  const search = palette.getByRole('searchbox', { name: 'Search for parameter' });
  await search.fill('nothing');
  await expect(rows).toHaveCount(0);
  await expect(palette).toContainText('No parameter matches the search.');
  await search.fill('BRACKET');
  await expect(rows).toHaveCount(1);

  // Delete removes the constraint: the palette lists none and the line keeps its length.
  await rows.first().getByRole('rowheader').click();
  await palette.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(palette).toContainText(
    'None: the drawing has no dimensional constraints or user parameters.',
  );
  await expect.poll(right).toBe(0);
  await shot('4-deleted.png');

  // One U brings it back; PARAMETERSCLOSE closes the palette.
  await activeCanvas(page).focus();
  await type(page, 'U', 'Command:');
  await expect(rows).toHaveCount(1);
  await type(page, 'PARAMETERSCLOSE', 'Command:');
  await expect(palette).toBeHidden();
});

test('New makes a user parameter that a constraint names (M9-03 part 6)', async ({ page }) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000020,1000040', 'Specify next point or [Undo]:');
  await type(page, '1000080,1000040', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const right = () => bluePixels(page, at(84, 46), at(104, 70));

  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 40);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, 'width=60', 'Command:');
  await expect.poll(() => bluePixels(page, at(10, 46), at(90, 70))).toBeGreaterThan(100);

  await type(page, 'PARAMETERS', 'Command:');
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(palette).toBeVisible();
  const table = palette.getByRole('table', { name: 'Parameters' });
  const users = table.getByRole('rowgroup', { name: 'User Parameters' });
  await expect(users).toHaveCount(0);

  // New: user1 = 1 under User Parameters, its name selected for typing.
  await palette.getByRole('button', { name: 'New User Parameter' }).click();
  const user1 = palette.getByRole('textbox', { name: 'Name of user1' });
  await expect(user1).toBeFocused();
  await expect(users.locator('tr[data-name]')).toHaveCount(1);
  await expect(users).toContainText('User Parameters');
  await expect(palette.getByRole('textbox', { name: 'Expression of user1' })).toHaveValue('1');
  await expect(users.locator('tr[data-name="user1"]')).toContainText('1.0000');
  await expect(users.locator('tr[data-name="user1"]')).toContainText('User');
  await shot('1-new-user-parameter.png');

  // Typed over at once: the name is kept.
  await page.keyboard.type('span');
  await page.keyboard.press('Enter');
  const expression = palette.getByRole('textbox', { name: 'Expression of span' });
  await expect(expression).toHaveValue('1');
  await expression.fill('80');
  await expression.press('Enter');
  await expect(users.locator('tr[data-name="span"]')).toContainText('80.0000');
  const description = palette.getByRole('textbox', { name: 'Description of span' });
  await description.fill('Bracket span');
  await description.press('Enter');
  await expect(description).toHaveValue('Bracket span');

  // The constraint names it: the line reaches past x = 84.
  expect(await right()).toBe(0);
  const width = palette.getByRole('textbox', { name: 'Expression of width' });
  await width.fill('span');
  await width.press('Enter');
  await expect(table.locator('tr[data-name="width"]')).toContainText('80.0000');
  await expect.poll(right, { timeout: 15_000 }).toBeGreaterThan(20);
  await shot('2-constraint-names-it.png');

  // A second New takes user1 again, the lowest free name.
  await palette.getByRole('button', { name: 'New User Parameter' }).click();
  await expect(palette.getByRole('textbox', { name: 'Name of user1' })).toBeFocused();
  await page.keyboard.press('Escape');

  // Deleting span leaves width with its value; the line stays.
  await users.locator('tr[data-name="span"]').getByRole('rowheader').click();
  await palette.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(users.locator('tr[data-name]')).toHaveCount(1);
  await expect(width).toHaveValue('80');
  expect(await right()).toBeGreaterThan(20);
  await shot('3-user-parameter-deleted.png');

  // One U brings it back.
  await activeCanvas(page).focus();
  await type(page, 'U', 'Command:');
  await expect(users.locator('tr[data-name]')).toHaveCount(2);
  await expect(width).toHaveValue('span');
});
