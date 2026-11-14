// M2-42: a system variable's name typed at `Command:`, as AutoCAD takes it, and SETVAR, from the
// app's command line: a header variable (MIRRTEXT, an undoable edit of the drawing), a drafting
// aid the status bar shows (ORTHOMODE is the ORTHO button), and REVCLOUDGRIPS 0, which gives a
// revision cloud a grip at every arc's end instead of its corners. M2-59 part 3: GRIPSIZE sizes
// the grips drawn and how near a click must be to take one. The prompts and refusals are
// unit-tested in packages/engine/test/commands/setvar.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import {
  DWG,
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
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

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The value the change sets last gave header variable `name`. */
const headerNow = (page: Page, name: string) =>
  page.evaluate((n) => {
    let out: unknown;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const h of cs.header ?? []) if (h.name === n) out = h.after;
    }
    return out;
  }, name);

/** Grip-blue pixels (ACI 150) in a small square of the page around a point. */
async function blue(page: Page, p: { x: number; y: number }, r = 6): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 180 && d[i]! < 80) n++;
    return n;
  }, png.toString('base64'));
}

test('variables typed at Command:, SETVAR, and REVCLOUDGRIPS 0', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // A header variable by its name: MIRRTEXT, from the drawing's 1 to 0, one undo step.
  await type(page, 'MIRRTEXT', 'Enter new value for MIRRTEXT <1>:');
  await type(page, '2', 'Enter new value for MIRRTEXT <1>:');
  await expect(log).toContainText('Value must be between 0 and 1.');
  await type(page, '0', 'Command:');
  await expect.poll(() => headerNow(page, '$MIRRTEXT')).toBe(false);
  await type(page, 'SETVAR', 'Enter variable name or [?]:');
  await type(page, 'mirrtext', 'Enter new value for MIRRTEXT <0>:');
  await type(page, '', 'Command:');
  await type(page, 'U', 'Command:');
  await expect.poll(() => headerNow(page, '$MIRRTEXT')).toBe(true);
  await type(page, 'NOSUCHVARIABLE', 'Command:');
  await expect(log).toContainText('Unknown command "NOSUCHVARIABLE".  Press F1 for help.');

  // A drafting aid: ORTHOMODE is the status bar's ORTHO, and turns POLAR off as F8 does.
  const ortho = page.getByRole('button', { name: 'ORTHO', exact: true });
  const polar = page.getByRole('button', { name: 'POLAR', exact: true });
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'ORTHOMODE', 'Enter new value for ORTHOMODE <0>:');
  await type(page, '1', 'Command:');
  await expect(ortho).toHaveAttribute('aria-pressed', 'true');
  await expect(polar).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('F8');
  await expect(ortho).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'ORTHOMODE', 'Enter new value for ORTHOMODE <0>:');
  await type(page, '', 'Command:');

  // REVCLOUDGRIPS: a 80 × 60 cloud of 5-unit arcs in an empty part of the drawing, zoomed so
  // 160 × 100 units fill the canvas.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const O = 1_000_000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 100}`, 'Command:');
  // Running object snaps would pull the clicks onto the cloud's own points; off.
  await page.keyboard.press('F3');
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'A', /^Specify minimum length of arc/);
  await type(page, '5', /^Specify maximum length of arc/);
  await type(page, '5', /^Specify first corner point or/);
  await type(page, `${O + 20},${O + 20}`, 'Specify opposite corner:');
  await type(page, `${O + 100},${O + 80}`, 'Command:');

  // REVCLOUDGRIPS 1 (AutoCAD's initial value): the corners only.
  const pick = at(100, 80);
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, at(20, 20))).toBeGreaterThan(20);
  expect(await blue(page, at(60, 20))).toBe(0);
  await shot('1-revcloudgrips-1.png');
  await page.keyboard.press('Escape');
  await expect.poll(() => blue(page, at(20, 20))).toBe(0);

  // REVCLOUDGRIPS 0: a grip at every arc's end, as before AutoCAD 2021.
  await type(page, 'REVCLOUDGRIPS', 'Enter new value for REVCLOUDGRIPS <1>:');
  await type(page, '0', 'Command:');
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, at(60, 20))).toBeGreaterThan(20);
  expect(await blue(page, at(20, 20))).toBeGreaterThan(20);
  await shot('2-revcloudgrips-0.png');
  // Dragging an arc's end moves that vertex only.
  const end = at(60, 20);
  await page.mouse.click(end.x, end.y);
  await expect(prompt(page)).toHaveText(/^Specify stretch point/);
  const to = at(60, 12);
  await page.mouse.click(to.x, to.y);
  await expect(prompt(page)).toHaveText('Command:');
  await shot('3-arc-end-dragged.png');
  await page.keyboard.press('Escape');
  // Back to 1, AutoCAD's initial value, which no header entry means (a save never writes it).
  await type(page, 'REVCLOUDGRIPS', 'Enter new value for REVCLOUDGRIPS <0>:');
  await type(page, '1', 'Command:');
  expect(await headerNow(page, 'REVCLOUDGRIPS')).toBe(undefined);
});

