// M3-15: a layout viewport's own UCS (UCSVP; AutoCAD 2024 Help, "UCS (Command)" Apply, "UCSVP")
// and Dynamic Input's grip dimension fields for arcs. VP4.dxf's layout has four viewports, each
// keeping its own UCS (DXF 71 = 1, the WCS) with its UCS icon on. Model space's UCS turned 30°
// leaves them; UCS Apply keeps it in the one picked, whose icon turns; UCS per viewport No in the
// Properties palette makes another follow model space's UCS. The icons are drawn on the canvas, so
// each is checked by the pixels about its frame's lower-left corner, and by the change made.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The geometry of each object the commands changed or added, by handle, as it is now. */
const changed = (page: Page, kind: string) =>
  page.evaluate((kind) => {
    const out: Record<string, Entity['geom']> = {};
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.geom.kind === kind) out[a.entity.handle] = a.entity.geom;
      for (const u of cs.entities?.updated ?? [])
        if (u.after.geom.kind === kind) out[u.after.handle] = u.after.geom;
    }
    return out;
  }, kind);

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Screen points for sheet points, once ZOOM Window has fitted `w` × `h` about `c`. */
async function fitted(page: Page, c: { x: number; y: number }, w: number, h: number) {
  const box = (await activeCanvas(page).boundingBox())!;
  const k = Math.min(box.width / w, box.height / h);
  return (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - c.x) * k,
    y: box.y + box.height / 2 - (y - c.y) * k,
  });
}

/** The layout's view: the sheet from 0,0 to 240,200, the pointer parked off the canvas. */
async function sheet(page: Page) {
  await page.mouse.move(5, 5);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '0,0', 'Specify opposite corner:');
  await type(page, '240,200', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });
  return fitted(page, { x: 120, y: 100 }, 240, 200);
}

/** The pixels where a viewport's UCS icon sits: 70 px up and right of its frame's lower left. */
async function iconPixels(
  page: Page,
  at: (x: number, y: number) => { x: number; y: number },
  frameMin: { x: number; y: number },
): Promise<Buffer> {
  const p = at(frameMin.x, frameMin.y);
  await page.waitForTimeout(200);
  return page.screenshot({ clip: { x: p.x + 2, y: p.y - 72, width: 70, height: 70 } });
}

// The frames' lower-left corners: A3 (top left) and A5 (bottom right).
const A3 = { x: 45.5 - 27.8, y: 155.5 - 24 };
const A5 = { x: 185.463 - 27.8, y: 40.5 - 23 };

test('a viewport’s UCS icon follows a UCS applied to it, and model space’s with UCSVP off', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const file = path.join(CORPUS, 'ezdxf/examples_dxf/VP4.dxf');
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  // Model space's current UCS turned 30°.
  await type(page, 'UCS', /^Specify origin of UCS/);
  await type(page, 'Z', /^Specify rotation angle about Z axis/);
  await type(page, '30', 'Command:');

  const tabs = page.getByRole('tablist', { name: 'Model and layouts' });
  await tabs.getByRole('tab').nth(1).click();
  await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expectDrawn(page, { timeout: 15_000 });
  await page.keyboard.press('F3');
  let at = await sheet(page);
  // Each viewport keeps its own UCS, the WCS: model space's turn leaves their icons.
  const a3 = await iconPixels(page, at, A3);
  const a5 = await iconPixels(page, at, A5);
  await shot(page, '1-viewports-keep-their-own-ucs');

  // UCS Apply, picking the top left viewport: its icon turns 30°.
  await type(
    page,
    'UCS',
    'Specify origin of UCS or [NAmed/OBject/Previous/View/World/Z/Apply] <World>:',
  );
  await type(page, 'A', 'Pick viewport to apply current UCS or [All] <current>:');
  const inA3 = at(45.5, 155.5);
  await page.mouse.click(inA3.x, inA3.y);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => {
      const g = (await changed(page, 'VIEWPORT'))['A3'];
      return g?.kind === 'VIEWPORT' && g.ucsPerViewport && g.ucs
        ? Math.round((Math.atan2(g.ucs.xAxis.y, g.ucs.xAxis.x) * 180) / Math.PI)
        : undefined;
    })
    .toBe(30);
  await page.mouse.move(5, 5);
  expect((await iconPixels(page, at, A3)).equals(a3)).toBe(false);
  expect((await iconPixels(page, at, A5)).equals(a5)).toBe(true);
  await shot(page, '2-ucs-applied-to-top-left-viewport');

  // UCS per viewport No for the bottom right viewport (picked on its frame's bottom edge): it
  // shows model space's UCS, turned 30°.
  const edge = at(185.463, 17.5);
  await page.mouse.click(edge.x, edge.y);
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  const row = palette.getByRole('combobox', { name: 'UCS per viewport' });
  await expect(row).toHaveValue('yes');
  await row.selectOption({ label: 'No' });
  await expect
    .poll(async () => {
      const g = (await changed(page, 'VIEWPORT'))['A5'];
      return g?.kind === 'VIEWPORT' ? g.ucsPerViewport : undefined;
    })
    .toBe(false);
  await shot(page, '3-ucs-per-viewport-no');
  await page.keyboard.press('Control+1');
  await expect(palette).toBeHidden();
  await activeCanvas(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  at = await sheet(page);
  expect((await iconPixels(page, at, A5)).equals(a5)).toBe(false);
  await shot(page, '4-bottom-right-follows-model-space');
});

const X0 = 1_000_000;
const Y0 = 1_000_000;

test('an arc’s middle grip takes its radius in Dynamic Input', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0 - 30},${Y0 - 20}`, 'Specify opposite corner:');
  await type(page, `${X0 + 30},${Y0 + 20}`, 'Command:');
  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(x, y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  await page.keyboard.press('F3');
  // A half circle of radius 5 from X0+5,Y0 through X0,Y0+5.
  await type(page, 'ARC', /^Specify start point of arc/);
  await type(page, `#${X0 + 5},${Y0}`, /^Specify second point of arc/);
  await type(page, `#${X0},${Y0 + 5}`, 'Specify end point of arc:');
  await type(page, `#${X0 - 5},${Y0}`, 'Command:');
  const handle = Object.keys(await changed(page, 'ARC'))[0]!;

  let p = at(X0 + 5 * Math.SQRT1_2, Y0 + 5 * Math.SQRT1_2);
  await page.mouse.click(p.x, p.y);
  p = at(X0, Y0 + 5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  p = at(X0, Y0 + 3);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  const dyn = page.getByTestId('dyn');
  await expect(dyn.getByLabel('Arc Radius')).toBeVisible();
  await expect(dyn.getByLabel('Resulting Dimension')).toHaveCount(0);
  await page.keyboard.type('13');
  await shot(page, '5-arc-middle-grip-radius');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => {
      const g = (await changed(page, 'ARC'))[handle];
      return g?.kind === 'ARC' ? Math.round(g.radius * 1e6) / 1e6 : undefined;
    })
    .toBe(13);
});
