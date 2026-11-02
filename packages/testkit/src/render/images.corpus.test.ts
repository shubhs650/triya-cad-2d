// M1-19 on the public corpus: every IMAGE names an IMAGEDEF the document holds, with the
// definition's pixel size; every clip boundary lies on the image (pixel coordinates centred on
// pixels, −½ … size − ½); and every IMAGE and WIPEOUT draws, its fill and frame inside the
// entity's bounds. No corpus file ships the bitmaps (`.\image1.jpg` and the rest are external
// files the samples never included), so drawing the pixels is checked on self-authored bitmaps
// in packages/render and against AutoCAD once M1-64's sample and plots exist.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ImageDefinition, ImageGeometry } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import { defaultPaint, tessellate, type RenderPrimitive } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const files = manifest.files.filter((f) => f.path.startsWith('public/'));

/** The points of a packed M / L / Z path. */
function points(path: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length;) {
    if (path[i] === 4) {
      i += 1;
      continue;
    }
    out.push([path[i + 1]!, path[i + 2]!]);
    i += 3;
  }
  return out;
}

let images = 0;
let wipeouts = 0;
let clipped = 0;
let definitions = 0;
// Ratchets: what the public corpus holds today (images.dxf, viewports.dxf and the acadsharp
// samples; the ezdxf wipeout files and the acadsharp samples' wipeout).
const IMAGES = 85;
const WIPEOUTS = 23;
const CLIPPED = 5;
const DEFINITIONS = 25;

describe('images on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    let doc;
    try {
      doc = readCadDocument(new Uint8Array(readFileSync(corpusDir + path)));
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const { model, index } = corpusDrawing(doc);
    for (const o of model.objects.values()) if (o.type === 'IMAGEDEF') definitions++;
    const bad: string[] = [];
    for (const e of model.entities()) {
      if (e.geom.kind !== 'IMAGE' && e.geom.kind !== 'WIPEOUT') continue;
      const id = model.ids.idOf(e.handle)!;
      const g: ImageGeometry = e.geom;
      const key = `${e.handle} ${g.kind}`;
      if (g.kind === 'IMAGE') {
        images++;
        const def = g.definition ? model.objects.get(g.definition) : undefined;
        if (def?.type !== 'IMAGEDEF') bad.push(`${key}: no IMAGEDEF ${g.definition}`);
        else if (
          (def as ImageDefinition).size.x !== g.size.x ||
          (def as ImageDefinition).size.y !== g.size.y
        )
          bad.push(`${key}: size differs from its IMAGEDEF`);
      } else wipeouts++;
      if (g.clipping || g.kind === 'WIPEOUT') {
        if (g.kind === 'IMAGE') clipped++;
        const off = g.clip.vertices.some(
          (v) =>
            v.x < -0.5 - 1e-6 ||
            v.y < -0.5 - 1e-6 ||
            v.x > g.size.x - 0.5 + 1e-6 ||
            v.y > g.size.y - 0.5 + 1e-6,
        );
        if (off) bad.push(`${key}: clip vertex off the image`);
      }
      const paint = defaultPaint(e, model) ?? { color: 'foreground' };
      const prims: RenderPrimitive[] = tessellate(g, paint);
      const fill = prims.find((p) => p.kind === 'fill');
      if (g.kind === 'IMAGE' && (g.displayFlags & 1) === 0) {
        // "Show image" off (images.dxf D3): the frame alone.
        if (fill || !prims.some((p) => p.kind === 'stroke')) bad.push(`${key}: not frame only`);
      } else if (!fill || !('path' in fill)) {
        bad.push(`${key}: no fill`);
        continue;
      } else if (g.kind === 'IMAGE' && !fill.image) bad.push(`${key}: no bitmap placement`);
      const b = index.bounds(id);
      if (b?.kind !== 'box') continue;
      const tol = 1e-6 * Math.max(1, b.box.maxX - b.box.minX, b.box.maxY - b.box.minY);
      for (const p of prims)
        if ('path' in p)
          for (const [x, y] of points(p.path))
            if (
              x < b.box.minX - tol ||
              x > b.box.maxX + tol ||
              y < b.box.minY - tol ||
              y > b.box.maxY + tol
            ) {
              bad.push(`${key}: draws outside its bounds`);
              break;
            }
    }
    expect(bad).toEqual([]);
  });

  it('covers every image, wipeout and image definition the corpus holds', () => {
    expect({ images, wipeouts, clipped, definitions }).toEqual({
      images: IMAGES,
      wipeouts: WIPEOUTS,
      clipped: CLIPPED,
      definitions: DEFINITIONS,
    });
  });
});