// M2-59: the variables AutoCAD works out, read only. DWGNAME and DBMOD come from the app (the
// drawing's tab), CTAB and VIEWSIZE from the space and view shown.
test('the drawing’s computed variables, read only', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });

  await type(page, 'DWGNAME', 'Command:');
  await expect(log).toContainText(`DWGNAME = "${path.basename(DXF)}" (read only)`);
  await type(page, 'DBMOD', 'Command:');
  await expect(log).toContainText('DBMOD = 0 (read only)');
  // An edit leaves changes no save holds.
  await type(page, 'MIRRTEXT', 'Enter new value for MIRRTEXT <1>:');
  await type(page, '0', 'Command:');
  await type(page, 'DBMOD', 'Command:');
  await expect(log).toContainText('DBMOD = 1 (read only)');
  // CTAB names the tab shown (set, it shows another: part 5's test below); Enter keeps it.
  await type(page, 'CTAB', 'Enter new value for CTAB <"Model">:');
  await type(page, '', 'Command:');
  await type(page, 'VIEWSIZE', 'Command:');
  await expect(log).toContainText(/VIEWSIZE = \d+\.\d+ \(read only\)/);
  // Read only: no prompt for a new value.
  await type(page, 'SETVAR', 'Enter variable name or [?]:');
  await type(page, 'DATE', 'Command:');
  await expect(log).toContainText(/DATE = 24\d{5}\.\d{8} \(read only\)/);
  await type(page, 'SETVAR', 'Enter variable name or [?] <DATE>:');
  await type(page, '?', 'Enter variable(s) to list <*>:');
  await type(page, 'CTAB,DBMOD,DWG*,VIEW*', 'Command:');
  await expect(log).toContainText(/VIEWSIZE\s+\d+\.\d+\s+\(read only\)/);
  await page.keyboard.press('F2');
  const history = page.getByRole('dialog', { name: 'Command history' });
  await expect(history).toContainText(`DWGNAME = "${path.basename(DXF)}" (read only)`);
  await page.screenshot({ path: test.info().outputPath('computed-variables.png') });
  await page.keyboard.press('F2');
  await expect(history).toBeHidden();
});

// M2-59 part 5: CTAB and TILEMODE switch the layout tabs (AutoCAD 2024 Help: TILEMODE 1 "Makes
// the Model tab active", 0 "Makes the last active layout tab active"), and the command line's
// autocomplete lists system variables after the commands, as AutoCAD's AUTOCOMPLETEMODE does.
test('CTAB and TILEMODE switch tabs; autocomplete lists variables', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await expect(tab('Model')).toHaveAttribute('aria-selected', 'true');

  // Variables are offered after the commands, marked as variables.
  await page.keyboard.type('TILEM');
  const list = page.getByRole('listbox', { name: 'Matching commands and system variables' });
  await expect(list.getByRole('option')).toHaveText([
    'TILEMODE system variable',
    'TILEMODELIGHTSYNCH system variable',
  ]);
  await page.screenshot({ path: test.info().outputPath('autocomplete-variables.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#command-input')).toHaveValue('');
  await expect(list).toBeHidden();

  await page.keyboard.type('CTAB');
  await expect(list.getByRole('option').first()).toHaveText('CTAB system variable');
  await type(page, '', 'Enter new value for CTAB <"Model">:');
  await type(page, 'nosuch', 'Enter new value for CTAB <"Model">:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await expect(log).toContainText('No layout named "nosuch".');
  await type(page, 'layout1', 'Command:');
  await expect(tab('Layout1')).toHaveAttribute('aria-selected', 'true');
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('ctab-layout1.png') });

  await type(page, 'TILEMODE', 'Enter new value for TILEMODE <0>:');
  await type(page, '1', 'Command:');
  await expect(tab('Model')).toHaveAttribute('aria-selected', 'true');
  // 0: the layout tab shown last.
  await type(page, 'TILEMODE', 'Enter new value for TILEMODE <1>:');
  await type(page, '0', 'Command:');
  await expect(tab('Layout1')).toHaveAttribute('aria-selected', 'true');
  // A tab switch is no edit: nothing to save, nothing to undo.
  await type(page, 'DBMOD', 'Command:');
  await expect(log).toContainText('DBMOD = 0 (read only)');
});

