// M3-06 part 1: the Drafting Settings dialog (DSETTINGS, DS, SE; OSNAP opens it on Object Snap),
// as a drafter uses it (AutoCAD 2024 Help, "Drafting Settings Dialog Box"). Part 2: the Snap and
// Grid tab sets SNAP, GRID and the drawing's snap and grid spacing, which the cursor and grid
// follow, as do the SNAP and GRID commands. The Polar Tracking
// tab adds an additional angle polar tracking then locks onto, and sets POLARMODE and
// POLARADDANG; the Object Snap tab chooses the modes and turns OSNAP off; the Quick Properties tab
// sets QPMODE, QPLOCATION, the quadrant, the distance and the row count, and Quick Properties
// follows them. Cancel (Esc) leaves everything as it was. The dialog's model is unit-tested in
// apps/web/test/drafting-settings.test.ts. Part 3: PolarSnap, polar angles relative to the last
// segment and Settings' Shift to acquire.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const tip = (page: Page) => page.getByTestId('autosnap-tip');
const toggle = (page: Page, name: string) =>
  page.getByRole('contentinfo').getByRole('button', { name, exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Drafting Settings' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const X0 = 1_000_000;
const Y0 = 1_000_000;

test('sets polar tracking, object snaps and Quick Properties', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan with one line across it.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0},${Y0 - 50}`, 'Specify opposite corner:');
  await type(page, `${X0 + 160},${Y0 + 50}`, 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, `${X0 + 70},${Y0}`, 'Specify next point or [Undo]:');
  await type(page, `${X0 + 90},${Y0}`, 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');

  // DSETTINGS opens on Snap and Grid (the first tab, M3-06 part 2); Polar Tracking shows the
  // status bar's settings.
  await type(page, 'DS', 'Drafting Settings:');
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByRole('tab', { name: 'Snap and Grid' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await d.getByRole('tab', { name: 'Polar Tracking' }).click();
  await expect(d.getByRole('tab', { name: 'Polar Tracking' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(d.getByRole('checkbox', { name: 'Polar Tracking On (F10)' })).toBeChecked();
  await expect(d.getByRole('combobox', { name: 'Increment angle:' })).toHaveValue('90');
  await expect(d.getByRole('radio', { name: 'Track orthogonally only' })).toBeChecked();
  const add = d.getByRole('button', { name: 'New' });
  await expect(add).toBeDisabled();
  await d.getByRole('checkbox', { name: 'Additional angles' }).check();
  await add.click();
  await d.getByRole('textbox', { name: 'New additional angle' }).fill('12.5');
  // Enter takes the angle and leaves the dialog open.
  await page.keyboard.press('Enter');
  const angles = d.getByRole('listbox', { name: 'Additional angles' });
  await expect(angles.getByRole('option')).toHaveText(['12.5']);
  await expect(d).toBeVisible();
  // A second angle, then Delete takes it out again.
  await add.click();
  await d.getByRole('textbox', { name: 'New additional angle' }).fill('80');
  await page.keyboard.press('Enter');
  await expect(angles.getByRole('option')).toHaveText(['12.5', '80']);
  await angles.getByRole('option', { name: '80' }).click();
  await d.getByRole('button', { name: 'Delete' }).click();
  await expect(angles.getByRole('option')).toHaveText(['12.5']);
  await d.getByRole('radio', { name: 'Track using all polar angle settings' }).check();
  await shot(page, '1-polar-tracking-tab');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  // SETVAR reads what the dialog set: POLARMODE 2 + 4, POLARADDANG the angle.
  await canvas.hover();
  await type(page, 'POLARMODE', 'Enter new value for POLARMODE <6>:');
  await type(page, '', 'Command:');
  await type(page, 'POLARADDANG', 'Enter new value for POLARADDANG <"12.5">:');
  await type(page, '', 'Command:');

  // Polar tracking now locks onto 12.5° from a line's first point.
  const view = await viewOf(page);
  const move = (x: number, y: number) => {
    const p = view.at(x, y);
    return page.mouse.move(view.box.x + p.x, view.box.y + p.y);
  };
  const rad = (12.4 * Math.PI) / 180;
  await type(page, 'L', 'Specify first point:');
  await type(page, `${X0 + 10},${Y0 - 30}`, 'Specify next point or [Undo]:');
  await move(X0 + 10 + 40 * Math.cos(rad), Y0 - 30 + 40 * Math.sin(rad));
  await expect(tip(page)).toHaveText(/^Polar: \d+\.\d{4} < 12\.50°$/);
  await shot(page, '2-additional-angle-tracked');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // OSNAP opens on Object Snap: Clear All, Midpoint only, and Object Snap off.
  await type(page, 'OSNAP', 'Drafting Settings:');
  await expect(d.getByRole('tab', { name: 'Object Snap' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(d.getByRole('checkbox', { name: 'Endpoint' })).toBeChecked();
  await d.getByRole('button', { name: 'Clear All' }).click();
  await expect(d.getByRole('checkbox', { name: 'Endpoint' })).not.toBeChecked();
  await d.getByRole('checkbox', { name: 'Midpoint' }).check();
  await d.getByRole('checkbox', { name: 'Object Snap On (F3)' }).uncheck();
  await shot(page, '3-object-snap-tab');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'false');
  // F3 turns back on the modes the dialog chose.
  await canvas.hover();
  await page.keyboard.press('F3');
  await expect(toggle(page, 'OSNAP')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Object snap modes' }).click();
  const menu = page.getByRole('menu', { name: 'Object snap modes' });
  await expect(menu.getByRole('menuitemcheckbox', { checked: true })).toHaveText(['✓Midpoint']);
  await page.keyboard.press('Escape');

  // Esc cancels: nothing changes. DSETTINGS opens on the tab shown last.
  await canvas.hover();
  await type(page, 'SE', 'Drafting Settings:');
  await expect(d.getByRole('tab', { name: 'Object Snap' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await d.getByRole('button', { name: 'Select All' }).click();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await page.getByRole('button', { name: 'Object snap modes' }).click();
  await expect(menu.getByRole('menuitemcheckbox', { checked: true })).toHaveText(['✓Midpoint']);
  await page.keyboard.press('Escape');

  // Quick Properties: on, by the cursor at bottom left, 20 pixels away, collapsed to 2 rows.
  await canvas.hover();
  await type(page, 'DSETTINGS', 'Drafting Settings:');
  await d.getByRole('tab', { name: 'Quick Properties' }).click();
  const qpOn = d.getByRole('checkbox', {
    name: 'Display the Quick Properties palette on selection (Ctrl+Shift+P)',
  });
  await expect(qpOn).not.toBeChecked();
  await qpOn.check();
  await d.getByRole('radio', { name: 'Only objects with specified properties' }).check();
  await d.getByRole('combobox', { name: 'Quadrant' }).selectOption({ label: 'Bottom-left' });
  const distance = d.getByRole('textbox', { name: 'Distance in pixels' });
  await distance.fill('500');
  await expect(d.getByRole('alert')).toHaveText(
    'Distance in pixels must be a whole number from 0 to 400.',
  );
  await expect(d.getByRole('button', { name: 'OK' })).toBeDisabled();
  await distance.fill('20');
  await d.getByRole('textbox', { name: 'Minimum number of rows' }).fill('2');
  await shot(page, '4-quick-properties-tab');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(toggle(page, 'QP')).toHaveAttribute('aria-pressed', 'true');

  await canvas.hover();
  await type(page, 'QPMODE', 'Enter new value for QPMODE <2>:');
  await type(page, '', 'Command:');
  const at = view.at(X0 + 80, Y0);
  const pick = { x: view.box.x + at.x, y: view.box.y + at.y };
  await page.mouse.click(pick.x, pick.y);
  const quick = page.getByRole('dialog', { name: 'Quick Properties' });
  await expect(quick).toBeVisible();
  const placed = (await quick.boundingBox())!;
  // Below and to the left of the pick, 20 pixels away.
  expect(Math.round(placed.x + placed.width)).toBeLessThanOrEqual(Math.round(pick.x - 19));
  expect(Math.round(placed.y)).toBeGreaterThanOrEqual(Math.round(pick.y + 19));
  await page.mouse.move(pick.x, pick.y - 40);
  const rows = quick.getByRole('row');
  await expect(rows.filter({ visible: true })).toHaveCount(2);
  await shot(page, '5-quick-properties-bottom-left');
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();

  // Static, and no collapse: QPLOCATION 1, and every row shown.
  await type(page, 'DS', 'Drafting Settings:');
  await expect(d.getByRole('tab', { name: 'Quick Properties' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await d.getByRole('radio', { name: 'Static' }).check();
  await expect(d.getByRole('combobox', { name: 'Quadrant' })).toBeDisabled();
  await d.getByRole('checkbox', { name: 'Collapse palette automatically' }).uncheck();
  await d.getByRole('button', { name: 'OK' }).click();
  await canvas.hover();
  await type(page, 'QPLOCATION', 'Enter new value for QPLOCATION <1>:');
  await type(page, '', 'Command:');
  await page.mouse.click(pick.x, pick.y);
  await expect(quick).toBeVisible();
  await page.mouse.move(pick.x, pick.y - 40);
  await expect(rows.filter({ visible: true })).toHaveCount(5);
});

const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

test('sets the snap and grid spacing, from the Snap and Grid tab and from SNAP and GRID', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0 - 10},${Y0 - 30}`, 'Specify opposite corner:');
  await type(page, `${X0 + 70},${Y0 + 30}`, 'Command:');
  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(x, y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  /** ID's answer for a click near (x, y): where the cursor's constraints put the point. */
  const idAt = async (x: number, y: number) => {
    await type(page, 'ID', 'Specify point:');
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await expect(prompt(page)).toHaveText('Command:');
  };
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'false');
  await shot(page, '6-before-snap-and-grid');

  // The tab opens on the drawing's *Active VPORT: 0.5 snap and grid, as ezdxf wrote them.
  await type(page, 'DS', 'Drafting Settings:');
  const d = dialog(page);
  await expect(d.getByRole('tab', { name: 'Snap and Grid' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const field = (name: string) => d.getByRole('textbox', { name, exact: true });
  await expect(field('Snap X spacing:')).toHaveValue('0.5');
  await expect(field('Grid Y spacing:')).toHaveValue('0.5');
  await expect(field('Major line every:')).toHaveValue('5');
  const equal = d.getByRole('checkbox', { name: 'Equal X and Y spacing' });
  await expect(equal).toBeChecked();
  // Equal X and Y spacing: Y follows X.
  await field('Snap X spacing:').fill('2.5');
  await expect(field('Snap Y spacing:')).toHaveValue('2.5');
  await field('Grid X spacing:').fill('0');
  await field('Major line every:').fill('0');
  await expect(d.getByRole('alert')).toHaveText(
    'Major line every must be a whole number from 1 to 100.',
  );
  await expect(d.getByRole('button', { name: 'OK' })).toBeDisabled();
  await field('Major line every:').fill('4');
  await d.getByRole('checkbox', { name: 'Snap On (F9)' }).check();
  await d.getByRole('checkbox', { name: 'Grid On (F7)' }).check();
  await shot(page, '7-snap-and-grid-tab');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d).toBeHidden();
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'true');

  // The cursor snaps 2.5 apart now (the drawing's 0.5 would have given 12.5 and 0.5 too, so
  // a point between tells them apart).
  await canvas.hover();
  await idAt(X0 + 13.6, Y0 + 1.1);
  await expect(history(page)).toContainText('X = 1000012.5000     Y = 1000000.0000');
  await canvas.hover();
  await shot(page, '8-grid-follows-snap');

  // SNAP and GRID at the command line: a spacing, and 2x the snap spacing for the grid.
  await type(page, 'SN', 'Specify snap spacing or [ON/OFF/Aspect/Type] <2.5000>:');
  await type(page, '4', 'Command:');
  await type(page, 'GRID', 'Specify grid spacing(X) or [ON/OFF/Snap/Major/Aspect] <0.0000>:');
  await type(page, '2x', 'Command:');
  await idAt(X0 + 9.1, Y0 - 2.1);
  await expect(history(page)).toContainText('X = 1000008.0000     Y = 999996.0000');
  await canvas.hover();
  await shot(page, '9-snap-and-grid-commands');
  await type(page, 'DS', 'Drafting Settings:');
  await expect(field('Snap X spacing:')).toHaveValue('4');
  await expect(field('Grid X spacing:')).toHaveValue('8');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();

  // SNAP OFF is F9's toggle; U takes back GRID's spacing, then SNAP's.
  await canvas.hover();
  await type(page, 'SNAP', /^Specify snap spacing/);
  await type(page, 'OFF', 'Command:');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'DS', 'Drafting Settings:');
  await expect(field('Snap X spacing:')).toHaveValue('2.5');
  await expect(field('Grid X spacing:')).toHaveValue('0');
  await page.keyboard.press('Escape');
});

