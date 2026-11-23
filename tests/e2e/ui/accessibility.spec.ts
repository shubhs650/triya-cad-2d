// M7-10: the accessibility baseline. The start screen, the drawing window, every ribbon tab, every
// palette, the menus and every dialog break none of axe-core's critical rules nor the serious ARIA
// naming and focus rules (tests/e2e/app/a11y.ts, DEC-079). Every dialog is keyboard-operable:
// opened from the command line, it has the focus; Tab stays in it and reaches each control (or
// the one stop of a tab list, list box or grid, which the arrow keys move along); Esc closes it
// and gives the focus back to where it was, the command line. The drawing window's Tab order
// follows the screen, and its first stop skips to the command line.
// TRIYA_SHOTS=<dir> writes screenshots there.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { blocking, checkA11y, keyboardProbe } from '../app/a11y';
import {
  activeCanvas,
  enterCommand,
  expectInputsRead,
  expectNoModalDialog,
  expectShown,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

const FILE = new URL(
  '../../../packages/testkit/fixtures/attributes/title-block.dxf',
  import.meta.url,
).pathname;

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const commandLine = (page: Page) => page.getByLabel('Command', { exact: true });

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function expectAccessible(page: Page): Promise<void> {
  expect(blocking(await checkA11y(page))).toEqual([]);
}

/** Opens the title block zoomed to it; returns page coordinates of a point of the drawing. */
async function openTitleBlock(
  page: Page,
): Promise<(x: number, y: number) => { x: number; y: number }> {
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'W');
  await enterCommand(page, '225,5');
  await enterCommand(page, '415,75');
  await expect(prompt(page)).toHaveText('Command:');
  await expectInputsRead(page);
  const box = (await activeCanvas(page).boundingBox())!;
  // ZOOM Window fits 190 × 70 units about (320, 40) into the canvas (attributes.spec.ts).
  const k = Math.min(box.width / 190, box.height / 70);
  return (x, y) => ({
    x: box.x + box.width / 2 + (x - 320) * k,
    y: box.y + box.height / 2 - (y - 40) * k,
  });
}

/** A point on the title block's frame: the line under the title fields (attributes.spec.ts). */
const FRAME = { x: 330, y: 44 };

interface DialogCase {
  /** The dialog's accessible name. */
  readonly name: string | RegExp;
  /** What is typed at the command line, each ended by Enter, to open it. */
  readonly typed?: readonly string[];
  /** A screenshot's name, taken after the Tab walk (TRIYA_SHOTS). */
  readonly shot?: string;
  /** Or how it is opened otherwise; `at` maps drawing points to the page. */
  readonly open?: (
    page: Page,
    at: (x: number, y: number) => { x: number; y: number },
  ) => Promise<void>;
}

