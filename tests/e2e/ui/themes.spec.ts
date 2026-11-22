// M7-05: themes. The chrome's light and dark colours and their high contrast versions, chosen in
// Options > Display (Color theme, Contrast) or followed from the device (prefers-color-scheme,
// prefers-contrast: more, forced colours); the canvas colours each takes; the plot preview,
// which is the sheet whatever the theme; and reduced motion, the device's prefers-reduced-motion
// or the user's Motion choice. The theme snapshots (apps/web/test/theme-snapshots/*.txt, pinned
// by theme.test.ts from the stylesheet) are what this spec checks the running app draws.
// TRIYA_SHOTS=<dir> writes a screenshot of each appearance there.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  activeCanvas,
  colourAt,
  expectShown,
  openOptions,
  openWithPicker,
  optionsTab,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

test.describe.configure({ timeout: 90_000 });

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DXF = path.join(CORPUS, 'ezdxf/examples_dxf/hatches_1.dxf');
const SNAPSHOTS = path.join(import.meta.dirname, '../../../apps/web/test/theme-snapshots');

type AppearanceId = 'light' | 'dark' | 'light-high-contrast' | 'dark-high-contrast';

/** An appearance's snapshot: its chrome tokens and default canvas colours. */
function snapshotOf(id: AppearanceId): {
  tokens: Map<string, string>;
  canvas: Map<string, string>;
} {
  const text = readFileSync(path.join(SNAPSHOTS, `${id}.txt`), 'utf8');
  const section = (name: string) => {
    const body = text.split(`## ${name}\n`)[1]!.split('\n## ')[0]!;
    return new Map(
      body
        .split('\n')
        .map((l) => /^([a-z-]+): (#[0-9a-f]{6}|rgb\([^)]*\)|automatic)$/.exec(l))
        .filter((m) => m !== null)
        .map((m) => [m[1]!, m[2]!]),
    );
  };
  return { tokens: section('chrome tokens'), canvas: section('canvas (default colours)') };
}

const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const cssRgb = (hex: string): string => `rgb(${rgbOf(hex).join(', ')})`;

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' });
}

/** Chooses the theme and contrast in Options > Display and closes the dialog. */
async function choose(
  page: Page,
  theme: 'system' | 'light' | 'dark',
  contrast: 'system' | 'standard' | 'high',
): Promise<Locator> {
  const options = await openOptions(page, 'Display');
  await options.getByLabel('Color theme').selectOption(theme);
  await options.getByLabel('Contrast').selectOption(contrast);
  return options;
}

/** The root's tokens as the running app resolves them. */
async function tokensShown(page: Page, names: readonly string[]): Promise<Map<string, string>> {
  const values = await page.evaluate((ns) => {
    const s = getComputedStyle(document.documentElement);
    return ns.map((n) => s.getPropertyValue(n).trim());
  }, names);
  return new Map(names.map((n, i) => [n, values[i]!]));
}

test('each appearance draws its snapshot: chrome tokens, chrome, canvas and plot preview', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const box = (await activeCanvas(page).boundingBox())!;
  const corner = { x: 3, y: box.height - 3 };

  const cases = [
    ['light', 'standard', 'light'],
    ['dark', 'standard', 'dark'],
    ['light', 'high', 'light-high-contrast'],
    ['dark', 'high', 'dark-high-contrast'],
  ] as const;
  for (const [theme, contrast, id] of cases) {
    const options = await choose(page, theme, contrast);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-scheme', theme);
    await expect(html).toHaveAttribute('data-contrast', contrast);
    const { tokens, canvas } = snapshotOf(id);
    expect(tokens.size).toBeGreaterThan(15);
    expect(Object.fromEntries(await tokensShown(page, [...tokens.keys()]))).toEqual(
      Object.fromEntries(tokens),
    );
    // The chrome is drawn in them: the page, the dialog, its text and its focused control.
    await expect(html).toHaveCSS('background-color', cssRgb(tokens.get('--chrome-bg')!));
    await expect(options).toHaveCSS('background-color', cssRgb(tokens.get('--chrome-bg-raised')!));
    await expect(options.getByText('Color theme', { exact: true })).toHaveCSS(
      'color',
      cssRgb(tokens.get('--chrome-text')!),
    );
    if (contrast === 'high') {
      // A 3 px focus ring on whatever the keyboard focuses.
      await options.getByLabel('Contrast').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const focused = options.getByLabel('Contrast');
      await expect(focused).toHaveCSS('outline-width', '3px');
      await expect(focused).toHaveCSS('outline-color', cssRgb(tokens.get('--focus-ring')!));
    }
    await shot(page, `${id}-options`);
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    // Model space on the appearance's default canvas colour: black in high contrast.
    await expect
      .poll(async () => (await colourAt(page, corner)).slice(0, 3))
      .toEqual(rgbOf(canvas.get('model')!));
    await shot(page, id);
  }

  // The plot preview is the sheet as plotted, white in the darkest appearance too.
  await page.getByTitle('Plot preview (PREVIEW)').click();
  const sheet = page.getByTestId('plot-preview-canvas');
  await expect(sheet).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  const paper = await sheet.evaluate((c: HTMLCanvasElement) => {
    const [x, y] = c.dataset['raster']!.split(' ').map(Number);
    return [...c.getContext('2d')!.getImageData(x! + 2, y! + 2, 1, 1).data].slice(0, 3);
  });
  expect(paper).toEqual([255, 255, 255]);
  await expect(page.getByRole('region', { name: /^Plot preview - / })).toBeVisible();
  await shot(page, 'dark-high-contrast-plot-preview');
  await page.keyboard.press('Escape');
});