/** The LINE entities the drawing's commands added, as [x1, y1, x2, y2] to 4 places. */
async function linesAdded(page: Page): Promise<number[][]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );
  const out: number[][] = [];
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind !== 'LINE') continue;
      const { start, end } = entity.geom;
      out.push([start.x, start.y, end.x, end.y].map((v) => Math.round(v * 1e4) / 1e4));
    }
  }
  return out;
}

// M3-06 part 3: PolarSnap (Snap type, Polar distance; SNAPTYPE, POLARDIST), polar angles relative
// to the last segment (POLARMODE 1), and Shift to acquire (Settings, POLARMODE 8).
test('snaps along polar paths by the polar distance, relative to the last segment', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0 - 10},${Y0 - 40}`, 'Specify opposite corner:');
  await type(page, `${X0 + 70},${Y0 + 40}`, 'Command:');
  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(x, y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };

  // Snap and Grid: Polar distance waits for PolarSnap, which then disables the snap spacing.
  await type(page, 'DS', 'Drafting Settings:');
  const d = dialog(page);
  await d.getByRole('tab', { name: 'Snap and Grid' }).click();
  const field = (name: string) => d.getByRole('textbox', { name, exact: true });
  await expect(d.getByRole('radio', { name: 'Grid snap' })).toBeChecked();
  await expect(field('Polar distance:')).toBeDisabled();
  await d.getByRole('radio', { name: 'PolarSnap' }).check();
  await expect(field('Polar distance:')).toBeEnabled();
  await expect(field('Snap X spacing:')).toBeDisabled();
  await field('Polar distance:').fill('-5');
  await expect(d.getByRole('alert')).toHaveText('Polar distance must be a number, 0 or more.');
  await field('Polar distance:').fill('5');
  await d.getByRole('checkbox', { name: 'Snap On (F9)' }).check();
  await shot(page, '10-polar-snap');
  await d.getByRole('tab', { name: 'Polar Tracking' }).click();
  await expect(d.getByRole('radio', { name: 'Absolute' })).toBeChecked();
  await d.getByRole('radio', { name: 'Relative to last segment' }).check();
  await shot(page, '11-relative-to-last-segment');
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d).toBeHidden();
  await canvas.hover();
  await type(page, 'SNAPTYPE', 'Enter new value for SNAPTYPE <1>:');
  await type(page, '', 'Command:');
  await type(page, 'POLARDIST', 'Enter new value for POLARDIST <5.0000>:');
  await type(page, '', 'Command:');
  await type(page, 'POLARMODE', 'Enter new value for POLARMODE <1>:');
  await type(page, '', 'Command:');

  // LINE: the cursor 13.6 along 0° goes to 15, the nearest multiple of 5.
  await type(page, 'L', 'Specify first point:');
  await type(page, `${X0},${Y0}`, 'Specify next point or [Undo]:');
  let p = at(X0 + 13.6, Y0 + 0.3);
  await page.mouse.move(p.x, p.y);
  await expect(tip(page)).toHaveText('Polar: 15.0000 < 0°');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await linesAdded(page)).length).toBe(1);
  // Typed points are never constrained: a segment at 30°.
  await type(page, '@20<30', 'Specify next point or [Close/Undo]:');
  await expect.poll(async () => (await linesAdded(page)).length).toBe(2);
  // From its end, 90° from it is 120°; 9.2 along goes to 10.
  const from = { x: X0 + 15 + 20 * Math.cos(Math.PI / 6), y: Y0 + 10 };
  const a = (2 * Math.PI) / 3;
  p = at(from.x + 9.2 * Math.cos(a) + 0.2, from.y + 9.2 * Math.sin(a) + 0.1);
  await page.mouse.move(p.x, p.y);
  await expect(tip(page)).toHaveText('Relative Polar: 10.0000 < 90°');
  await shot(page, '12-relative-polar-snapped');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await linesAdded(page)).length).toBe(3);
  await type(page, '', 'Command:');
  const lines = await linesAdded(page);
  expect(lines[0]).toEqual([X0, Y0, X0 + 15, Y0]);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  expect(lines[2]).toEqual([
    r4(from.x),
    r4(from.y),
    r4(from.x + 10 * Math.cos(a)),
    r4(from.y + 10 * Math.sin(a)),
  ]);

  // SNAP Type back to grid snap: the cursor rounds to the drawing's 0.5 again.
  await type(page, 'SNAP', 'Specify snap spacing or [ON/OFF/Aspect/Type] <0.5000>:');
  await type(page, 'T', 'Enter snap type [Polar/Grid] <Polar>:');
  await type(page, 'G', 'Command:');
  await type(page, 'SNAPTYPE', 'Enter new value for SNAPTYPE <0>:');
  await type(page, '', 'Command:');

  // Shift to acquire (Settings): a pause no longer acquires the endpoint; Shift over it does.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('radio', { name: 'Automatic' })).toBeChecked();
  await settings.getByRole('radio', { name: 'Shift to acquire' }).check();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await canvas.hover();
  await type(page, 'POLARMODE', 'Enter new value for POLARMODE <9>:');
  await type(page, '', 'Command:');
  await page.keyboard.press('F9');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'L', 'Specify first point:');
  p = at(X0 + 15, Y0 - 0.2);
  await page.mouse.move(p.x, p.y);
  await expect(tip(page)).toHaveText('Endpoint');
  await page.waitForTimeout(800);
  const below = at(X0 + 15.1, Y0 - 20);
  await page.mouse.move(below.x, below.y);
  await expect(tip(page)).toBeHidden();
  await page.mouse.move(p.x, p.y);
  await expect(tip(page)).toHaveText('Endpoint');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await page.mouse.move(below.x, below.y);
  await expect(tip(page)).toHaveText('Endpoint: 20.0000 < 270°');
  await shot(page, '13-shift-acquired');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});