/** Every dialog the command line opens on the title block (and the ones opened by a pick). */
const DIALOGS: readonly DialogCase[] = [
  { name: 'Options', typed: ['OPTIONS'] },
  { name: 'About Triya CAD 2D', typed: ['ABOUT'] },
  { name: 'Drafting Settings', typed: ['DSETTINGS'], shot: 'dialog-drafting-settings-tab-walk' },
  { name: 'Dimension Style Manager', typed: ['DIMSTYLE'] },
  { name: 'Text Style', typed: ['STYLE'] },
  { name: 'Table Style', typed: ['TABLESTYLE'] },
  { name: 'Multileader Style Manager', typed: ['MLEADERSTYLE'] },
  { name: 'Insert', typed: ['INSERT'] },
  { name: 'Block Definition', typed: ['BLOCK'] },
  { name: 'Write Block', typed: ['WBLOCK'] },
  { name: 'Edit Block Definition', typed: ['BEDIT'] },
  { name: 'Block Attribute Manager', typed: ['BATTMAN'] },
  { name: 'Attribute Definition', typed: ['ATTDEF'] },
  { name: 'Linetype Manager', typed: ['LINETYPE'] },
  { name: 'Lineweight Settings', typed: ['LWEIGHT'] },
  { name: 'Point Style', typed: ['DDPTYPE'] },
  { name: 'Drawing Units', typed: ['UNITS'] },
  { name: 'Edit Drawing Scales', typed: ['SCALELISTEDIT'] },
  { name: 'Page Setup Manager', typed: ['PAGESETUP'] },
  { name: 'Plot - Model', typed: ['PLOT'] },
  { name: 'Publish', typed: ['PUBLISH'] },
  { name: 'Export Data', typed: ['EXPORT'] },
  { name: 'Purge', typed: ['PURGE'] },
  { name: 'Layer States Manager', typed: ['LAYERSTATE'] },
  { name: /^LayerWalk/, typed: ['LAYWALK'] },
  { name: 'View Manager', typed: ['VIEW'] },
  { name: 'Viewports', typed: ['VPORTS'] },
  { name: 'Quick Select', typed: ['QSELECT'] },
  { name: 'Object Selection Filters', typed: ['FILTER'] },
  { name: 'Select Similar Settings', typed: ['SELECTSIMILAR', 'SE'] },
  { name: 'Object Grouping', typed: ['CLASSICGROUP'] },
  { name: 'Find and Replace', typed: ['FIND'] },
  { name: 'Check Spelling', typed: ['SPELL'] },
  { name: 'Insert Table', typed: ['TABLE'] },
  { name: 'Field', typed: ['FIELD'] },
  { name: 'Geometric Tolerance', typed: ['TOLERANCE'] },
  { name: 'Hatch and Gradient', typed: ['HATCH'] },
  { name: 'Attach External Reference', typed: ['XATTACH'] },
  { name: 'Attach Image', typed: ['IMAGEATTACH'] },
  { name: 'Select Template', typed: ['NEW'] },
  {
    name: 'Enhanced Attribute Editor',
    shot: 'dialog-enhanced-attribute-editor-tab-walk',
    open: async (page, at) => {
      const p = at(FRAME.x, FRAME.y);
      await page.mouse.dblclick(p.x, p.y);
    },
  },
  {
    name: 'Edit Attributes',
    open: async (page, at) => {
      await enterCommand(page, 'ATTEDIT');
      await expect(prompt(page)).toHaveText('Select block reference:');
      const p = at(FRAME.x, FRAME.y);
      await page.mouse.click(p.x, p.y);
    },
  },
];

/** Opens `c`, checks it, walks it with Tab and closes it with Esc. */
async function checkDialog(
  page: Page,
  c: DialogCase,
  at: (x: number, y: number) => { x: number; y: number },
) {
  await expectNoModalDialog(page);
  await expect(prompt(page)).toHaveText('Command:');
  if (c.typed) for (const t of c.typed) await enterCommand(page, t);
  else await c.open!(page, at);
  const dialog = page.getByRole('dialog', { name: c.name, exact: true });
  await expect(dialog).toBeVisible();
  // A dialog filling in its fields (Export Data measures the space first) is walked once it has:
  // under load the Tab walk ran before they showed and found them unreached afterwards (M9-07).
  await expect(dialog).not.toHaveAttribute('aria-busy', 'true');
  await dialog.evaluate((d) => d.setAttribute('data-a11y-probe', ''));
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await expectAccessible(page);
  const k = await keyboardProbe(page, '[data-a11y-probe]');
  expect(k.focusInside).toBe(true);
  expect(k.stops.length).toBeGreaterThan(0);
  expect(k.outside).toEqual([]);
  expect(k.unreached).toEqual([]);
  expect(k.pointerOnly).toEqual([]);
  if (c.shot) await shot(page, c.shot);
  await dialog.evaluate((d) => d.removeAttribute('data-a11y-probe'));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expectNoModalDialog(page);
  // A dialog opened by a command's option (SELECTSIMILAR's SEttings) goes back to its prompt.
  if ((c.typed?.length ?? 0) > 1) await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  // The focus goes back to the command line, where it was (typed), or where it goes when what
  // had it cannot take it back (a pick on the canvas, which takes no focus).
  await expect(commandLine(page)).toBeFocused();
}

const HALF = Math.ceil(DIALOGS.length / 2);
for (const [part, list] of [
  [1, DIALOGS.slice(0, HALF)],
  [2, DIALOGS.slice(HALF)],
] as const) {
  test(`every dialog is accessible and keyboard-operable (part ${part})`, async ({ page }) => {
    test.setTimeout(240_000);
    const at = await openTitleBlock(page);
    for (const c of list) {
      await test.step(String(c.name), async () => {
        await checkDialog(page, c, at);
      });
    }
  });
}

