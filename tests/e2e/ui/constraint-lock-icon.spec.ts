// M9-05 part 9: the lock icon before a dimensional constraint's text (AutoCAD 2024 Help,
// "DIMCONSTRAINTICON (System Variable)": a bitcode, initially 3; 1 the icon on dynamic
// constraints, 2 on annotational ones). On an empty part of the plan two lines are drawn:
// DCALIGNED puts a dynamic constraint on the upper one, and SETVAR DIMCONSTRAINTICON 2 takes its
// lock away (fewer blue pixels); with CCONSTRAINTFORM 1 the lower one's is annotational and
// shows its lock in the foreground; the Constraint Settings' Dimensional tab shows Show lock icon
// for annotational constraints checked, and unchecking it takes that lock away and sets
// DIMCONSTRAINTICON 0. The icon's shape and placing are unit-tested in
// packages/render/test/constraint-lock-icon.test.ts; this checks the app's variable, dialog and
// worker.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  gridOff,
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

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Pixels of the dynamic constraints' blue (#5ab4ff on the dark canvas, blended at its edges) or
 * of the foreground white in the CSS-pixel rectangle between `a` and `b` of the active canvas.
 */
async function inkPixels(
  page: Page,
  ink: 'blue' | 'white',
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, ink, x0, y0, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, bl] = [d[i]!, d[i + 1]!, d[i + 2]!];
        if (ink === 'blue' ? bl > 150 && bl - r > 70 && g > r : r > 200 && g > 200 && bl > 200) {
          n++;
        }
      }
      return n;
    },
    {
      b64: png,
      ink,
      x0: Math.round(Math.min(a.x, b.x)),
      y0: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y)),
    },
  );
}

test('constraints show a lock icon as DIMCONSTRAINTICON and the Constraint Settings say', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and two lines 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [60, 20]) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `1000020,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, `1000080,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The bands above each line where its constraint is drawn. */
  const upper = () => inkPixels(page, 'blue', at(5, 62), at(95, 90));
  const lower = () => inkPixels(page, 'white', at(5, 22), at(95, 50));
  const lowerBare = await lower();

  // A dynamic constraint on the upper line: its lock shows, DIMCONSTRAINTICON being 3 at first.
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 72);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, '', 'Command:');
  await expect.poll(upper, { timeout: 15_000 }).toBeGreaterThan(100);
  const locked = await upper();

  // An annotational one on the lower line (CCONSTRAINTFORM 1), its lock in the foreground.
  await type(page, 'CCONSTRAINTFORM', /^Enter new value for CCONSTRAINTFORM <0>:/);
  await type(page, '1', 'Command:');
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 32);
  await expect(prompt(page)).toHaveText('Dimension text <d2=60.0000>:');
  await type(page, '', 'Command:');
  await expect.poll(lower, { timeout: 15_000 }).toBeGreaterThan(lowerBare + 100);
  const annotationalLocked = await lower();
  await shot('1-lock-icons.png');

  // DIMCONSTRAINTICON 2: annotational locks only; the dynamic constraint's lock goes.
  await type(page, 'DIMCONSTRAINTICON', /^Enter new value for DIMCONSTRAINTICON <3>:/);
  await type(page, '2', 'Command:');
  await expect.poll(upper).toBeLessThan(locked - 20);
  expect(await upper()).toBeGreaterThan(100);
  expect(await lower()).toBe(annotationalLocked);
  await shot('2-dynamic-lock-off.png');

  // The Constraint Settings' Dimensional tab shows the annotational lock on; unchecked, it goes.
  await enterCommand(page, 'CONSTRAINTSETTINGS');
  const dialog = page.getByRole('dialog', { name: 'Constraint Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Dimensional' }).click();
  const check = dialog.getByRole('checkbox', {
    name: 'Show lock icon for annotational constraints',
  });
  await expect(check).toBeChecked();
  await shot('3-constraint-settings.png');
  await check.uncheck();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(lower).toBeLessThan(annotationalLocked - 20);
  expect(await lower()).toBeGreaterThan(lowerBare + 100);
  await shot('4-annotational-lock-off.png');
  await page.locator('#command-input').click();
  await type(page, 'DIMCONSTRAINTICON', /^Enter new value for DIMCONSTRAINTICON <0>:/);
  await type(page, '', 'Command:');
});
