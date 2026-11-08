// The raster image test drawing (M1-19 part 3) stays as fixture.ts authors it: the committed
// bitmaps are the generator's bytes and decode to the pixels it means, and the committed DXF
// opens with its six images and five definitions. `TRIYA_UPDATE_FIXTURES=1` rewrites the files
// (the DXF's header carries its save time, so it is compared by what it maps to, not by bytes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ImageDefinition, ImageGeometry } from '@triya/engine';
import { openDocument, readCadDocument } from '@triya/io';
import { decodeRaster, type RasterPixels } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../fidelity/compare';
import {
  BARS_BMP,
  BARS_CLIP,
  BAR_COLOURS,
  CHECKER_HOLE,
  CHECKER_PNG,
  MISSING_JPG,
  RASTER_DXF_NAME,
  SCAN_TIF,
  barsBmp,
  checkerPixel,
  checkerPng,
  rasterDxf,
  scanInk,
  scanTif,
} from './fixture';

const DIR = fileURLToPath(new URL('../../fixtures/raster/', import.meta.url));
const BITMAPS: [string, () => Uint8Array][] = [
  [CHECKER_PNG, checkerPng],
  [BARS_BMP, barsBmp],
  [SCAN_TIF, scanTif],
];

if (process.env['TRIYA_UPDATE_FIXTURES'] === '1') {
  mkdirSync(DIR, { recursive: true });
  for (const [name, make] of BITMAPS) writeFileSync(DIR + name, make());
  writeFileSync(DIR + RASTER_DXF_NAME, rasterDxf());
}

/** PNG through pngjs, standing in for the browser's codec. */
const browser = (bytes: Uint8Array): Promise<RasterPixels> => {
  const r = decodePng(bytes);
  return Promise.resolve({ ...r, data: new Uint8ClampedArray(r.data) });
};

const pixel = (p: RasterPixels, x: number, y: number) => [
  ...p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4),
];

describe('raster image fixture', () => {
  it.each(BITMAPS)('commits %s as the generator writes it', (name, make) => {
    expect(existsSync(DIR + name)).toBe(true);
    expect(new Uint8Array(readFileSync(DIR + name))).toEqual(make());
  });

  it('writes bitmaps that decode to the pixels meant', async () => {
    const png = await decodeRaster(checkerPng(), { browser });
    expect([png.width, png.height, png.bitonal]).toEqual([8, 8, undefined]);
    for (const [x, y] of [
      [0, 0],
      [7, 0],
      [0, 7],
      [7, 7],
    ] as const)
      expect(pixel(png, x, y)).toEqual([...checkerPixel(x, y)]);

    const bmp = await decodeRaster(barsBmp());
    expect([bmp.width, bmp.height]).toEqual([6, 4]);
    BAR_COLOURS.forEach((c, x) => {
      expect(pixel(bmp, x, 0)).toEqual([...c, 255]);
      expect(pixel(bmp, x, 3)).toEqual([...c, 255]);
    });

    const tif = await decodeRaster(scanTif());
    expect([tif.width, tif.height, tif.bitonal]).toEqual([16, 8, true]);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        const [r] = pixel(tif, x, y);
        expect(r, `${x}, ${y}`).toBe(scanInk(x, y) ? 0 : 255);
      }
    }
  });

  it('commits an AC1032 DXF with the six images and their definitions', () => {
    const doc = readCadDocument(new Uint8Array(readFileSync(DIR + RASTER_DXF_NAME)));
    expect(doc.header?.versionString).toBe('AC1032');
    const { init } = openDocument(doc);
    const defs = (init.objects ?? []).filter((o): o is ImageDefinition => o.type === 'IMAGEDEF');
    expect(defs.map((d) => [d.name, d.fileName, d.loaded])).toEqual([
      ['checker', `.\\images\\${CHECKER_PNG}`, true],
      ['bars', `.\\images\\${BARS_BMP}`, true],
      ['scan', `.\\images\\${SCAN_TIF}`, true],
      ['site-photo', `.\\images\\${MISSING_JPG}`, true],
      ['checker-unloaded', `.\\images\\${CHECKER_PNG}`, false],
    ]);
    const byName = new Map(defs.map((d) => [d.handle, d.name]));
    const images = (init.entities ?? []).flatMap((e) =>
      e.geom.kind === 'IMAGE' ? [{ e, g: e.geom as ImageGeometry }] : [],
    );
    expect(images.map(({ g }) => byName.get(g.definition!))).toEqual([
      'checker',
      'bars',
      'checker',
      'scan',
      'site-photo',
      'checker-unloaded',
    ]);
    const [a, b, c, d] = images.map(({ g }) => g) as [
      ImageGeometry,
      ImageGeometry,
      ImageGeometry,
      ImageGeometry,
    ];
    expect(a).toMatchObject({ position: { x: 0, y: 0 }, size: { x: 8, y: 8 }, displayFlags: 11 });
    expect(a.u).toEqual({ x: 0.5, y: 0 });
    expect(b).toMatchObject({
      position: { x: 6, y: 0 },
      brightness: 60,
      contrast: 70,
      clipping: true,
      clip: { type: 'polygon', vertices: BARS_CLIP, inverted: false },
    });
    expect(Math.atan2(b.u.y, b.u.x)).toBeCloseTo(Math.PI / 6, 12);
    expect(c).toMatchObject({
      fade: 60,
      clipping: true,
      clip: { type: 'rectangle', vertices: CHECKER_HOLE, inverted: true },
    });
    expect(d).toMatchObject({ position: { x: 6, y: 6 }, displayFlags: 11 });
    expect(images[3]!.e.color).toMatchObject({ kind: 'aci', index: 1 });
  });
});