// M2-59 part 2: AutoCAD's per-user settings at the command line. AUTOSNAP's bits are AutoSnap's
// marker, tooltip and magnet and the AutoTrack tooltip (Settings' checkboxes), and POLAR and
// OTRACK (the status bar's buttons); DYNMODE is the DYN button; PICKFIRST 0 ignores picks at
// `Command:`; SCREENSIZE is the canvas's size in pixels.
test('AUTOSNAP, DYNMODE, PICKFIRST and SCREENSIZE', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const status = (name: string) =>
    page.getByRole('contentinfo').getByRole('button', { name, exact: true });
  const tip = page.getByTestId('autosnap-tip');

  // SCREENSIZE: the canvas, in CSS pixels.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await type(page, 'SCREENSIZE', 'Command:');
  await expect(log).toContainText(/SCREENSIZE = \d+\.0000,\d+\.0000 \(read only\)/);
  const [w, h] = (await log.textContent())!
    .match(/SCREENSIZE = (\d+)\.0000,(\d+)\.0000/)!
    .slice(1)
    .map(Number) as [number, number];
  expect(Math.abs(w - box.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(h - box.height)).toBeLessThanOrEqual(1);

  // DYNMODE: −3 while F12 has Dynamic Input off, 3 while on.
  await expect(status('DYN')).toHaveAttribute('aria-pressed', 'true');
  await type(page, 'DYNMODE', 'Enter new value for DYNMODE <3>:');
  await type(page, '0', 'Command:');
  await expect(status('DYN')).toHaveAttribute('aria-pressed', 'false');
  await type(page, 'DYNMODE', 'Enter new value for DYNMODE <-3>:');
  await type(page, '3', 'Command:');
  await expect(status('DYN')).toHaveAttribute('aria-pressed', 'true');

  // AUTOSNAP 39: POLAR and OTRACK off, as their buttons show.
  await type(page, 'AUTOSNAP', 'Enter new value for AUTOSNAP <63>:');
  await type(page, '39', 'Command:');
  await expect(status('POLAR')).toHaveAttribute('aria-pressed', 'false');
  await expect(status('OTRACK')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('F10');
  await type(page, 'AUTOSNAP', 'Enter new value for AUTOSNAP <47>:');
  await type(page, '', 'Command:');

  // A line in an empty part of the drawing; the cursor a few pixels off its end at LINE's first
  // point shows the Endpoint tooltip until AUTOSNAP drops its bit 2.
  const O = 1_000_000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O - 50}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 50}`, 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, `${O},${O}`, 'Specify next point or [Undo]:');
  await type(page, `${O + 100},${O}`, 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  const view = await viewOf(page);
  const near = (dy: number) => {
    const p = view.at(O + 100, O);
    return page.mouse.move(view.box.x + p.x - 4, view.box.y + p.y + dy);
  };
  await type(page, 'L', 'Specify first point:');
  await near(3);
  await expect(tip).toHaveText('Endpoint');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'AUTOSNAP', 'Enter new value for AUTOSNAP <47>:');
  await type(page, String(47 & ~2), 'Command:');
  await type(page, 'L', 'Specify first point:');
  await near(3);
  await near(2);
  await expect(tip).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // PICKFIRST 0: a pick at Command: selects nothing; 1 again: it does.
  const onLine = view.at(O + 50, O);
  await type(page, 'PICKFIRST', 'Enter new value for PICKFIRST <1>:');
  await type(page, '0', 'Command:');
  await page.mouse.click(view.box.x + onLine.x, view.box.y + onLine.y);
  const lineEnd = { x: view.box.x + view.at(O, O).x, y: view.box.y + view.at(O, O).y };
  await page.waitForTimeout(300);
  expect(await blue(page, lineEnd)).toBe(0);
  await type(page, 'PICKFIRST', 'Enter new value for PICKFIRST <0>:');
  await type(page, '1', 'Command:');
  await page.mouse.click(view.box.x + onLine.x, view.box.y + onLine.y);
  await expect.poll(() => blue(page, lineEnd)).toBeGreaterThan(20);
  await page.keyboard.press('Escape');
  await shot('1-setvar-values.png');

  // Settings shows what SETVAR set: AutoSnap tooltip off, the rest of AUTOSNAP's bits on.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByLabel('Display AutoSnap tooltip')).not.toBeChecked();
  await expect(settings.getByLabel('Marker', { exact: true })).toBeChecked();
  await expect(settings.getByLabel('Magnet')).toBeChecked();
  await expect(settings.getByLabel('Display AutoTrack tooltip')).toBeChecked();
  await expect(settings.getByLabel('Noun/verb selection (PICKFIRST)')).toBeChecked();
  await settings.getByLabel('Display AutoSnap tooltip').scrollIntoViewIfNeeded();
  await shot('2-settings-autosnap.png');
  await settings.getByLabel('Display AutoSnap tooltip').check();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await type(page, 'AUTOSNAP', 'Enter new value for AUTOSNAP <47>:');
  await type(page, '', 'Command:');
});

test('GRIPSIZE draws and picks grips at its size, and Settings shows it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  // A line in an empty part of the drawing, zoomed so 160 × 100 units fill the canvas.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const O = 1_000_000;
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${O},${O}`, 'Specify opposite corner:');
  await type(page, `${O + 160},${O + 100}`, 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, `${O + 70},${O + 50}`, /^Specify next point/);
  await type(page, `${O + 90},${O + 50}`, /^Specify next point/);
  await type(page, '', 'Command:');
  // Running object snaps would pull the clicks onto the line's own points; off.
  await page.keyboard.press('F3');
  const pick = at(75, 50);
  const end = at(90, 50);
  // 9 px above the line's end: outside a grip at GRIPSIZE 5 (a 4 px half size, picked within
  // 5 px), inside one at 15 (12 px, picked within 13).
  const nearEnd = { x: end.x, y: end.y - 9 };

  // GRIPSIZE 5, AutoCAD's initial value: small grips, and the click near the end misses.
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, end, 14)).toBeGreaterThan(20);
  expect(await blue(page, end, 14)).toBeLessThan(150);
  await shot('0-gripsize-5.png');
  await page.mouse.click(nearEnd.x, nearEnd.y);
  await page.waitForTimeout(300);
  await expect(prompt(page)).not.toHaveText(/^Specify stretch point/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => blue(page, end, 14)).toBe(0);

  // GRIPSIZE 15: three times the size, and the same click takes the grip.
  await type(page, 'GRIPSIZE', 'Enter new value for GRIPSIZE <5>:');
  await type(page, '256', 'Enter new value for GRIPSIZE <5>:');
  await type(page, '15', 'Command:');
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(() => blue(page, end, 14)).toBeGreaterThan(400);
  await shot('1-gripsize-15.png');
  await page.mouse.click(nearEnd.x, nearEnd.y);
  await expect(prompt(page)).toHaveText(/^Specify stretch point/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // Settings' Grip size is GRIPSIZE: it shows 15, and set there SETVAR reads it back.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const grip = settings.getByLabel('Grip size');
  await expect(grip).toHaveValue('15');
  await grip.scrollIntoViewIfNeeded();
  await shot('2-settings-grip-size.png');
  await grip.fill('8');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await type(page, 'GRIPSIZE', 'Enter new value for GRIPSIZE <8>:');
  await type(page, '', 'Command:');
});

