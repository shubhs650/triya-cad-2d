// M2-13: Save, Save As, the dirty dot and the close prompts, in the app. Chromium's File System
// Access pickers cannot be driven by Playwright, so the page gets stand-ins before it loads: the
// open picker hands out an in-memory file handle for the bytes a test serves, the save picker one
// named as the app suggests, and every handle keeps what the app writes to it. The DXF the save
// writes is the I/O worker's (unit and corpus tests check its content); here the app's routing:
// in place over an AC1032 DXF, Save As a `.dxf` for a DWG, a download without File System Access.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, activeCanvas, expectShown, serve, withFileInput, worldAt } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** An AC1032 ASCII DXF, which Save writes over in place. */
const DXF32 = path.join(CORPUS, 'ezdxf/examples_dxf/hatches_1.dxf');

interface Fs {
  /** The next file the open picker hands out. */
  next?: { name: string; bytes: ArrayBuffer };
  /** What the save picker was asked to suggest, in order. */
  suggested: string[];
  /** What the app wrote to each handle, by name, latest last. */
  written: Record<string, string[]>;
  /** Write permission asks. */
  asked: string[];
}
type FsWindow = { __fs: Fs };

/** The pickers' stand-ins, installed before the app loads. */
async function fakePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fs: Fs = { suggested: [], written: {}, asked: [] };
    (window as unknown as FsWindow).__fs = fs;
    const handle = (name: string, bytes: ArrayBuffer) => ({
      kind: 'file',
      name,
      getFile: () => Promise.resolve(new File([bytes], name)),
      queryPermission: () => Promise.resolve('prompt'),
      requestPermission: () => {
        fs.asked.push(name);
        return Promise.resolve('granted');
      },
      createWritable: () => {
        const parts: Blob[] = [];
        return Promise.resolve({
          write: (b: Blob) => Promise.resolve(void parts.push(b)),
          close: async () => {
            const text = await new Blob(parts).text();
            (fs.written[name] ??= []).push(text);
          },
        });
      },
    });
    Object.assign(window, {
      showOpenFilePicker: () => {
        const n = fs.next!;
        delete fs.next;
        return Promise.resolve([handle(n.name, n.bytes)]);
      },
      showSaveFilePicker: (o: { suggestedName: string }) => {
        fs.suggested.push(o.suggestedName);
        return Promise.resolve(handle(o.suggestedName, new ArrayBuffer(0)));
      },
    });
  });
}

/** Opens `file` through the Open button, as Chromium's open picker hands it over. */
async function openFile(page: Page, file: string): Promise<void> {
  const url = await serve(page, file);
  await page.evaluate(
    async ({ url, name }) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      (window as unknown as FsWindow).__fs.next = { name, bytes };
    },
    { url, name: path.basename(file) },
  );
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expectShown(page, path.basename(file));
}

const fs = (page: Page) => page.evaluate(() => (window as unknown as FsWindow).__fs);
const prompt = (page: Page) => page.getByTestId('command-prompt');
const tab = (page: Page, name: string) => page.locator('.doc-tab', { hasText: name });

/** Draws a line with the command line, which leaves the drawing with unsaved changes. */
async function drawLine(page: Page): Promise<void> {
  await activeCanvas(page).hover();
  const steps: [string, string | RegExp][] = [
    ['LINE', 'Specify first point:'],
    ['0,0', /^Specify next point/],
    ['@40<30', /^Specify next point/],
    ['', 'Command:'],
  ];
  for (const [text, next] of steps) {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveText(next);
  }
  await expect(page.locator('.doc-tab[data-active="true"]')).toHaveAttribute('data-dirty', 'true');
}

/** The DXF's $ACADVER and how many LINEs its ENTITIES and BLOCKS sections hold. */
function dxfFacts(text: string): { version: string | undefined; lines: number } {
  return {
    version: /\$ACADVER\r?\n\s*1\r?\n(\w+)/.exec(text)?.[1],
    lines: text.match(/\r?\n\s*0\r?\nLINE\r?\n/g)?.length ?? 0,
  };
}

