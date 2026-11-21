// M7-01: the ribbon (UI_SPEC.md §2–§3, DEC-017) and T9 (PRD §12): at 1280, 1366, 1600, 1920 and
// 2560 px every Home Draw, Modify and Annotation item shows as its own button inside the window,
// the page never scrolls sideways, and from 1920 the ribbon is the full three-row labelled one
// with every panel expanded. Its buttons run their commands; split buttons remember the entry
// picked; compressed panels list the rest of their items; a double-clicked tab minimizes it.
//
// M7-02: at each width the app draws exactly the layout `ribbon-snapshots.test.ts` pins for its
// breakpoint and compression step, every item with its icon; tooltips name the command, its
// aliases and keys; the Quick Access Undo and Redo show Fluent's arrows. Home's Layers and
// Properties dropdowns (part 3) show the selection's values, or the current ones, and set them.
// Contextual tabs (part 4) come and go with the command running and the selection.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import { layoutTab, type Breakpoint } from '../../../apps/web/src/ribbon/layout';
import { RIBBON_TABS } from '../../../apps/web/src/ribbon/ribbon.config';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** Owner-facing screenshots of the ribbon (M7 rule), written only when asked for. */
const SHOTS = process.env['TRIYA_SHOTS'];
const shot = async (page: Page, name: string) => {
  if (SHOTS)
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
};

const ribbon = (page: Page) => page.getByTestId('ribbon');
const prompt = (page: Page) => page.getByTestId('command-prompt');
const panel = (page: Page, name: string) => ribbon(page).getByRole('group', { name, exact: true });

async function open(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page);
}

const tooltip = (page: Page) => page.getByRole('tooltip');

/**
 * The tab shown is drawn as layout.ts lays it out at the ribbon's breakpoint and compression
 * step (the snapshot files pin those layouts): each panel's state, and its buttons' items, sizes
 * and icons (a split button shows the icon of the entry it runs, the first until one is picked).
 */
async function expectLayoutOfSnapshot(page: Page, tabId: string) {
  const got = await page.evaluate(() => {
    const r = document.querySelector<HTMLElement>('[data-testid="ribbon"]')!;
    const sizes = ['large-label', 'small-label', 'icon'];
    return {
      bp: r.dataset['breakpoint']!,
      steps: Number(r.dataset['steps']),
      panels: [...r.querySelectorAll<HTMLElement>('.ribbon-panel')].map((p) => ({
        panel: p.dataset['panel'],
        state: p.dataset['state'],
        items: [...p.querySelectorAll<HTMLElement>('.ribbon-item')].map(
          (b) =>
            `${b.dataset['item']}:${sizes.find((s) => b.classList.contains(s))}:` +
            b.querySelector<SVGElement>('svg[data-icon]')?.dataset['icon'],
        ),
      })),
    };
  });
  const tab = RIBBON_TABS.find((t) => t.id === tabId)!;
  const want = layoutTab(tab, got.bp as Breakpoint, got.steps).panels.map((p) => ({
    panel: p.panel.id,
    state: p.state,
    items: p.shown.map((s) => `${s.item.id}:${s.size}:${(s.item.menu?.[0] ?? s.item).icon}`),
  }));
  expect(got.panels).toEqual(want);
}

const PROTECTED = ['Draw', 'Modify', 'Annotation'];
const COUNTS: Record<string, number> = { Draw: 12, Modify: 19, Annotation: 5 };