test('follows the device until the user chooses, and keeps the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none', reducedMotion: 'reduce' });
  await page.goto(app.url);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-scheme', 'dark');
  await expect(html).toHaveAttribute('data-contrast', 'standard');
  await expect(html).toHaveAttribute('data-motion', 'reduced');

  // The device changes: the app follows at once.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-scheme', 'light');
  // Windows' high contrast themes (forced colours) ask for high contrast.
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(html).toHaveAttribute('data-contrast', 'high');
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(html).toHaveAttribute('data-contrast', 'standard');

  // The user's choice wins over the device's, and is kept for the next session.
  const options = await choose(page, 'dark', 'high');
  await expect(html).toHaveAttribute('data-scheme', 'dark');
  await expect(html).toHaveAttribute('data-contrast', 'high');
  await options.getByLabel('Motion').selectOption('standard');
  await expect(html).toHaveAttribute('data-motion', 'standard');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(html).toHaveAttribute('data-scheme', 'dark');
  await expect(html).toHaveAttribute('data-contrast', 'high');
  await expect(html).toHaveAttribute('data-motion', 'standard');
  const again = await openOptions(page, 'Display');
  await expect(again.getByLabel('Color theme')).toHaveValue('dark');
  await expect(again.getByLabel('Contrast')).toHaveValue('high');
  await expect(again.getByLabel('Motion')).toHaveValue('standard');
  await optionsTab(again, 'Display');
  // Back to the device's settings.
  await again.getByLabel('Color theme').selectOption('system');
  await again.getByLabel('Contrast').selectOption('system');
  await again.getByLabel('Motion').selectOption('system');
  await expect(html).toHaveAttribute('data-scheme', 'light');
  await expect(html).toHaveAttribute('data-contrast', 'standard');
  await expect(html).toHaveAttribute('data-motion', 'reduced');
});

test('reduced motion stops the chrome moving: transitions and the palette slide-over', async ({
  page,
}) => {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const html = page.locator('html');
  const item = page.locator('.ribbon-item').first();
  // UI_SPEC.md §6: 120 ms hover and press, the slide-over within 160 ms.
  await expect(html).toHaveAttribute('data-motion', 'standard');
  await expect(item).toHaveCSS('transition-duration', /0\.12s/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(html).toHaveAttribute('data-motion', 'reduced');
  await expect(item).toHaveCSS('transition-duration', /^0s(, 0s)*$/);
  // Below 1366 px the palette stack slides over the drawing: with reduced motion it just shows.
  await page.getByRole('button', { name: 'Properties', exact: true }).last().click();
  const stack = page.locator('.palette-dock[data-mode="slide-over"] .palette-stack');
  await expect(stack).toBeVisible();
  await expect(stack).toHaveCSS('animation-name', 'none');

  // The user's Motion choice reduces it on a device that does not ask.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(html).toHaveAttribute('data-motion', 'standard');
  const options = await openOptions(page, 'Display');
  await options.getByLabel('Motion').selectOption('reduced');
  await expect(html).toHaveAttribute('data-motion', 'reduced');
  await expect(item).toHaveCSS('transition-duration', /^0s(, 0s)*$/);
});
