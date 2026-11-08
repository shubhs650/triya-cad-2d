// M1-106 acceptance: when a render differs from its golden image, the failure names the
// entities drawn in each differing region by type and handle. A thread-authored drawing (DEC-047)
// is shot as its own golden image, then a copy with one circle moved is opened and checked
// against it: the circle's handle must be named where it now is.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { startApp } from '../app/server';
import { VIEWPORT, checkSpace, loadApp, openDrawing, shootSpace } from './harness';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app?.close();
});
test.use({ viewport: VIEWPORT });

/** An R12 DXF with handles: a 100 × 60 frame of four lines (20–23) and circle 2F inside it. */
function drawing(circle: { x: number; y: number }): string {
  const line = (h: string, x1: number, y1: number, x2: number, y2: number) => [
    '0',
    'LINE',
    '5',
    h,
    '8',
    '0',
    '10',
    x1,
    '20',
    y1,
    '11',
    x2,
    '21',
    y2,
  ];
  const groups = [
    ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009'],
    ['9', '$HANDLING', '70', '1', '9', '$HANDSEED', '5', '100', '0', 'ENDSEC'],
    ['0', 'SECTION', '2', 'ENTITIES'],
    line('20', 0, 0, 100, 0),
    line('21', 100, 0, 100, 60),
    line('22', 100, 60, 0, 60),
    line('23', 0, 60, 0, 0),
    ['0', 'CIRCLE', '5', '2F', '8', '0', '10', circle.x, '20', circle.y, '40', 8],
    ['0', 'ENDSEC', '0', 'EOF'],
  ];
  return `${groups.flat().join('\n')}\n`;
}

test('a moved entity fails with its type and handle named', async ({ page }, info) => {
  test.setTimeout(120_000);
  const original = info.outputPath('triage-original.dxf');
  const moved = info.outputPath('triage-moved.dxf');
  writeFileSync(original, drawing({ x: 25, y: 30 }));
  writeFileSync(moved, drawing({ x: 70, y: 30 }));

  await loadApp(page, app.url);
  await openDrawing(page, original);
  const golden = await shootSpace(page, 0);
  // Itself: nothing differs.
  const same = await checkSpace(page, 'Model', golden, golden, { pixelMismatch: 0, ssim: 1 });
  expect(same.failure).toBeUndefined();
  expect(same.triage.drawn).toEqual({ LINE: 4, CIRCLE: 1 });

  const { tab } = await openDrawing(page, moved);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const shot = await shootSpace(page, 0);
  const check = await checkSpace(page, 'Model', shot, golden, { pixelMismatch: 0.5, ssim: 0.99 });
  expect(check.triage.pass).toBe(false);
  // Where the circle is now: named. Where it was: drawn by the golden image only.
  expect(check.failure).toContain('CIRCLE 2F');
  expect(check.failure).toContain('(no entity drawn there)');
  const named = check.triage.regions.flatMap((r) => r.entities.map((e) => e.handle));
  expect(new Set(named)).toEqual(new Set(['2F']));
});
