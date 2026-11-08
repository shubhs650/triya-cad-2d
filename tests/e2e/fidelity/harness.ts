// The fidelity harness's steps (M1-24, M1-106; TESTING.md §4), shared by the golden-image suite
// and the triage test: open a drawing as a user does, shoot each space once its canvas settles,
// compare a shot with a golden image, and name the entities drawn where they differ.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  compareImages,
  decodePng,
  type Comparison,
  type Tolerance,
} from '../../../packages/testkit/src/fidelity/compare';
import {
  describeRegion,
  typeCounts,
  type DrawnEntity,
  type SpaceTriage,
} from '../../../packages/testkit/src/fidelity/triage';
import { activeCanvas, openWithPicker } from '../app/page';

/**
 * The size every render is taken at. The canvas area is pinned to it rather than left to fill
 * the window: the chrome around it is set in the system UI font, so its width differs between
 * machines (a 1-pixel wider canvas on CI than locally), and the window is large enough to hold it.
 */
export const CANVAS = { width: 960, height: 600 };
export const VIEWPORT = { width: 1100, height: 760 };
const PIN_CANVAS = `.canvas-area { flex: none !important; width: ${CANVAS.width}px !important; height: ${CANVAS.height}px !important; }`;

/** Chrome drawn over the canvas (the navigation bar), hidden from the shots: its text is set in
 * the system UI font, which differs between machines. */
const HIDE_CHROME = '.nav-bar { visibility: hidden !important; }';

/** Differing regions named in a failure; the rest are left to the diff picture. */
const MAX_REGIONS = 8;

export const spaceTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
const zoomExtents = (page: Page) =>
  page
    .getByRole('toolbar', { name: 'Navigation' })
    .getByRole('button', { name: 'Zoom Extents', exact: true });

/** Loads the app with its canvas area pinned to the render size. */
export async function loadApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.addStyleTag({ content: PIN_CANVAS });
}

/**
 * Opens `file` with the Open button's picker and waits for its document tab or the open error;
 * returns the error alert's locator, which is empty when the file opened.
 */
export async function openDrawing(page: Page, file: string) {
  await openWithPicker(page, file);
  const tab = page
    .getByRole('tablist', { name: 'Open drawings' })
    .getByRole('tab', { name: path.basename(file) });
  const alert = page.getByRole('alert');
  await expect(tab.or(alert).first()).toBeVisible({ timeout: 60_000 });
  return { tab, alert };
}

/**
 * The canvas once it has stopped changing. Fonts, patterns and images are fetched and decoded
 * after the first frame, and text is measured once its font is in, so this waits for the network
 * to go quiet and then for three shots 300 ms apart to be the same bytes.
 */
export async function settled(page: Page): Promise<Buffer> {
  await page.waitForLoadState('networkidle');
  const shot = () => activeCanvas(page).screenshot({ animations: 'disabled', style: HIDE_CHROME });
  let last = await shot();
  let same = 0;
  const deadline = Date.now() + 60_000;
  while (same < 2) {
    await page.waitForTimeout(300);
    const next = await shot();
    same = Buffer.compare(next, last) === 0 ? same + 1 : 0;
    if (Date.now() > deadline) throw new Error('the canvas did not settle within 60 s');
    last = next;
  }
  return last;
}

/**
 * Shows space `i` (a tab of "Model and layouts") and shoots it once settled: model space (the
 * first tab) at its extents, ZOOM E only once the drawing has settled since text extents need
 * their fonts; a layout in the paper view it opens in.
 */
export async function shootSpace(page: Page, i: number): Promise<Buffer> {
  await spaceTabs(page).nth(i).click();
  await expect(spaceTabs(page).nth(i)).toHaveAttribute('aria-selected', 'true');
  let shot = await settled(page);
  if (i === 0) {
    await zoomExtents(page).click();
    shot = await settled(page);
  }
  return shot;
}

/** The entities the showing space draws in a rectangle of its canvas (`DevHooks.entitiesIn`). */
export function entitiesIn(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
): Promise<DrawnEntity[]> {
  return page.evaluate(
    (r) =>
      (
        window as unknown as {
          triyaDev: { entitiesIn(r: typeof rect): Promise<DrawnEntity[]> };
        }
      ).triyaDev.entitiesIn(r),
    rect,
  );
}

export interface SpaceCheck {
  readonly triage: SpaceTriage;
  /** The failure line for the test's message; absent when the space passed. */
  readonly failure?: string;
  readonly comparison?: Comparison;
}

/**
 * Compares the shot of the showing space with its golden image (undefined: there is none) and,
 * where they differ, names the entities the app draws in each differing region (M1-106).
 */
export async function checkSpace(
  page: Page,
  space: string,
  shot: Uint8Array,
  golden: Uint8Array | undefined,
  tolerance: Tolerance,
): Promise<SpaceCheck> {
  const all = await entitiesIn(page, { x: 0, y: 0, ...CANVAS });
  const drawn = typeCounts(all);
  if (!golden) {
    const reason = 'no golden image';
    return { triage: { space, pass: false, reason, drawn, regions: [] }, failure: reason };
  }
  const comparison = compareImages(decodePng(shot), decodePng(golden), tolerance);
  if (comparison.pass) return { triage: { space, pass: true, drawn, regions: [] }, comparison };
  const regions = [];
  for (const region of comparison.regions.slice(0, MAX_REGIONS)) {
    regions.push({ region, entities: await entitiesIn(page, region) });
  }
  const where = regions.map((r) => describeRegion(r.region, r.entities)).join('; ');
  return {
    triage: { space, pass: false, reason: comparison.reason, drawn, regions },
    failure: `${comparison.reason} (differs at ${where})`,
    comparison,
  };
}

/** Writes a PNG to the test's output folder (CI uploads it as `fidelity-diffs`) and attaches it. */
export async function attachPng(info: TestInfo, name: string, body: Uint8Array): Promise<void> {
  const out = info.outputPath(name);
  writeFileSync(out, body);
  await info.attach(name, { path: out, contentType: 'image/png' });
}