test('the start screen, drawing window, ribbon tabs, palettes and menus are accessible', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Start' })).toBeVisible();
  await test.step('start screen', () => expectAccessible(page));
  await shot(page, 'start-screen');

  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await test.step('drawing window', () => expectAccessible(page));

  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  const tabs = await ribbon.getByRole('tab').allTextContents();
  // AutoCAD's tabs but Parametric (M9-05).
  expect(tabs.length).toBeGreaterThanOrEqual(7);
  for (const name of tabs) {
    await test.step(`ribbon tab ${name}`, async () => {
      await ribbon.getByRole('tab', { name, exact: true }).click();
      await expectAccessible(page);
    });
  }
  await ribbon.getByRole('tab', { name: 'Home', exact: true }).click();

  // Split buttons' menus and the Layers dropdown.
  for (const name of ['Circle options', 'Dimension options', 'Layer: 0']) {
    await test.step(`menu ${name}`, async () => {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('menu').or(page.getByRole('listbox')).first()).toBeVisible();
      await expectAccessible(page);
      await page.keyboard.press('Escape');
    });
  }

  for (const [command, name] of [
    ['PROPERTIES', 'Properties'],
    ['LAYER', 'Layers'],
    ['XREF', 'References'],
    ['ADCENTER', 'DesignCenter'],
    ['TEXTSCR', 'Command History'],
  ] as const) {
    await test.step(`palette ${name}`, async () => {
      await enterCommand(page, command);
      await expect(page.getByRole('complementary', { name })).toBeVisible();
      await expectAccessible(page);
    });
  }
  for (const [tab, name] of [
    ['View', 'Health'],
    ['Tools', 'Diagnostics'],
  ] as const) {
    await test.step(`palette ${name}`, async () => {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.getByTestId('ribbon').getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('complementary', { name })).toBeVisible();
      await expectAccessible(page);
    });
  }
  await shot(page, 'palettes');

  await test.step('Object snap modes menu', async () => {
    await page.getByRole('button', { name: 'Object snap modes' }).click();
    await expect(page.getByRole('menu', { name: 'Object snap modes' })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });
  await test.step('Shift+right-click snap menu', async () => {
    await enterCommand(page, 'LINE');
    await expect(prompt(page)).toHaveText('Specify first point:');
    const box = (await activeCanvas(page).boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.keyboard.up('Shift');
    await expect(page.getByRole('menu')).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveText('Command:');
  });
  await test.step('Ctrl+K command palette', async () => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
  });
});

test("the drawing window's Tab order follows the screen and starts with a skip to the command line", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const fromTop = () =>
    // Focusing the page itself starts Tab at its top, where a blur would start it after the
    // element that had the focus.
    page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
  await fromTop();

  // The first stop is the skip link, shown while it has the focus; Enter goes to the command line.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to command line' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await shot(page, 'skip-link');
  await page.keyboard.press('Enter');
  await expect(commandLine(page)).toBeFocused();

  // Tab from the top goes skip link, title bar (with the drawing tabs), ribbon, the drawing
  // area's navigation bar, the palette rail, layout tabs, command line and status bar: each part
  // once, in the order they sit in on screen.
  await fromTop();
  const regions: string[] = [];
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    const region = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'none';
      const parts: [string, string][] = [
        ['.skip-link', 'skip link'],
        ['header.title-bar', 'title bar'],
        ['.ribbon', 'ribbon'],
        ['main', 'drawing area'],
        ['nav.palette-rail', 'palettes'],
        ['nav.layout-tabs', 'layout tabs'],
        ['.command-line', 'command line'],
        ['footer.status-bar', 'status bar'],
      ];
      return parts.find(([sel]) => a.closest(sel))?.[1] ?? `other: ${a.outerHTML.slice(0, 80)}`;
    });
    if (region === 'none') break;
    if (regions.at(-1) !== region) regions.push(region);
  }
  expect(regions).toEqual([
    'skip link',
    'title bar',
    'ribbon',
    'drawing area',
    'palettes',
    'layout tabs',
    'command line',
    'status bar',
  ]);
});

test('the drawing tabs are one Tab stop: the arrow keys move along them, Enter shows one, Delete closes it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await enterCommand(page, 'NEW');
  const template = page.getByRole('dialog', { name: 'Select Template' });
  await expect(template).toBeVisible();
  await template.getByRole('button', { name: 'Open', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  // Only the drawing shown is a Tab stop.
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
  await tabs.nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(0)).toBeFocused();
  // Moving the focus does not switch drawings; Enter does.
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toBeFocused();

  await shot(page, 'drawing-tabs-arrow-keys');

  // Delete closes the focused drawing (unchanged, so it asks nothing); the focus stays on the tabs.
  await page.keyboard.press('Delete');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveText(path.basename(FILE));
});
