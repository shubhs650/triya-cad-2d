// M3-10 part 2: the keyboard map (PRD FR-C5). AutoCAD's default keys work (F3 and Ctrl+F turn
// OSNAP on and off, Ctrl+L ORTHO); the Keyboard Shortcuts dialog (Ctrl+K, Settings) gives a
// command a key, says what had it ("Currently assigned to"), removes keys, and keeps them on the
// device: after a reload Ctrl+L still runs LINE; Reset All brings the defaults back. The map's
// rules are unit-tested in apps/web/test/keymap.test.ts and shortcuts.test.ts.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
const toggle = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
}

/** Presses a key and checks it turned a status bar toggle over. */
async function flips(page: Page, key: string, name: string): Promise<void> {
  const before = await toggle(page, name).getAttribute('aria-pressed');
  await page.keyboard.press(key);
  await expect(toggle(page, name)).toHaveAttribute(
    'aria-pressed',
    before === 'true' ? 'false' : 'true',
  );
}

test("AutoCAD's keys, a command given a key, kept, and reset", async ({ page }) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await open(page);
  // AutoCAD's defaults: F3 and Ctrl+F both turn OSNAP over, Ctrl+L ORTHO, F8 ORTHO.
  await flips(page, 'F3', 'OSNAP');
  await flips(page, 'Control+f', 'OSNAP');
  await flips(page, 'Control+l', 'ORTHO');
  await flips(page, 'F8', 'ORTHO');
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('title', 'Object Snap (F3)');

  // Ctrl+K lists the dialog; it shows every action with keys.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('keyboard shortcuts');
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  const list = dialog(page).getByRole('listbox', { name: 'Shortcut keys' });
  await expect(list.getByRole('option', { name: /Object Snap on\/off F3, Ctrl\+F/ })).toBeVisible();
  await expect(
    list.getByRole('option', { name: /Selection Cycling on\/off Ctrl\+W †/ }),
  ).toBeVisible();
  await shot('1-keyboard-shortcuts.png');

  // A search lists commands too; LINE takes Ctrl+L from ORTHO.
  await dialog(page).getByRole('searchbox').fill('line');
  await list.getByRole('option', { name: /^LINE/ }).click();
  const press = dialog(page).getByRole('textbox', { name: 'Press new shortcut key:' });
  await press.focus();
  await page.keyboard.press('l');
  await expect(dialog(page)).toContainText('Shortcut keys need Ctrl or Alt');
  await expect(dialog(page).getByRole('button', { name: 'Assign' })).toBeDisabled();
  await page.keyboard.press('Control+l');
  await expect(press).toHaveValue('Ctrl+L');
  await expect(dialog(page)).toContainText('Currently assigned to: Ortho Mode on/off');
  await shot('2-press-new-key.png');
  await dialog(page).getByRole('button', { name: 'Assign' }).click();
  await expect(list.getByRole('option', { name: /^LINE Ctrl\+L Command/ })).toBeVisible();
  await dialog(page).getByRole('searchbox').fill('ortho');
  await expect(list.getByRole('option', { name: /^Ortho Mode on\/off F8 Drafting/ })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await expect(dialog(page)).toHaveCount(0);

  // Ctrl+L runs LINE now; F8 still turns ORTHO over.
  await page.keyboard.press('Control+l');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await shot('3-ctrl-l-runs-line.png');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await flips(page, 'F8', 'ORTHO');

  // Settings opens it too; F3 removed from OSNAP leaves Ctrl+F, and the tooltip follows.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Edit shortcut keys…' }).click();
  await list.getByRole('option', { name: /^Object Snap on\/off/ }).click();
  await dialog(page).getByRole('button', { name: 'Remove F3' }).click();
  await expect(
    list.getByRole('option', { name: /^Object Snap on\/off Ctrl\+F Drafting/ }),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  const osnap = await toggle(page, 'OSNAP').getAttribute('aria-pressed');
  await page.keyboard.press('F3');
  await flips(page, 'Control+f', 'OSNAP');
  expect(osnap).not.toBe(await toggle(page, 'OSNAP').getAttribute('aria-pressed'));
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('title', 'Object Snap (Ctrl+F)');

  // Kept on the device: after a reload Ctrl+L still runs LINE, and Ctrl+K shows its key.
  await page.reload();
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Control+l');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.keyboard.type('line');
  await expect(palette.getByRole('option').first()).toContainText('Ctrl+L');

  // Reset All brings AutoCAD's keys back; Esc leaves the dialog unchanged.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('keyboard shortcuts');
  await page.keyboard.press('Enter');
  await dialog(page).getByRole('button', { name: 'Reset All' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press('Control+l');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('keyboard shortcuts');
  await page.keyboard.press('Enter');
  await dialog(page).getByRole('button', { name: 'Reset All' }).click();
  await dialog(page).getByRole('button', { name: 'OK' }).click();
  await flips(page, 'Control+l', 'ORTHO');
  await flips(page, 'F3', 'OSNAP');
});