test('Ctrl+S saves an AC1032 DXF in place, and the dirty dot follows the changes', async ({
  page,
}) => {
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DXF32);
  const name = path.basename(DXF32);
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'false');
  await drawLine(page);
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'true');
  // The dot is not part of the tab's name.
  await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('1-unsaved-changes.png') });

  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status')).toHaveText(new RegExp(`Saved ${name}\\.`));
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'false');
  const f = await fs(page);
  expect(f.suggested).toEqual([]);
  expect(f.asked).toEqual([name]);
  expect(f.written[name]).toHaveLength(1);
  const saved = dxfFacts(f.written[name]![0]!);
  expect(saved.version).toBe('AC1032');
  await page.screenshot({ path: test.info().outputPath('2-saved.png') });

  // QSAVE at the command line saves the next change the same way.
  await drawLine(page);
  await page.keyboard.type('QSAVE');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await fs(page)).written[name]?.length).toBe(2);
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'false');
  expect(dxfFacts((await fs(page)).written[name]![1]!).lines).toBe(saved.lines + 1);
});

test('a DWG goes to Save As a .dxf, never over the DWG; Save then writes the .dxf', async ({
  page,
}) => {
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DWG);
  const dwg = path.basename(DWG);
  const dxf = dwg.replace(/\.dwg$/, '.dxf');
  await drawLine(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectShown(page, dxf);
  let f = await fs(page);
  expect(f.suggested).toEqual([dxf]);
  expect(f.written[dwg]).toBeUndefined();
  expect(dxfFacts(f.written[dxf]![0]!).version).toBe('AC1032');

  await drawLine(page);
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await fs(page)).written[dxf]?.length).toBe(2);
  f = await fs(page);
  expect(f.suggested).toEqual([dxf]);
  // Ctrl+Shift+S always asks.
  await page.keyboard.press('Control+Shift+S');
  await expect.poll(async () => (await fs(page)).suggested).toEqual([dxf, dxf]);
});

