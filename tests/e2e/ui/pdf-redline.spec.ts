// M8-04 (PRD FR-Z2, UI_SPEC.md §10): the PDF red-line flow end to end. Open PDF on the start
// screen opens the PDF in a new drawing with its first page attached at its printed size; the
// card calibrates its scale with two picks (SCALE Reference); then the markup: the drawing's
// current layer is REDLINE (red), the card's Revision Cloud and Leader draw over the page, and
// its Plot... plots the page with the markup to a PDF that downloads. The plot is read back with
// pdf.js in Node: the underlay's page is a form holding its text, and the markup strokes red
// outside it. The PDF underlay test drawing's page has a black 1 in grid; corners (1, 1) and
// (3, 1) in are 50.8 mm apart, which the drafter says is 50. TRIYA_SHOTS=<dir> saves the PR's
// screenshots.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, LayerRecord } from '@triya/engine';
import { pdfStrokeColors, pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { expectInputsRead, expectNoModalDialog, expectShown } from '../app/page';
import { startApp } from '../app/server';

const PDF = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/underlay/pdf-underlay.pdf',
);
const SHOTS = process.env['TRIYA_SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.mouse.move(640, 600);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const changes = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );

/** The layers the drawing made or changed, as they are now, by name. */
async function layers(page: Page): Promise<Map<string, LayerRecord>> {
  const out = new Map<string, LayerRecord>();
  for (const cs of await changes(page)) {
    for (const l of cs.tables?.layers?.added ?? []) out.set(l.name, l);
    for (const { after } of cs.tables?.layers?.updated ?? []) out.set(after.name, after);
  }
  return out;
}

/** The entities added since the drawing opened. */
async function added(page: Page): Promise<Entity[]> {
  return (await changes(page)).flatMap((cs) => (cs.entities?.added ?? []).map((a) => a.entity));
}

test('open a PDF, calibrate it, mark it up on REDLINE and plot it with the page', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('start').getByRole('button', { name: 'Open PDF…' }).click();
  await (await chooser).setFiles(PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  const card = page.getByRole('region', { name: 'Red-line PDF' });
  await expect(card).toContainText('pdf-underlay.pdf is attached at its printed size');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { triyaDev: { pdfRenders(): number } }).triyaDev.pdfRenders(),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(1);

  // Two picks a known distance apart, typed as the picks would give them, then the true length.
  await card.getByRole('button', { name: 'Calibrate scale' }).click();
  await expect(prompt(page)).toHaveText('Specify reference length <1.0000>:');
  await type(page, '25.4,25.4', 'Specify second point:');
  await type(page, '76.2,25.4', 'Specify new length or [Points] <1.0000>:');
  await type(page, '50', 'Command:');

  // The markup: REDLINE (red) is current, and the card's buttons wait for it.
  await expect(card).toContainText('Mark up pdf-underlay.pdf');
  const cloud = card.getByRole('button', { name: 'Revision Cloud' });
  await expect(cloud).toBeEnabled();
  await expectInputsRead(page);
  const redline = (await layers(page)).get('REDLINE');
  expect(redline?.color).toEqual({ kind: 'aci', index: 1 });
  await expect(prompt(page)).toHaveText('Command:');
  await page.waitForTimeout(1500);
  await shot(page, '1-calibrated-markup-card');

  // A cloud round an empty part of the page (6.8 to 8.8 in up, at 25 units an inch now).
  await cloud.click();
  await expect(prompt(page)).toHaveText(/^Specify first corner point or/);
  await type(page, '30,170', 'Specify opposite corner:');
  await type(page, '150,220', 'Command:');
  // A leader pointing into it.
  await card.getByRole('button', { name: 'Leader' }).click();
  await expect(prompt(page)).toHaveText(/^Specify leader arrowhead location or/);
  await type(page, '90,195', 'Specify leader landing location:');
  await type(page, '170,240', 'Enter text:');
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
  await page.keyboard.type('CHECK SIZE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expectInputsRead(page);

  const markup = (await added(page)).filter((e) => e.geom.kind !== 'PDFUNDERLAY');
  expect(markup.map((e) => e.geom.kind).sort()).toEqual(['LWPOLYLINE', 'MULTILEADER']);
  for (const e of markup) {
    expect(e.layer).toBe(redline!.handle);
    expect(e.color).toEqual({ kind: 'byLayer' });
  }
  await page.waitForTimeout(1000);
  await shot(page, '2-marked-up');

  // Plot...: the Plot dialog on model space; OK plots the page with the markup.
  await card.getByRole('button', { name: 'Plot...' }).click();
  const dialog = page.getByRole('dialog', { name: /^Plot - / });
  await expect(dialog.getByRole('heading')).toHaveText('Plot - Model');
  await dialog.getByLabel('What to plot').selectOption('extents');
  await shot(page, '3-plot-dialog');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'OK' }).click(),
  ]);
  await expectNoModalDialog(page);
  expect(download.suggestedFilename()).toBe('pdf-underlay-Model.pdf');
  const bytes = new Uint8Array(readFileSync((await download.path())!));
  const pdf = await pdfSummary(bytes);
  // The underlay's page is a form, its Helvetica text still text.
  expect(pdf.forms).toBe(1);
  expect(pdf.text).toContain('TRIYA');
  // The cloud's arcs, the leader and its stroked text, red over the page.
  expect(await pdfStrokeColors(bytes)).toContain('#ff0000');

  // Done: the card goes, the markup stays.
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).toHaveCount(0);
});
