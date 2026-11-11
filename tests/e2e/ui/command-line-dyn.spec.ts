// M2-02 part 2: Dynamic Input fields at the cursor, the Ctrl+K palette, and the view commands
// typed at the command line (ZOOM with its options and transparently inside LINE, PAN real
// time, REGEN, -VIEW), acting on the canvas through the view host.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

interface DevHooks {
  changes(): readonly ChangeSet[];
}

/** The LINE entities the drawing's commands added, as [x1, y1, x2, y2] to 4 places. */
async function linesAdded(page: Page): Promise<number[][]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: DevHooks }).triyaDev.changes(),
  );
  const added: number[][] = [];
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind !== 'LINE') continue;
      const { start, end } = entity.geom;
      added.push([start.x, start.y, end.x, end.y].map((v) => Math.round(v * 1e4) / 1e4));
    }
  }
  return added;
}

const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });
const dyn = (page: Page) => page.getByTestId('dyn');

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
}

/** Moves the mouse over the canvas, at fractions of its size. */
async function hover(page: Page, x = 0.5, y = 0.5): Promise<void> {
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
}

/** Types a command at the command line, ended by Enter. */
async function command(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('Dynamic Input: X,Y then Distance Tab Angle draw the line', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await hover(page);
  await expect(dyn(page)).toHaveCount(0);
  await command(page, 'L');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(dyn(page)).toContainText('Specify first point');
  await page.keyboard.type('0,0');
  await expect(dyn(page).getByLabel('X')).toHaveText('0');
  await expect(dyn(page).getByLabel('Y')).toHaveText('0');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await page.keyboard.type('100');
  await page.keyboard.press('Tab');
  await page.keyboard.type('45');
  await expect(dyn(page).getByLabel('Distance')).toHaveText('100');
  await expect(dyn(page).getByLabel('Distance').getByLabel('locked')).toBeVisible();
  await expect(dyn(page).getByLabel('Angle')).toHaveText('45');
  await page.keyboard.press('Enter');
  await expect(history(page)).toContainText('Specify next point or [Undo]: @100<45');
  // ↓ shows the options; Enter picks the highlighted one (Undo).
  await page.keyboard.press('ArrowDown');
  await expect(dyn(page).getByRole('option', { name: /Undo/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(history(page)).toContainText('Undo');
  // Not a number: taken as typed (an absolute point here).
  await page.keyboard.type('#50,0');
  await expect(dyn(page).getByLabel('Distance')).toHaveText('#50,0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const r = Math.round(Math.SQRT1_2 * 100 * 1e4) / 1e4;
  expect(await linesAdded(page)).toEqual([
    [0, 0, r, r],
    [0, 0, 50, 0],
  ]);
  // F12 turns Dynamic Input off; the status bar shows it.
  await page.keyboard.press('F12');
  await expect(page.getByRole('button', { name: 'DYN' })).toHaveAttribute('aria-pressed', 'false');
  await command(page, 'L');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(dyn(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

/** Each LINE's ends as the drawing's change sets left them, by handle, to 4 places. */
async function lineEnds(page: Page): Promise<Record<string, number[]>> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: DevHooks }).triyaDev.changes(),
  );
  const out: Record<string, number[]> = {};
  const put = ({ handle, geom }: { handle: string; geom: { kind: string } }) => {
    if (geom.kind !== 'LINE') return;
    const { start, end } = geom as unknown as Record<'start' | 'end', { x: number; y: number }>;
    out[handle] = [start.x, start.y, end.x, end.y].map((v) => Math.round(v * 1e4) / 1e4 + 0);
  };
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) put(entity);
    for (const { after } of cs.entities?.updated ?? []) put(after);
  }
  return out;
}

// M2-34: CI once saw ROTATE turn by 179.999° instead of the 90 typed: the keys reached Dynamic
// Input as the angle prompt arrived, and went into the X field still set for the base point, so
// Enter sent `90,<cursor Y>`. Here the keys are typed the moment the prompt shows, before React
// has run anything after showing it, with the cursor moving over the drawing meanwhile.
test('Dynamic Input: an angle typed as its prompt arrives, the cursor moving, is the angle typed', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await open(page);
  await hover(page);
  const before = Object.keys(await lineEnds(page));
  for (const t of ['L', '1000000,1000000', '1000010,1000000', '']) await command(page, t);
  await expect(prompt(page)).toHaveText('Command:');
  // The line just drawn (handles are hex strings, so a record keeps no order of them).
  const drawn = async () => Object.keys(await lineEnds(page)).filter((h) => !before.includes(h));
  await expect.poll(drawn).toHaveLength(1);
  const [handle] = await drawn();
  for (const t of ['RO', 'L', '']) await command(page, t);
  await expect(prompt(page)).toHaveText('Specify base point:');
  // Types 9, 0 and Enter, to whatever has the focus as a real key would, in the same task that
  // shows the rotation angle prompt.
  await page.evaluate(() => {
    const label = document.querySelector('[data-testid="command-prompt"]')!;
    const observer = new MutationObserver(() => {
      if (!label.textContent?.startsWith('Specify rotation angle')) return;
      observer.disconnect();
      for (const key of ['9', '0', 'Enter']) {
        const target = document.activeElement ?? document.body;
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      }
    });
    observer.observe(label, { childList: true, characterData: true, subtree: true });
  });
  await page.keyboard.type('1000005,1000000');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10; i++) await hover(page, 0.3 + i * 0.04, 0.5 + (i % 3) * 0.05);
  await expect(prompt(page)).toHaveText('Command:');
  await expect(history(page)).toContainText(
    /Specify rotation angle or \[Copy\/Reference\] <0[.0]*>: 90(?!,)/,
  );
  await expect
    .poll(async () => (await lineEnds(page))[handle!])
    .toEqual([1000005, 999995, 1000005, 1000005]);
});