test('closing a drawing with unsaved changes asks to save them first', async ({ page }) => {
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DXF32);
  const name = path.basename(DXF32);
  const dialog = page.getByRole('dialog', { name: 'Triya CAD 2D' });
  const close = page.getByRole('button', { name: `Close ${name}` });

  // Nothing changed yet: the tab just closes.
  await close.click();
  await expect(tab(page, name)).toHaveCount(0);
  await expect(dialog).toBeHidden();

  await openFile(page, DXF32);
  await drawLine(page);
  await close.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Save changes to ${name}?`);
  await expect(dialog.getByRole('button', { name: 'Yes' })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('3-save-changes.png') });
  // Cancel (Esc) keeps it open.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tab(page, name)).toHaveCount(1);
  // Yes saves, then closes.
  await close.click();
  await dialog.getByRole('button', { name: 'Yes' }).click();
  await expect(tab(page, name)).toHaveCount(0);
  expect((await fs(page)).written[name]).toHaveLength(1);

  // CLOSE at the command line asks too; No closes without saving.
  await openFile(page, DXF32);
  await drawLine(page);
  await page.keyboard.type('CLOSE');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'No' }).click();
  await expect(tab(page, name)).toHaveCount(0);
  expect((await fs(page)).written[name]).toHaveLength(1);
});

test('leaving the page with unsaved changes asks first', async ({ page }) => {
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DXF32);
  // What the browser asks before unloading: whether the page's beforeunload cancels it.
  const asks = () =>
    page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await asks()).toBe(false);
  await drawLine(page);
  expect(await asks()).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(tab(page, path.basename(DXF32))).toHaveAttribute('data-dirty', 'false');
  expect(await asks()).toBe(false);
});

test('without File System Access, Save downloads the .dxf', async ({ page }) => {
  await page.goto(app.url);
  await withFileInput(page);
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooser).setFiles(DWG);
  await expectShown(page, path.basename(DWG));
  await drawLine(page);
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const d = await download;
  const dxf = path.basename(DWG).replace(/\.dwg$/, '.dxf');
  expect(d.suggestedFilename()).toBe(dxf);
  const file = test.info().outputPath(dxf);
  await d.saveAs(file);
  const { readFileSync } = await import('node:fs');
  expect(dxfFacts(readFileSync(file, 'latin1')).version).toBe('AC1032');
  await expectShown(page, dxf);
  await expect(tab(page, dxf)).toHaveAttribute('data-dirty', 'false');
});

/** The names (group 2) of the DXF's `type` records, read as group code / value pairs. */
function dxfRecordNames(text: string, type: string): string[] {
  const lines = text.split(/\r?\n/);
  const names: string[] = [];
  let inRecord = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === '0') inRecord = value === type;
    else if (inRecord && code === '2') names.push(value);
  }
  return names;
}

/**
 * Types each step at the command line and presses Enter, waiting for the prompt it leads to
 * before the next: typed ahead of its prompt, a space would end a name and Enter take a default.
 */
async function typed(page: Page, ...steps: [string, string | RegExp][]): Promise<void> {
  await activeCanvas(page).hover();
  for (const [text, next] of steps) {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveText(next);
  }
}

/**
 * The world point at the canvas centre, the world units across 100 pixels, and the world height
 * the canvas shows, which a saved view keeps when the window's size changes (VIEWSIZE).
 */
async function shown(page: Page): Promise<{ x: number; y: number; unit: number; height: number }> {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const r = await worldAt(page, cx + 100, cy);
  const unit = (r.x - c.x) / 100;
  return { ...c, unit, height: Math.abs(unit) * box.height };
}

/** `a` and `b` show the same view: the centre to two pixels, the height to 1 %. */
function sameView(a: Awaited<ReturnType<typeof shown>>, b: typeof a): void {
  const px = 2 * Math.max(Math.abs(a.unit), Math.abs(b.unit));
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(px);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(px);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(a.height / 100);
}

test('the save keeps the named views VIEW saves and reopens in the view it was saved in (M2-29)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DXF32);
  const name = path.basename(DXF32);
  const opening = await shown(page);
  // A named view of a zoomed-in corner, then a different view left on screen.
  const zoom: [string, RegExp] = ['ZOOM', /^Specify corner of window/];
  await typed(page, zoom, ['3x', 'Command:']);
  await typed(
    page,
    ['-PAN', /^Specify base point/],
    ['0,0', /^Specify second point/],
    ['@20,10', 'Command:'],
  );
  const detail = await shown(page);
  await typed(
    page,
    ['-VIEW', /^Enter an option/],
    ['S', 'Enter view name to save:'],
    ['Markup detail', 'Command:'],
  );
  await typed(page, zoom, ['0.5x', 'Command:']);
  const left = await shown(page);
  expect(Math.abs(left.unit - opening.unit)).toBeGreaterThan(Math.abs(opening.unit) / 10);
  await page.screenshot({ path: test.info().outputPath('1-view-saved-then-zoomed.png') });
  // The named view is an edit (the dirty dot), and one VIEW undo step.
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'true');
  await page.keyboard.press('Control+s');
  await expect(tab(page, name)).toHaveAttribute('data-dirty', 'false');
  const dxf = (await fs(page)).written[name]![0]!;
  expect(dxfRecordNames(dxf, 'VIEW')).toContain('Markup detail');

  // Opened again, the drawing shows what was left on screen, and the view restores.
  await page.evaluate((text) => {
    (window as unknown as FsWindow).__fs.next = {
      name: 'reopened.dxf',
      bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
    };
  }, dxf);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expectShown(page, 'reopened.dxf');
  sameView(await shown(page), left);
  await page.getByRole('button', { name: 'Views' }).click();
  const views = page.getByRole('group', { name: 'Named views' });
  await page.screenshot({ path: test.info().outputPath('2-reopened-views.png') });
  await views.getByRole('button', { name: 'Markup detail' }).click();
  sameView(await shown(page), detail);
  await page.screenshot({ path: test.info().outputPath('3-named-view-restored.png') });
});

test('CLOSEALL closes every drawing, asking to save changes; Cancel stops it (M2-29)', async ({
  page,
}) => {
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, DXF32);
  await openFile(page, DWG);
  const dialog = page.getByRole('dialog', { name: 'Triya CAD 2D' });
  await drawLine(page);
  await typed(page, ['CLOSEALL', 'Command:']);
  // The unchanged drawing closes; the changed one asks.
  await expect(dialog).toContainText(`Save changes to ${path.basename(DWG)}?`);
  await expect(tab(page, path.basename(DXF32))).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('4-closeall-asks.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tab(page, path.basename(DWG))).toHaveCount(1);
  await typed(page, ['CLOSEALL', 'Command:']);
  await dialog.getByRole('button', { name: 'No' }).click();
  await expect(page.locator('.doc-tab')).toHaveCount(0);
  await expect(page.getByTestId('start')).toBeVisible();
});

/** The block name (DXF 2) of each DIMENSION in a DXF's ENTITIES section, by handle. */
function dimensionBlocks(text: string): Record<string, string | undefined> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, string | undefined> = {};
  const start = lines.findIndex((l, i) => l.trim() === 'ENTITIES' && lines[i - 1]?.trim() === '2');
  for (let i = start; i > 0 && i + 1 < lines.length; i += 2) {
    if (lines[i - 1]!.trim() === '0' && lines[i]!.trim() === 'ENDSEC') break;
    if (lines[i - 1]!.trim() !== '0' || lines[i]!.trim() !== 'DIMENSION') continue;
    let handle = '';
    let block: string | undefined;
    for (let j = i + 1; j + 1 < lines.length && lines[j]!.trim() !== '0'; j += 2) {
      const [code, value] = [lines[j]!.trim(), lines[j + 1]!.trim()];
      if (code === '5') handle = value;
      if (code === '2') block = value;
    }
    out[handle] = block;
  }
  return out;
}

test('dimensions opened without a block are saved with one (M2-30 part 2)', async ({ page }) => {
  // ezdxf's duplicate_handles.dxf (R13): seven dimensions whose blocks are missing, drawn by
  // the dimension engine on screen.
  const file = path.join(CORPUS, 'ezdxf/integration_tests/duplicate_handles.dxf');
  await fakePickers(page);
  await page.goto(app.url);
  await openFile(page, file);
  const dxf = path.basename(file);
  // An R13 DXF goes to Save As.
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await fs(page)).written[dxf]?.length).toBe(1);
  const saved = (await fs(page)).written[dxf]![0]!;
  const blocks = dimensionBlocks(saved);
  expect(Object.keys(blocks)).toHaveLength(7);
  // Each its own `*D` block, which the BLOCKS section defines (the source names *D0 and *D1,
  // which it has not).
  expect(new Set(Object.values(blocks)).size).toBe(7);
  const defined = new Set(
    [
      ...saved.matchAll(
        /\r?\n\s*0\r?\nBLOCK\r?\n(?:\s*\d+\r?\n[^\r\n]*\r?\n)*?\s*2\r?\n([^\r\n]+)/g,
      ),
    ].map((m) => m[1]!.trim()),
  );
  for (const [handle, name] of Object.entries(blocks)) {
    expect(name, handle).toMatch(/^\*D\d+$/);
    expect(defined.has(name!), `${handle} ${name}`).toBe(true);
  }
  // Saved, not edited: the drawing has no unsaved changes.
  await expect(tab(page, dxf)).toHaveAttribute('data-dirty', 'false');
});