/** Every button of the protected panels is in the window, uncovered, and not clipped. */
async function expectProtectedVisible(page: Page, width: number) {
  for (const name of PROTECTED) {
    const items = panel(page, name).locator('.ribbon-item');
    await expect(items).toHaveCount(COUNTS[name]!);
    for (const item of await items.all()) {
      await expect(item).toBeVisible();
      const label = (await item.getAttribute('aria-label')) ?? '';
      const box = (await item.boundingBox())!;
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, label).toBeLessThanOrEqual(width);
      // Nothing covers it: the point at its centre is the button or inside it.
      const hit = await item.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      expect(hit, label).toBe(true);
    }
  }
  // The protected panels never scroll, and the page never scrolls sideways.
  const scroll = await page.evaluate(() => {
    const p = document.querySelector('.ribbon-protected')!;
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      protected: p.scrollWidth - p.clientWidth,
    };
  });
  expect(scroll).toEqual({ page: 0, protected: 0 });
}

for (const [width, breakpoint] of [
  [1280, 'compact'],
  [1366, 'laptop'],
  [1600, 'wide'],
  [1920, 'full'],
  [2560, 'full'],
] as const) {
  test(`T9 at ${width} px: Home Draw, Modify and Annotation all show (${breakpoint})`, async ({
    page,
  }) => {
    await open(page, width, width === 1366 ? 768 : 900);
    await expect(ribbon(page)).toHaveAttribute('data-breakpoint', breakpoint);
    await expectProtectedVisible(page, width);
    await expectLayoutOfSnapshot(page, 'home');
    // The unprotected panels fit, compressed as far as needed, or scroll by themselves.
    const rest = await page.evaluate(() => {
      const r = document.querySelector('.ribbon-rest')!;
      return r.getBoundingClientRect().right;
    });
    expect(rest).toBeLessThanOrEqual(width);
    if (breakpoint === 'full') {
      // The professional drafter's ribbon: every panel expanded, three rows, labels shown.
      for (const s of await ribbon(page).locator('.ribbon-panel').all())
        await expect(s).toHaveAttribute('data-state', 'expanded');
      const line = panel(page, 'Draw').getByRole('button', { name: 'Line', exact: true });
      await expect(line).toHaveText(/Line/);
      expect((await line.boundingBox())!.height).toBeGreaterThan(60);
    } else if (breakpoint === 'wide') {
      // Primary items keep their labels; secondary ones are icons with tooltips.
      await expect(
        panel(page, 'Draw').getByRole('button', { name: 'Line', exact: true }),
      ).toHaveText(/Line/);
      const erase = panel(page, 'Modify').getByRole('button', { name: 'Erase', exact: true });
      await expect(erase).not.toHaveText(/Erase/);
      await erase.hover();
      await expect(tooltip(page)).toContainText('Erase');
      await expect(erase).toHaveAttribute('aria-describedby', 'ribbon-tooltip');
    } else {
      // One row of icons: no labels in the buttons.
      await expect(
        panel(page, 'Draw').getByRole('button', { name: 'Line', exact: true }),
      ).not.toHaveText(/Line/);
    }
    await page.mouse.move(width / 2, 600);
    await shot(page, `${width}-home`);
    // Every other tab, as its snapshot lays it out, in the window (M7-02 part 2).
    for (const t of RIBBON_TABS.slice(1)) {
      await ribbon(page).getByRole('tab', { name: t.label, exact: true }).click();
      await expectLayoutOfSnapshot(page, t.id);
      const right = await page.evaluate(
        () => document.querySelector('.ribbon-rest')!.getBoundingClientRect().right,
      );
      expect(right, t.id).toBeLessThanOrEqual(width);
      await shot(page, `${width}-${t.id}`);
    }
  });
}

test('at 1280 px the Clipboard panel collapses to a button listing its items', async ({ page }) => {
  await open(page, 1280);
  const clipboard = panel(page, 'Clipboard');
  await expect(clipboard).toHaveAttribute('data-state', 'collapsed');
  await clipboard.getByRole('button', { name: 'Clipboard' }).click();
  const menu = page.getByRole('menu', { name: 'Clipboard' });
  await expect(menu.locator('.ribbon-menu-label')).toHaveText([
    'Paste',
    'Paste as Block',
    'Paste to Original Coordinates',
    'Cut',
    'Copy Clip',
    'Copy with Base Point',
  ]);
  // The first entry has the focus; arrows move it; Esc closes the list.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Paste as Block' })).toBeFocused();
  await shot(page, '1280-clipboard-overflow');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(clipboard.getByRole('button', { name: 'Clipboard' })).toBeFocused();
});

