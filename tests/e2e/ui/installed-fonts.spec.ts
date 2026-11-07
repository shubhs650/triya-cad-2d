// M1-38 part 2: fonts installed on this computer, through the Local Font Access API. The
// browser's API is stood in for here, as CI machines have neither Arial nor a user to answer
// the prompt: `queryLocalFonts` offers one installed "Arial" (the test font), and the
// `local-fonts` permission reads as the stand-in last left it, so a reload sees a grant.
//
// hatch_text_box_in_hole.dxf's Standard style names arial.ttf: with the installed Arial its
// MTEXT fills (the test font's .notdef boxes, far more ink than the stroked stand-in, see
// user-fonts.spec.ts); refused, it keeps the stand-in and nothing errors.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import { expectShown, inkWeight, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DRAWING = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_text_box_in_hole.dxf');
const FILLED = 400_000;
const ARIAL = Buffer.from(fontBytes(testFont())).toString('base64');

/** Stands the Local Font Access API in, answering the prompt with `answer`. */
async function installedFonts(page: Page, answer: 'allow' | 'deny'): Promise<void> {
  await page.addInitScript(
    ({ b64, answer }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const w = window as unknown as Record<string, unknown>;
      w.__fontQueries = 0;
      w.queryLocalFonts = () => {
        w.__fontQueries = (w.__fontQueries as number) + 1;
        sessionStorage.setItem('local-fonts', answer === 'allow' ? 'granted' : 'denied');
        if (answer === 'deny') {
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        }
        return Promise.resolve([
          {
            family: 'Arial',
            fullName: 'Arial',
            postscriptName: 'ArialMT',
            style: 'Regular',
            blob: () => Promise.resolve(new Blob([bytes])),
          },
        ]);
      };
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = ((d: PermissionDescriptor) =>
        (d.name as string) === 'local-fonts'
          ? Promise.resolve({ state: sessionStorage.getItem('local-fonts') ?? 'prompt' })
          : query(d)) as typeof navigator.permissions.query;
    },
    { b64: ARIAL, answer },
  );
}

async function openDrawing(page: Page): Promise<number> {
  await openWithPicker(page, DRAWING);
  await expectShown(page, 'hatch_text_box_in_hole.dxf');
  return inkWeight(page);
}

const queries = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fontQueries: number }).__fontQueries);

test('installed fonts draw the style that names them once allowed, and on later visits', async ({
  page,
}) => {
  await installedFonts(page, 'allow');
  await page.goto(app.url);
  const standIn = await openDrawing(page);
  // Nothing is asked before the user chooses to.
  expect(await queries(page)).toBe(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Use installed fonts…' }).click();
  const inUse = settings.getByRole('list', { name: 'Installed fonts in use' });
  await expect(inUse).toContainText('arial.ttf');
  await expect(inUse).toContainText('Arial');
  // They are not the user's files: nothing to remove, nothing kept.
  await expect(settings.getByText('No font files added.')).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeGreaterThan(standIn + FILLED);

  // Granted already: the next visit lists the fonts by itself, without the button.
  // Open the drawing once and poll its ink: the fonts are listed asynchronously after the
  // reload, and polling openDrawing itself opened the drawing again on every attempt, so a
  // slow first attempt left several tabs of the same name (strict-mode failure on CI).
  await page.reload();
  await openDrawing(page);
  await expect.poll(() => inkWeight(page), { timeout: 30_000 }).toBeGreaterThan(standIn + FILLED);
  expect(await queries(page)).toBe(1);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings.getByRole('button', { name: 'Use installed fonts…' })).toHaveCount(0);
});

test('denying installed fonts keeps the bundled stand-in without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await installedFonts(page, 'deny');
  await page.goto(app.url);
  const standIn = await openDrawing(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Use installed fonts…' }).click();
  await expect(settings.getByRole('status')).toHaveText(/Access to installed fonts is blocked/);
  await settings.getByRole('button', { name: 'Close' }).click();
  // Give a font that wrongly arrived time to draw; the text stays stroked.
  await page.waitForTimeout(500);
  expect(await inkWeight(page)).toBeLessThan(standIn + FILLED / 4);
  expect(errors).toEqual([]);

  // Denied stays denied on the next visit, still without errors or a prompt.
  await page.reload();
  await openDrawing(page);
  expect(await queries(page)).toBe(0);
  expect(errors).toEqual([]);
});
