// M7-07 (UI_SPEC.md §10, PRD FR-Z2): the start screen. Smoke: Start (New drawing, Templates...,
// Open drawing..., Open PDF...), Learn (Coming from AutoCAD, Keyboard shortcuts..., the project's
// pages), Samples from the public corpus, the privacy statement and the version. A sample opens as
// a drawing. Open PDF opens the PDF in a new drawing, its first page attached at its printed size
// (the Triya ISO template: millimetres, so 25.4 units a page inch), and offers to calibrate its
// scale: Calibrate scale runs SCALE Reference on the underlay about the origin up to the two
// picks, which the drafter gives, then the true distance. The PDF underlay test drawing's page has
// a black 1 in grid; corners (1, 1) and (3, 1) in are 50.8 mm apart, which the drafter says is 50.
// TRIYA_SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityGeometry } from '@triya/engine';
import { expectDrawn, expectShown } from '../app/page';
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

const start = (page: Page) => page.getByTestId('start');
const prompt = (page: Page) => page.getByTestId('command-prompt');

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  // The pointer parked over the drawing area, away from the navigation bar's menus.
  await page.mouse.move(640, 600);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

type Underlay = Extract<EntityGeometry, { kind: 'PDFUNDERLAY' }>;

/** Every PDFUNDERLAY added or replaced so far, as it was made. */
async function underlays(page: Page): Promise<Underlay[]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );
  const out: Underlay[] = [];
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? [])
      if (entity.geom.kind === 'PDFUNDERLAY') out.push(entity.geom);
    for (const { after } of cs.entities?.updated ?? [])
      if (after.geom.kind === 'PDFUNDERLAY') out.push(after.geom);
  }
  return out;
}

test.describe('start screen', () => {
  test.describe.configure({ timeout: 120_000 });

  test('offers new, open, Open PDF, samples, the guide and the links (smoke)', async ({ page }) => {
    await page.goto(app.url);
    const s = start(page);
    const startNav = s.getByRole('navigation', { name: 'Start' });
    for (const name of ['New drawing', 'Templates…', 'Open drawing…', 'Open PDF…'])
      await expect(startNav.getByRole('button', { name })).toBeVisible();
    for (const name of ['Coming from AutoCAD', 'Keyboard shortcuts…'])
      await expect(startNav.getByRole('button', { name })).toBeVisible();
    for (const name of ['Command reference', 'Source code and issues', 'Open Engineering Tools']) {
      const link = startNav.getByRole('link', { name });
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toHaveAttribute('target', '_blank');
    }
    const samples = s.getByRole('region', { name: 'Samples' });
    await expect(samples.getByRole('button')).toHaveCount(6);
    // Every sample's picture loaded.
    await expect
      .poll(() =>
        samples
          .locator('img')
          .evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    await expect(s.getByText('Drawings never leave this device', { exact: false })).toBeVisible();
    await expect(s.getByText(/v\d+\.\d+\.\d+ beta/)).toBeVisible();
    await shot(page, '1-start-screen');

    // The guide: a dialog, keyboard-closed.
    await startNav.getByRole('button', { name: 'Coming from AutoCAD' }).click();
    const guide = page.getByRole('dialog', { name: 'Coming from AutoCAD' });
    await expect(guide).toBeVisible();
    for (const name of [
      'What works as in AutoCAD',
      'Files',
      'What is different',
      'Red-lining a PDF',
    ])
      await expect(guide.getByRole('region', { name })).toBeVisible();
    // The guide's text takes the focus, so the arrow keys scroll it; Tab reaches Close.
    await expect(guide.getByLabel('Guide')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(guide.getByRole('button', { name: 'Close' })).toBeFocused();
    await shot(page, '2-coming-from-autocad');
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);

    await startNav.getByRole('button', { name: 'Keyboard shortcuts…' }).click();
    const keys = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    await expect(keys).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(keys).toHaveCount(0);
  });

  test('a sample opens as a drawing', async ({ page }) => {
    await page.goto(app.url);
    await start(page).getByRole('button', { name: 'Hatches' }).click();
    await expectShown(page, 'hatches_2.dxf');
    await expect(start(page)).toHaveCount(0);
    await expectDrawn(page, { timeout: 15_000 });
    await shot(page, '3-sample-opened');
  });

  test('Open PDF opens it in a new drawing and calibrates its scale with two picks', async ({
    page,
  }) => {
    await page.goto(app.url);
    const chooser = page.waitForEvent('filechooser');
    await start(page).getByRole('button', { name: 'Open PDF…' }).click();
    await (await chooser).setFiles(PDF);
    await expectShown(page, 'pdf-underlay.dxf');

    const card = page.getByRole('region', { name: 'Red-line PDF' });
    await expect(card).toContainText('pdf-underlay.pdf is attached at its printed size');
    await expect(prompt(page)).toHaveText('Command:');
    const [attached] = await underlays(page);
    expect(attached).toBeDefined();
    expect(attached!.position.x).toBeCloseTo(0, 9);
    expect(attached!.position.y).toBeCloseTo(0, 9);
    // Millimetres: a page inch is 25.4 units.
    expect(attached!.scale.x).toBeCloseTo(25.4, 9);
    // The page is drawn (pdf.js) before the picture is taken.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { triyaDev: { pdfRenders(): number } }).triyaDev.pdfRenders(),
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1500);
    await shot(page, '4-pdf-opened-calibrate-offer');

    await card.getByRole('button', { name: 'Calibrate scale' }).click();
    await expect(prompt(page)).toHaveText('Specify reference length <1.0000>:');
    await expect(card).toContainText('Pick two points a known distance apart');
    await shot(page, '5-calibrating');
    // The grid corners (1, 1) and (3, 1) in, typed here as the picks would give them.
    await type(page, '25.4,25.4', 'Specify second point:');
    await type(page, '76.2,25.4', 'Specify new length or [Points] <1.0000>:');
    await type(page, '50', 'Command:');
    await expect(card).toHaveCount(0);

    const after = (await underlays(page)).at(-1)!;
    // 50 / 50.8 of 25.4 units an inch: 25, about the corner at the origin.
    expect(after.scale.x).toBeCloseTo(25, 9);
    expect(after.scale.y).toBeCloseTo(25, 9);
    expect(after.position.x).toBeCloseTo(0, 9);
    expect(after.position.y).toBeCloseTo(0, 9);
    await type(page, 'Z', /^Specify corner of window/);
    await type(page, 'E', 'Command:');
    await page.waitForTimeout(1500);
    await shot(page, '6-calibrated');
  });

  test('Not now withdraws the offer, and a file that is not a PDF is refused', async ({ page }) => {
    await page.goto(app.url);
    let chooser = page.waitForEvent('filechooser');
    await start(page).getByRole('button', { name: 'Open PDF…' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    });
    await expect(page.getByRole('alert')).toContainText(
      'notes.pdf is not a PDF file Triya can open.',
    );
    await expect(start(page)).toBeVisible();

    chooser = page.waitForEvent('filechooser');
    await start(page).getByRole('button', { name: 'Open PDF…' }).click();
    await (await chooser).setFiles(PDF);
    await expectShown(page, 'pdf-underlay.dxf');
    const card = page.getByRole('region', { name: 'Red-line PDF' });
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);
  });
});