test('Ctrl+K finds a command by name or alias and runs it', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('z');
  await expect(palette.getByRole('option').first()).toContainText('ZOOM');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(prompt(page)).toContainText('Specify corner of window');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('history');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Command history' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
});

test('ZOOM, PAN, REGEN and VIEW typed at the command line change the view', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  const coords = page.getByTestId('coords');
  const at = async () => {
    await hover(page, 0.25, 0.25);
    await hover(page, 0.25, 0.26);
    return coords.textContent();
  };
  const start = await at();
  await page.getByLabel('Command', { exact: true }).click();
  await command(page, 'Z');
  await command(page, '2x');
  await expect(prompt(page)).toHaveText('Command:');
  const zoomed = await at();
  expect(zoomed).not.toBe(start);
  // Saved here, then zoomed away and restored.
  await page.getByLabel('Command', { exact: true }).click();
  for (const t of ['-VIEW', 'S', 'Here']) await command(page, t);
  await command(page, 'Z');
  await command(page, 'E');
  expect(await at()).not.toBe(zoomed);
  await page.getByLabel('Command', { exact: true }).click();
  for (const t of ['-V', 'R', 'here']) await command(page, t);
  expect(await at()).toBe(zoomed);
  await page.getByLabel('Command', { exact: true }).click();
  await command(page, 'Z');
  await command(page, 'P');
  expect(await at()).not.toBe(zoomed);
  // ZOOM transparently inside LINE, then LINE carries on.
  await page.getByLabel('Command', { exact: true }).click();
  for (const t of ['LINE', '0,0', "'Z", 'A']) await command(page, t);
  await expect(history(page)).toContainText('Resuming LINE command.');
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await page.keyboard.press('Escape');
  // Real-time PAN until Enter.
  await page.getByLabel('Command', { exact: true }).click();
  await command(page, 'P');
  await expect(activeCanvas(page)).toHaveAttribute('data-mode', 'pan');
  await expect(prompt(page)).toHaveText('Press ESC or ENTER to exit:');
  await page.keyboard.press('Enter');
  await expect(activeCanvas(page)).toHaveAttribute('data-mode', 'none');
  await command(page, 'RE');
  await expect(history(page)).toContainText('Regenerating model.');
});