test('a button runs its command; a split button runs the entry picked last', async ({ page }) => {
  await open(page, 1366, 768);
  const draw = panel(page, 'Draw');
  await draw.getByRole('button', { name: 'Line', exact: true }).click();
  await expect(prompt(page)).toHaveText(/^Specify first point/);
  // Keys typed after a click go to the command line, which Esc cancels.
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await draw.getByRole('button', { name: 'Circle options' }).click();
  const menu = page.getByRole('menu', { name: 'Circle' });
  await expect(menu.locator('.ribbon-menu-label')).toHaveText([
    'Center, Radius',
    '2-Point',
    '3-Point',
    'Tan, Tan, Radius',
  ]);
  await shot(page, '1366-circle-menu');
  await menu.getByRole('menuitem', { name: '2-Point' }).click();
  await expect(prompt(page)).toHaveText(/^Specify first end point of circle's diameter/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  // The button now runs 2-Point, as AutoCAD's does.
  const circle = draw.getByRole('button', { name: 'Circle', exact: true });
  await expect(circle.locator('svg')).toHaveAttribute('data-icon', 'circle-2p');
  await circle.hover();
  await expect(tooltip(page).locator('.ribbon-tooltip-title')).toHaveText('Circle: 2-Point');
  await expect(tooltip(page)).toContainText('CIRCLE 2P');
  await circle.click();
  await expect(tooltip(page)).toHaveCount(0);
  await expect(prompt(page)).toHaveText(/^Specify first end point of circle's diameter/);
  await page.keyboard.press('Escape');
});

test('a double-clicked tab minimizes the ribbon; a tab then pops its panels', async ({ page }) => {
  await open(page, 1600);
  const tabs = ribbon(page).getByRole('tab');
  await expect(tabs).toHaveText(RIBBON_TABS.map((t) => t.label));
  await tabs.filter({ hasText: 'Home' }).dblclick();
  await expect(ribbon(page).getByRole('tabpanel')).toHaveCount(0);

  await tabs.filter({ hasText: 'Insert' }).click();
  const body = ribbon(page).getByRole('tabpanel', { name: 'Insert' });
  await expect(body).toBeVisible();
  await expect(panel(page, 'Reference')).toBeVisible();
  // Running one of its items closes it again.
  await panel(page, 'Reference').getByRole('button', { name: 'Snap to Underlays options' }).click();
  const snap = page.getByRole('menu', { name: 'Snap to Underlays' });
  await expect(snap.locator('.ribbon-menu-label')).toHaveText([
    'Snap to Underlays ON',
    'Snap to Underlays OFF',
  ]);
  await expect(snap.getByRole('menuitemradio', { name: 'Snap to Underlays ON' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await shot(page, '1600-minimized-insert-popped');
  await snap.getByRole('menuitemradio', { name: 'Snap to Underlays OFF' }).click();
  await expect(body).toHaveCount(0);

  // The arrow keys move between the tabs; a double-click shows the full ribbon again.
  await tabs.filter({ hasText: 'Insert' }).dblclick();
  await expect(ribbon(page).getByRole('tabpanel', { name: 'Insert' })).toBeVisible();
  await tabs.filter({ hasText: 'Insert' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.filter({ hasText: 'Home' })).toBeFocused();
  await expect(ribbon(page).getByRole('tabpanel', { name: 'Home' })).toBeVisible();
});

test('a rich tooltip names the command, its aliases and keys', async ({ page }) => {
  await open(page, 1920);
  const line = panel(page, 'Draw').getByRole('button', { name: 'Line', exact: true });
  await line.hover();
  // It waits for the pointer to rest, then shows AutoCAD's name, description and command.
  const tip = tooltip(page);
  await expect(tip).toBeVisible();
  await expect(tip.locator('.ribbon-tooltip-title')).toHaveText('Line');
  await expect(tip.locator('.ribbon-tooltip-text')).toHaveText(
    'Creates straight line segments, each one a separate object.',
  );
  await expect(tip.locator('dt')).toHaveText(['Command', 'Alias']);
  await expect(tip.locator('dd')).toHaveText(['LINE', 'L']);
  // Under the button, inside the window.
  const at = (await line.boundingBox())!;
  const box = (await tip.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(at.y + at.height);
  await shot(page, '1920-tooltip-line');
  await page.mouse.move(960, 600);
  await expect(tip).toHaveCount(0);

  // The keys that run it too: Paste is Ctrl+V.
  await panel(page, 'Clipboard').getByRole('button', { name: 'Paste', exact: true }).hover();
  await expect(tip.locator('dd')).toHaveText(['PASTECLIP', 'Ctrl+V']);
  await shot(page, '1920-tooltip-paste');
  await page.mouse.move(960, 600);

  // Keyboard focus shows it at once; Esc hides it.
  await panel(page, 'Modify').getByRole('button', { name: 'Move', exact: true }).focus();
  await page.keyboard.press('Tab');
  const copy = panel(page, 'Modify').getByRole('button', { name: 'Copy', exact: true });
  await expect(copy).toBeFocused();
  await expect(tip.locator('.ribbon-tooltip-title')).toHaveText('Copy');
  await expect(tip.locator('dd')).toHaveText(['COPY', 'CO, CP']);
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
});

test('the Quick Access Undo and Redo show Fluent arrows', async ({ page }) => {
  await open(page, 1366, 768);
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }).locator('svg'),
  ).toHaveAttribute('data-icon', 'arrow_undo');
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }).locator('svg'),
  ).toHaveAttribute('data-icon', 'arrow_redo');
});

test('the other tabs open palettes, the theme and the app windows (M7-02 part 2)', async ({
  page,
}) => {
  await open(page, 1920);
  const tab = (name: string) => ribbon(page).getByRole('tab', { name, exact: true }).click();

  // View > Palettes > Command History shows it in the palette stack.
  await tab('View');
  await panel(page, 'Palettes').getByRole('button', { name: 'Command History' }).click();
  await expect(page.getByRole('complementary', { name: 'Command History' })).toBeVisible();
  // View > Interface > Theme ▾ Dark: the chrome goes dark, the list checks Dark.
  await panel(page, 'Interface').getByRole('button', { name: 'Theme options' }).click();
  const themes = page.getByRole('menu', { name: 'Theme' });
  await expect(themes.locator('.ribbon-menu-label')).toHaveText([
    'Use System Setting',
    'Light',
    'Dark',
  ]);
  await themes.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, '1920-view-dark');
  await panel(page, 'Interface').getByRole('button', { name: 'Theme options' }).click();
  await expect(themes.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await themes.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Annotate > Annotation Scaling: AutoCAD's annotative tools, greyed out, saying why.
  await tab('Annotate');
  const addScales = panel(page, 'Annotation Scaling').getByRole('button', {
    name: 'Add/Delete Scales',
  });
  await expect(addScales).toHaveAttribute('aria-disabled', 'true');
  await addScales.hover();
  await expect(tooltip(page)).toContainText('Annotative creation is view-only in v1');
  await shot(page, '1920-annotate-unavailable');
  // Clicking it runs nothing (Playwright, as a screen reader, treats it as disabled).
  await addScales.click({ force: true });
  await expect(prompt(page)).toHaveText('Command:');

  // Annotate > Dimensions > Continue runs DIMCONTINUE.
  await panel(page, 'Dimensions').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(prompt(page)).toHaveText(/continue|extension line|Select/i);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // Tools > Options opens the app's settings.
  await tab('Tools');
  await panel(page, 'Settings').getByRole('button', { name: 'Options', exact: true }).click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
  await shot(page, '1920-tools-options');
});

test("Home's Layers and Properties dropdowns follow the selection and set it (M7-02 part 3)", async ({
  page,
}) => {
  await open(page, 1920);
  const layer = panel(page, 'Layers').getByRole('button', { name: /^Layer: / });
  const color = panel(page, 'Properties').getByRole('button', { name: /^Object Color: / });
  const lineweight = panel(page, 'Properties').getByRole('button', { name: /^Lineweight: / });
  // Nothing selected: the current settings, which new objects take.
  await expect(layer).toHaveAccessibleName('Layer: 0');
  await expect(color).toHaveAccessibleName('Object Color: ByLayer');
  await expect(lineweight).toHaveAccessibleName('Lineweight: ByLayer');

  // The layer list names every layer with its states; a pick makes it current (CLAYER).
  await layer.click();
  const layers = page.getByRole('listbox', { name: 'Layer' });
  await expect(layers.getByRole('option')).toHaveText(['0', 'Defpoints', 'HATCH']);
  await expect(layers.getByRole('option', { name: '0' })).toHaveAttribute('aria-selected', 'true');
  await shot(page, '1920-layer-dropdown');
  await layers.getByRole('option', { name: 'Defpoints' }).click();
  await expect(layers).toHaveCount(0);
  await expect(layer).toHaveAccessibleName('Layer: Defpoints');
  await expect(layer).toBeFocused();

  // Its state buttons lock and unlock a layer without picking it.
  await layer.click();
  await layers.getByRole('button', { name: 'Lock layer 0' }).click();
  await expect(layers.getByRole('button', { name: 'Unlock layer 0' })).toBeVisible();
  await expect(layer).toHaveAccessibleName('Layer: Defpoints');
  await layers.getByRole('button', { name: 'Unlock layer 0' }).click();
  await expect(layers.getByRole('button', { name: 'Lock layer 0' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(layers).toHaveCount(0);

  // The keyboard picks too: the colour list opens on its value; Red is three entries down.
  await color.focus();
  await page.keyboard.press('Enter');
  const colors = page.getByRole('listbox', { name: 'Object Color' });
  await expect(colors.getByRole('option', { name: 'ByLayer' })).toBeFocused();
  await expect(colors.getByRole('option').last()).toHaveText('Select Colors...');
  await shot(page, '1920-color-dropdown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(color).toHaveAccessibleName('Object Color: Red');

  // With objects selected they show the objects' values, and a pick changes the objects.
  await page.locator('canvas').first().hover();
  await page.keyboard.press('Control+a');
  // The drawing is one hatch, on HATCH, coloured White; its Hatch Editor tab (part 4) comes up
  // and Home is a click away.
  await expect(ribbon(page).getByRole('tab', { selected: true })).toHaveText('Hatch Editor');
  await ribbon(page).getByRole('tab', { name: 'Home', exact: true }).click();
  await expect(layer).toHaveAccessibleName('Layer: HATCH');
  await expect(color).toHaveAccessibleName('Object Color: White');
  await lineweight.click();
  await page
    .getByRole('listbox', { name: 'Lineweight' })
    .getByRole('option', { name: '0.30 mm' })
    .click();
  await expect(lineweight).toHaveAccessibleName('Lineweight: 0.30 mm');
  await shot(page, '1920-properties-selection');
  // Deselected, they show the current settings again.
  await page.keyboard.press('Escape');
  await expect(lineweight).toHaveAccessibleName('Lineweight: ByLayer');
  await expect(color).toHaveAccessibleName('Object Color: Red');

  // "Select Colors..." opens the Select Color dialog.
  await color.click();
  await colors.getByRole('option', { name: 'Select Colors...' }).click();
  await expect(page.getByRole('dialog', { name: 'Select Color' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Select Color' })
    .getByRole('button', { name: 'Cancel' })
    .click();
});

test('a compressed Properties panel lists its dropdowns, each opening its list', async ({
  page,
}) => {
  await open(page, 1280);
  const properties = panel(page, 'Properties');
  await expect(properties).toHaveAttribute('data-state', 'compressed');
  // The layer dropdown stays, naming the layer, beside Layer Properties.
  await expect(
    panel(page, 'Layers').getByRole('button', { name: 'Layer: 0', exact: true }),
  ).toBeVisible();
  await properties.getByRole('button', { name: 'More Properties tools' }).click();
  const menu = page.getByRole('menu', { name: 'Properties' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Object Color\s*ByLayer/,
    /Linetype\s*ByLayer/,
    /Lineweight\s*ByLayer/,
    /Transparency\s*ByLayer/,
    'Properties',
  ]);
  await shot(page, '1280-properties-popover');
  await menu.getByRole('menuitem', { name: 'Transparency: ByLayer' }).click();
  const list = page.getByRole('listbox', { name: 'Transparency' });
  await list.getByRole('option', { name: '30', exact: true }).click();
  await properties.getByRole('button', { name: 'More Properties tools' }).click();
  await expect(menu.getByRole('menuitem', { name: 'Transparency: 30' })).toBeVisible();
});

test('contextual tabs come with the selection and the command running (M7-02 part 4)', async ({
  page,
}) => {
  await open(page, 1920);
  const tabs = ribbon(page).getByRole('tab');
  const selected = ribbon(page).getByRole('tab', { selected: true });
  const canvas = page.locator('canvas').first();

  // The drawing is one hatch: selected, the Hatch Editor tab comes up beside the others.
  await canvas.hover();
  await page.keyboard.press('Control+a');
  await expect(selected).toHaveText('Hatch Editor');
  await expect(tabs).toHaveCount(8);
  await expect(ribbon(page).getByRole('group')).toHaveText([
    /Boundaries/,
    /Properties/,
    /Origin/,
    /Options/,
    /Close/,
  ]);
  await page.mouse.move(960, 600);
  await shot(page, '1920-hatch-editor');
  // Its Close button deselects the hatch: the tab goes, and Home is back.
  await panel(page, 'Close').getByRole('button', { name: 'Close Hatch Editor' }).click();
  await expect(tabs).toHaveCount(7);
  await expect(selected).toHaveText('Home');

  // Shown from another tab, Esc takes it away and that tab is back.
  await ribbon(page).getByRole('tab', { name: 'Annotate', exact: true }).click();
  await canvas.hover();
  await page.keyboard.press('Control+a');
  await expect(selected).toHaveText('Hatch Editor');
  await page.keyboard.press('Escape');
  await expect(selected).toHaveText('Annotate');

  // While ARRAYRECT runs, Array Creation's buttons answer its prompts.
  await enterCommand(page, 'ARRAYRECT');
  await expect(selected).toHaveText('Array Creation');
  await enterCommand(page, 'ALL');
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText(/Select grip to edit array/);
  await panel(page, 'Rows').getByRole('button', { name: 'Rows', exact: true }).click();
  await expect(prompt(page)).toHaveText(/rows/i);
  await shot(page, '1920-array-creation');
  await enterCommand(page, '2');
  await expect(prompt(page)).toHaveText(/distance between rows/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText(/Select grip to edit array/);
  await panel(page, 'Close').getByRole('button', { name: 'Close Array' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect(selected).toHaveText('Annotate');

  // The array made is associative: selected, its Array tab comes up.
  await canvas.hover();
  await page.keyboard.press('Control+a');
  await expect(selected).toHaveText('Array');
  await shot(page, '1920-array');
  await page.keyboard.press('Escape');
  await expect(selected).toHaveText('Annotate');
});
