// M2-72: a pasted picture's PNG travels with the drawing. Another app's picture pastes as an
// IMAGE naming `pasted-<hash>.png`, a file only this device keeps (M2-54); Save As offers to
// write it beside the DXF, in the folder the user picks once (the folder picker opens at the
// saved drawing), later saves write it there unasked, and the References palette saves the kept
// file anywhere. The pickers are Chromium's real File System Access handles, in the
// origin-private file system: `Drawings` stands for the folder the user saves in. The offer's
// rules are unit-tested in apps/web/test/picture-files.test.ts.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

interface Pickers {
  /** What the folder picker was opened at, each time it was asked. */
  folderStartIn: (string | undefined)[];
  pngStartIn: (string | undefined)[];
}

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Chromium's pickers, answered as a user would: the drawing is saved in `Drawings`, the folder
 * picked for its pictures is `Drawings`, and a picture saved from the References palette goes
 * to `Elsewhere/screenshot.png`.
 */
async function pickers(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const drawings = await root.getDirectoryHandle('Drawings', { create: true });
    const elsewhere = await root.getDirectoryHandle('Elsewhere', { create: true });
    const seen: Pickers = { folderStartIn: [], pngStartIn: [] };
    const w = window as unknown as Record<string, unknown>;
    w.__pickers = seen;
    w.showSaveFilePicker = (o: {
      suggestedName: string;
      types: { accept: Record<string, string[]> }[];
      startIn?: FileSystemHandle;
    }) => {
      if (o.types[0]?.accept['image/png']) {
        seen.pngStartIn.push(o.startIn?.name);
        return elsewhere.getFileHandle('screenshot.png', { create: true });
      }
      return drawings.getFileHandle(o.suggestedName, { create: true });
    };
    w.showDirectoryPicker = (o: { startIn?: FileSystemHandle }) => {
      seen.folderStartIn.push(o.startIn?.name);
      return Promise.resolve(drawings);
    };
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pickers: Pickers }).__pickers);

/** A file's bytes in the origin-private file system, as numbers; undefined when there is none. */
const opfsFile = (page: Page, folder: string, name: string) =>
  page.evaluate(
    async ({ folder, name }) => {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folder);
        const file = await (await dir.getFileHandle(name)).getFile();
        return [...new Uint8Array(await file.arrayBuffer())];
      } catch {
        return undefined;
      }
    },
    { folder, name },
  );

test("Save As writes a pasted picture's PNG beside the DXF; the References palette saves it", async ({
  playwright,
  launchOptions,
}) => {
  test.setTimeout(150_000);
  // A profile on disk: an off-the-record context's Chromium closes when a page reads a kept
  // origin-private handle back from IndexedDB (the recent drawings keep the saved file's).
  const profile = mkdtempSync(path.join(tmpdir(), 'triya-pictures-'));
  const context = await playwright.chromium.launchPersistentContext(profile, launchOptions);
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(app.url).origin,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(app.url);
    await openWithPicker(page, DXF);
    await expectShown(page, path.basename(DXF));
    await pickers(page);

    // Another app's picture, pasted.
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(96, 48);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 48, 48);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(48, 0, 48, 48);
      const png = await canvas.convertToBlob({ type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    });
    await page.keyboard.press('Control+v');
    await expect(prompt(page)).toHaveText('Specify insertion point:');
    await type(page, '1000,1000', 'Command:');
    const definitionNamed = () =>
      page.evaluate(() =>
        (window as unknown as Dev).triyaDev
          .changes()
          .flatMap((cs) => cs.objects?.added ?? [])
          .flatMap((o) =>
            o.type === 'IMAGEDEF' ? [(o as unknown as { fileName: string }).fileName] : [],
          ),
      );
    await expect.poll(definitionNamed).toHaveLength(1);
    const [picture] = await definitionNamed();
    expect(picture).toMatch(/^pasted-[0-9a-f]{8}\.png$/);
    const kept = await opfsFile(page, 'pictures', picture!);
    expect(kept?.length).toBeGreaterThan(0);

    // Save As: the DXF goes to Drawings, then the save offers the picture.
    const dxf = path.basename(DXF);
    await page.keyboard.press('Control+Shift+S');
    const offer = page.getByRole('group', { name: 'Pasted pictures' });
    await expect(offer).toContainText(`${dxf} shows a picture pasted from another app`, {
      timeout: 30_000,
    });
    await page.screenshot({ path: test.info().outputPath('1-save-offers-the-picture.png') });
    expect(await opfsFile(page, 'Drawings', picture!)).toBeUndefined();
    await offer.getByRole('button', { name: 'Save it beside the drawing…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'pasted picture' })).toHaveText(
      `Saved 1 pasted picture beside ${dxf}.×`,
    );
    await expect(offer).toHaveCount(0);
    // The folder picker opened at the saved drawing; the PNG is there under the IMAGEDEF's name.
    expect((await seen(page)).folderStartIn).toEqual([dxf]);
    expect(await opfsFile(page, 'Drawings', picture!)).toEqual(kept);
    const saved = await opfsFile(page, 'Drawings', dxf);
    expect(new TextDecoder().decode(new Uint8Array(saved!))).toContain(picture!);
    await page.screenshot({ path: test.info().outputPath('2-picture-saved-beside.png') });

    // Asked once: QSAVE writes it there again, unasked.
    await page.evaluate(
      async ({ name }) => {
        const root = await navigator.storage.getDirectory();
        await (await root.getDirectoryHandle('Drawings')).removeEntry(name);
      },
      { name: picture! },
    );
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status').filter({ hasText: 'pasted picture' })).toHaveText(
      `Saved ${dxf} and 1 pasted picture beside it.×`,
      { timeout: 30_000 },
    );
    expect(await opfsFile(page, 'Drawings', picture!)).toEqual(kept);
    expect((await seen(page)).folderStartIn).toEqual([dxf]);
    await expect(offer).toHaveCount(0);

    // The References palette saves the kept picture's file wherever the user picks.
    await page
      .getByRole('navigation', { name: 'Palettes' })
      .getByRole('button', { name: 'References' })
      .click();
    const palette = page.getByRole('complementary', { name: 'References' });
    await palette.getByRole('button', { name: `Save file ${picture}` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'screenshot.png' })).toHaveText(
      'Saved screenshot.png.×',
    );
    expect((await seen(page)).pngStartIn).toEqual([dxf]);
    expect(await opfsFile(page, 'Elsewhere', 'screenshot.png')).toEqual(kept);
    await page.screenshot({ path: test.info().outputPath('3-references-save-file.png') });
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('a save that downloads offers to download the pasted picture too', async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(32, 32);
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await page.keyboard.press('Control+v');
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await type(page, '0,0', 'Command:');

  const drawing = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await drawing;
  const offer = page.getByRole('group', { name: 'Pasted pictures' });
  await expect(offer).toBeVisible({ timeout: 30_000 });
  const pictureDownload = page.waitForEvent('download');
  await offer.getByRole('button', { name: 'Download it' }).click();
  expect((await pictureDownload).suggestedFilename()).toMatch(/^pasted-[0-9a-f]{8}\.png$/);
  await expect(offer).toHaveCount(0);

  // Downloaded once: the next save does not offer it again.
  const again = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await again;
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
