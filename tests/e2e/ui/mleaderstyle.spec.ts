// M4-04 part 2: MLEADERSTYLE's Multileader Style Manager in the app. ezdxf's text.dxf holds the
// multileader styles Annotative, ML_0.5, ML_12, ML_3, ML_5 (current, text 5), ML_6 and Standard,
// and no multileader: MLEADER places one in ML_5 first. MLS opens the manager on ML_5; Styles in
// use lists it alone. Modify... gives ML_5 a red leader with AutoCAD's Dot arrowhead (Leader
// Format) and 7 high framed text (Content), which the multileader takes at once. New... makes
// Tags from ML_5 with AutoCAD's built-in Circle block (Content, Block options), Set Current
// makes it current, and the next MLEADER draws a _TagCircle. Delete refuses Standard.
// What each action writes is unit-tested in packages/engine/test/commands/mleaderstyle.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MultiLeaderGeometry } from '@triya/engine';
import path from 'node:path';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'ezdxf/examples_dxf/text.dxf');

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.addStyleTag({ content: '.nav-bar { display: none !important; }' });
  // The canvas draws on the next frames.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The multileaders as the drawing's change sets left them, in the order they were added. */
const leaders = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<unknown, MultiLeaderGeometry>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.geom.kind === 'MULTILEADER') out.set(a.entity.id, a.entity.geom);
      for (const u of cs.entities?.updated ?? [])
        if (u.after.geom.kind === 'MULTILEADER') out.set(u.after.id, u.after.geom);
    }
    return [...out.values()];
  });

test('the Multileader Style Manager modifies, makes and sets multileader styles', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '-40,-40', 'Specify opposite corner:');
  await type(page, '160,60', 'Command:');
  await type(page, 'MLD', /^Specify leader arrowhead location/);
  await type(page, '0,-10', 'Specify leader landing location:');
  await type(page, '20,20', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('GATE VALVE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await leaders(page))[0]?.text?.height).toBe(5);
  await shot(page, '1-before');

  await enterCommand(page, 'MLS');
  const manager = page.getByRole('dialog', { name: 'Multileader Style Manager' });
  await expect(manager).toBeVisible();
  await expect(manager.getByTestId('mleaderstyle-current')).toHaveText('ML_5');
  const list = manager.getByRole('listbox', { name: 'Styles:' });
  await expect(list.getByRole('option')).toHaveCount(7);
  await expect(list.getByRole('option', { name: /ML_5/ })).toHaveAttribute('aria-selected', 'true');
  await manager.getByLabel('List:').selectOption('Styles in use');
  await expect(list.getByRole('option')).toHaveText([/ML_5/]);
  await manager.getByLabel('List:').selectOption('All styles');
  await shot(page, '2-manager');

  // Modify...: a red leader with the Dot arrowhead, 7 high framed text.
  await manager.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify Multileader Style: ML_5' });
  await expect(modify.getByRole('tab', { name: 'Leader Format' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(modify.getByRole('tab')).toHaveText([
    'Leader Format',
    'Leader Structure',
    'Content',
  ]);
  await modify.getByLabel('Color:').selectOption({ label: 'Red' });
  await modify.getByLabel('Symbol:').selectOption({ label: 'Dot' });
  await shot(page, '3-leader-format');
  await modify.getByRole('tab', { name: 'Leader Structure' }).click();
  await expect(modify.getByLabel('Maximum leader points:')).toHaveValue('2');
  await expect(modify.getByRole('checkbox', { name: 'Annotative' })).toBeDisabled();
  await modify.getByRole('tab', { name: 'Content' }).click();
  await expect(modify.getByLabel('Multileader type:')).toHaveValue('2');
  await modify.getByLabel('Text height:').fill('7');
  await modify.getByRole('checkbox', { name: 'Frame text' }).check();
  await expect(modify.getByLabel('Left attachment:')).toBeVisible();
  await shot(page, '4-content');
  await modify.getByRole('button', { name: 'OK' }).click();
  await expect(modify).toBeHidden();
  await expect.poll(async () => (await leaders(page))[0]?.text?.height).toBe(7);
  const restyled = (await leaders(page))[0]!;
  expect(restyled.lineColor).toEqual({ kind: 'aci', index: 1 });
  expect(restyled.textFrame).toBe(true);
  expect(restyled.arrowhead).toBeDefined();

  // New...: Tags from ML_5, content AutoCAD's built-in Circle block.
  await manager.getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Multileader Style' });
  await expect(create.getByLabel('New style name:')).toHaveValue('Copy of ML_5');
  await expect(create.getByLabel('Start with:')).toHaveValue('ML_5');
  await create.getByLabel('New style name:').fill('Tags');
  await create.getByRole('button', { name: 'Continue' }).click();
  const tags = page.getByRole('dialog', { name: 'Modify Multileader Style: Tags' });
  // The tabs open on the one last shown.
  await expect(tags.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
  await tags.getByLabel('Multileader type:').selectOption({ label: 'Block' });
  await expect(tags.getByLabel('Left attachment:')).toBeHidden();
  await tags.getByLabel('Source block:').selectOption({ label: 'Circle' });
  await tags.getByLabel('Attachment:').selectOption({ label: 'Center extents' });
  await shot(page, '5-new-block-style');
  await tags.getByRole('button', { name: 'OK' }).click();
  await expect(list.getByRole('option', { name: 'Tags' })).toHaveAttribute('aria-selected', 'true');
  await manager.getByRole('button', { name: 'Set Current' }).click();
  await expect(manager.getByTestId('mleaderstyle-current')).toHaveText('Tags');
  await shot(page, '6-tags-current');

  // Delete refuses Standard.
  await list.getByRole('option', { name: 'Standard' }).click();
  await expect(manager.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await list.press('Delete');
  await expect(manager.getByRole('status')).toHaveText('Standard cannot be deleted.');
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  // The next multileader takes Tags: a _TagCircle with its number.
  await type(page, 'MLD', /^Specify leader arrowhead location/);
  await type(page, '80,-10', 'Specify leader landing location:');
  await type(page, '110,20', /tag number/i);
  await type(page, '12', 'Command:');
  await expect.poll(async () => (await leaders(page)).length).toBe(2);
  const tag = (await leaders(page))[1]!;
  expect(tag.contentType).toBe(1);
  expect(tag.block?.attributes?.map((a) => a.value)).toEqual(['12']);
  await shot(page, '7-after');
});
