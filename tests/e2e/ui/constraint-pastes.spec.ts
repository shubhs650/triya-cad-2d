// M9-12: PARAMETERCOPYMODE 3 and 2 for pastes into another drawing, in the app. In the first
// drawing a line's length is a dimensional constraint `width=span`, where user parameter span
// is 30. Under 3 a paste into the second drawing, which has no span, makes span = 30 there (the
// Parameters Manager lists it); span set to 45 there stretches the pasted line. Under 2 a second
// paste names that span = 45, and the paste is solved to it: the line lands 45 long, not the 30
// it was copied at. The rules are unit-tested in
// packages/engine/test/commands/constraint-upkeep.test.ts ('PARAMETERCOPYMODE 2 and 3 for pastes
// into another drawing (M9-12)'), the solve with PlaneGCS in packages/constraints/test/upkeep.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DWG, DXF, expectDrawn, expectShown, gridOff, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

interface Row {
  readonly type: string;
  readonly parameter: string;
  readonly expression: string;
}

/** The showing drawing's session parameters (constraints' and user ones) as `name=expression`. */
const parameters = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Row>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const o of cs.objects?.added ?? [])
        if (o.type === 'TRIYA_DIMCONSTRAINT' || o.type === 'TRIYA_USERPARAMETER')
          out.set(o.handle, o as unknown as Row);
      for (const u of cs.objects?.updated ?? [])
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after as unknown as Row);
      for (const o of cs.objects?.removed ?? []) out.delete(o.handle);
    }
    return [...out.values()].map(
      (d) => `${d.type === 'TRIYA_USERPARAMETER' ? 'user ' : ''}${d.parameter}=${d.expression}`,
    );
  });

/** The lengths of the lines the showing drawing's session added, in the order added. */
const lengths = (page: Page) =>
  page.evaluate(() => {
    type Line = { start: { x: number; y: number }; end: { x: number; y: number } };
    const out = new Map<string, Line>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.type === 'LINE') out.set(a.entity.handle, a.entity.geom as unknown as Line);
      for (const u of cs.entities?.updated ?? [])
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after.geom as unknown as Line);
      for (const a of cs.entities?.removed ?? []) out.delete(a.entity.handle);
    }
    return [...out.values()].map(
      (g) => Math.round(Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) * 1000) / 1000,
    );
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');
const docTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The Parameters Manager's New User Parameter, renamed `name`, set to `expression`. */
async function newUserParameter(page: Page, name: string, expression: string): Promise<void> {
  await type(page, 'PARAMETERS', 'Command:');
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'New User Parameter' }).click();
  await expect(palette.getByRole('textbox', { name: 'Name of user1' })).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await setExpression(page, name, expression);
}

/** The Parameters Manager's Expression cell of `name` set to `expression`. */
async function setExpression(page: Page, name: string, expression: string): Promise<void> {
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  const cell = palette.getByRole('textbox', { name: `Expression of ${name}` });
  await cell.fill(expression);
  await cell.press('Enter');
  await expect(cell).toHaveValue(expression);
  // The cell keeps the focus: the command line takes typing again.
  await page.locator('#command-input').click();
}

test('pastes into another drawing make the user parameters it lacks (3) or solve to its own (2)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));

  /** The showing drawing zoomed to an empty part of its plan, and a click there. */
  const emptyPart = async () => {
    await gridOff(page);
    await type(page, 'Z', /^Specify corner of window/);
    await type(page, '1000000,1000000', 'Specify opposite corner:');
    await type(page, '1000200,1000120', 'Command:');
    const view = await viewOf(page);
    return {
      click: async (x: number, y: number) => {
        const p = view.at(1000000 + x, 1000000 + y);
        await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
      },
      shot: async (name: string) => {
        await expectDrawn(page);
        await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
        await page.screenshot({ path: test.info().outputPath(name) });
      },
    };
  };

  // The first drawing: span = 30, and a line 30 long whose length is width = span.
  await docTabs(page).first().click();
  await expectShown(page, path.basename(DXF));
  const first = await emptyPart();
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000010,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000040,1000020', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await newUserParameter(page, 'span', '30');
  await type(page, 'DCALIGNED', /<Object>:$/);
  await type(page, '', 'Select object:');
  await first.click(25, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await first.click(25, 12);
  await expect(prompt(page)).toHaveText(/^Dimension text </);
  await type(page, 'width=span', 'Command:');
  await expect
    .poll(() => parameters(page), { timeout: 15_000 })
    .toEqual(['user span=30', 'width=span']);
  await first.shot('1-copied-from.png');
  await type(page, 'COPYCLIP', 'Select objects:');
  await first.click(25, 20);
  await type(page, '', 'Command:');

  // PARAMETERCOPYMODE 3 (a per-user variable: every drawing's): the second drawing has no span,
  // so the paste makes it, as the first drawing had it.
  await type(page, 'PARAMETERCOPYMODE', /^Enter new value for PARAMETERCOPYMODE <1>:/);
  await type(page, '3', 'Command:');
  await docTabs(page).nth(1).click();
  await expectShown(page, path.basename(DWG));
  const second = await emptyPart();
  await type(page, 'PASTECLIP', 'Specify insertion point:');
  await type(page, '1000000,1000060', 'Command:');
  await expect
    .poll(() => parameters(page), { timeout: 15_000 })
    .toEqual(['user span=30', 'width=span']);
  expect(await lengths(page)).toEqual([30]);
  await type(page, 'PARAMETERS', 'Command:');
  const palette = page.getByRole('complementary', { name: 'Parameters Manager' });
  const users = palette
    .getByRole('table', { name: 'Parameters' })
    .getByRole('rowgroup', { name: 'User Parameters' });
  await expect(users.locator('tr[data-name="span"]')).toContainText('30.0000');
  await page.locator('#command-input').click();
  await second.shot('2-mode-3-made-span.png');

  // This drawing's span is 45: the pasted line follows.
  await setExpression(page, 'span', '45');
  await expect.poll(() => lengths(page), { timeout: 15_000 }).toEqual([45]);

  // PARAMETERCOPYMODE 2: the paste names this drawing's span and is solved to it at once.
  await type(page, 'PARAMETERCOPYMODE', /^Enter new value for PARAMETERCOPYMODE <3>:/);
  await type(page, '2', 'Command:');
  await type(page, 'PASTECLIP', 'Specify insertion point:');
  await type(page, '1000000,1000090', 'Command:');
  await expect.poll(() => lengths(page), { timeout: 15_000 }).toEqual([45, 45]);
  expect(await parameters(page)).toEqual(['user span=45', 'width=span', 'd1=span']);
  await second.shot('3-mode-2-solved-to-45.png');

  // One U takes the paste and its solve back together.
  await type(page, 'U', 'Command:');
  await expect.poll(() => lengths(page), { timeout: 15_000 }).toEqual([45]);
});
