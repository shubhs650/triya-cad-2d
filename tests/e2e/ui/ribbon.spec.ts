// M7-01: the ribbon (UI_SPEC.md §2–§3, DEC-017) and T9 (PRD §12): at 1280, 1366, 1600, 1920 and
// 2560 px every Home Draw, Modify and Annotation item shows as its own button inside the window,
// the page never scrolls sideways, and from 1920 the ribbon is the full three-row labelled one
// with every panel expanded. Its buttons run their commands; split buttons remember the entry
// picked; compressed panels list the rest of their items; a double-clicked tab minimizes it.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

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
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
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
      await expect(erase).toHaveAttribute('title', 'Erase');
      await expect(erase).not.toHaveText(/Erase/);
    } else {
      // One row of icons: no labels in the buttons.
      await expect(
        panel(page, 'Draw').getByRole('button', { name: 'Line', exact: true }),
      ).not.toHaveText(/Line/);
    }
    await shot(page, `${width}-home`);
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
  await expect(circle).toHaveAttribute('title', 'Circle: 2-Point');
  await circle.click();
  await expect(prompt(page)).toHaveText(/^Specify first end point of circle's diameter/);
  await page.keyboard.press('Escape');
});

test('a double-clicked tab minimizes the ribbon; a tab then pops its panels', async ({ page }) => {
  await open(page, 1600);
  const tabs = ribbon(page).getByRole('tab');
  await expect(tabs).toHaveText(['Home', 'Insert']);
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