// M2-59 part 4: the drawing's AcDbVariableDictionary variables at the command line. The
// acadsharp sample has MSLTSCALE 1, so its dashed lines on the Model tab are scaled by the
// annotation scale CANNOSCALE names: at 10:1 the ISO dash (15 units, longer than the 3.3-unit
// lines, so they draw solid at 1:1) is a tenth as long and the lines show their dashes.
test('CANNOSCALE, MSLTSCALE and CMLEADERSTYLE set at Command:', async ({ page }) => {
  test.setTimeout(120_000);
  const file = path.join(path.dirname(DWG), 'sample_AC1018_ascii.dxf');
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const canvas = activeCanvas(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // The sample's linetype lines: x 3.6 to 6.9, y -14.6 to 6.2.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '2,-16', 'Specify opposite corner:');
  await type(page, '8.5,8', 'Command:');
  await expectDrawn(page);
  const before = await canvas.screenshot();
  await shot('0-cannoscale-1-1.png');

  await type(page, 'CANNOSCALE', 'Enter new value for CANNOSCALE <"1:1">:');
  await type(page, '1:3', 'Enter new value for CANNOSCALE <"1:1">:');
  await expect(log).toContainText('No annotation scale named "1:3".');
  await type(page, '10:1', 'Command:');
  expect(await headerNow(page, 'CANNOSCALE')).toBe('10:1');
  expect(await headerNow(page, 'CANNOSCALEVALUE')).toBe(10);
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await expectDrawn(page);
  const scaled = await canvas.screenshot();
  await shot('1-cannoscale-10-1.png');

  // MSLTSCALE 0: the annotation scale no longer scales the dashes.
  await type(page, 'MSLTSCALE', 'Enter new value for MSLTSCALE <1>:');
  await type(page, '0', 'Command:');
  expect(await headerNow(page, 'MSLTSCALE')).toBe('0');
  await expect.poll(async () => (await canvas.screenshot()).equals(scaled)).toBe(false);
  await shot('2-msltscale-0.png');

  await type(page, 'CMLEADERSTYLE', 'Enter new value for CMLEADERSTYLE <"STANDARD">:');
  await type(page, 'nowhere', 'Enter new value for CMLEADERSTYLE <"STANDARD">:');
  await expect(log).toContainText('No multileader style named "nowhere".');
  await type(page, 'annotative', 'Command:');
  // Spelled as the style is.
  expect(await headerNow(page, 'CMLEADERSTYLE')).toBe('Annotative');
});
