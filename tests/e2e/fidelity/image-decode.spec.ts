// M1-19 part 2: PNG, JPEG and GIF through decodeRaster with Chromium's own codecs. The PNGs are
// built here byte by byte (self-authored, exact pixels); the JPEG is the browser's own encoding
// of a known fill, which must come back within JPEG's loss.
import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { startRenderHarness } from '../render-harness/server';

let harness: Awaited<ReturnType<typeof startRenderHarness>>;

test.beforeAll(async () => {
  harness = await startRenderHarness();
});

test.afterAll(async () => {
  await harness?.close();
});

/** A PNG of `rows` (raw scanlines, filter 0 added here) with the given depth and colour type. */
function png(width: number, height: number, depth: number, colour: number, rows: number[][]) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colour;
  const raw = Buffer.from(rows.flatMap((r) => [0, ...r]));
  return [
    ...Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  ];
}

test('decodes PNG, one-bit PNG and JPEG with the browser codecs', async ({ page }) => {
  await page.goto(harness.url);
  await expect(page).toHaveTitle('ready', { timeout: 60_000 });

  // 2 × 1 RGBA: opaque red, half-transparent blue. Straight alpha must survive unpremultiplied.
  const rgba = png(2, 1, 8, 6, [[255, 0, 0, 255, 0, 0, 255, 128]]);
  const a = await page.evaluate((b) => window.decodeImage(b), rgba);
  expect(a).toEqual({
    width: 2,
    height: 1,
    data: [255, 0, 0, 255, 0, 0, 255, 128],
    bitonal: false,
  });

  // 3 × 1 one-bit greyscale: black, white, black.
  const bits = png(3, 1, 1, 0, [[0b01000000]]);
  const b = await page.evaluate((x) => window.decodeImage(x), bits);
  expect(b.bitonal).toBe(true);
  expect(b.data).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);

  // JPEG: a flat mid-grey 8 × 8 block comes back within a few levels.
  const grey = Array.from({ length: 64 }, () => [128, 128, 128, 255]).flat();
  const jpeg = await page.evaluate(([g]) => window.encodeImage('image/jpeg', g!, 8), [grey]);
  expect(jpeg.slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);
  const c = await page.evaluate((x) => window.decodeImage(x), jpeg);
  expect([c.width, c.height]).toEqual([8, 8]);
  for (const v of c.data) expect(Math.abs(v - (v === 255 ? 255 : 128))).toBeLessThanOrEqual(3);
});
