// M1-46 on the public corpus: every LWPOLYLINE and 2D POLYLINE with a width (the acadsharp
// samples' tapered and arc segments, constant widths in the ezdxf files) draws its wide
// segments filled, each outline running through the segment's own vertices' offsets, and is
// bounded by what it draws. Those with a linetype (M1-66) draw their dashes as pieces of the
// same outlines, inside the same bounds.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { polylineWidths } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import { createPaint, defaultPaint, PATH_Z, tessellate } from '@triya/render';
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
    if (path[i] === PATH_Z) {
      i += 1;
      continue;
    }
    out.push([path[i + 1]!, path[i + 2]!]);
    i += 3;
  }
  return out;
}

let wide = 0;
let arcs = 0;
let tapered = 0;
let dashed = 0;
const styled = createPaint();
// Ratchets: what the public corpus holds today.
const WIDE = 73;
const ARCS = 23;
const TAPERED = 45;
// No public corpus file has a wide polyline with a linetype today; the dashing itself is checked
// in render/test/wide-linetype.test.ts, and this keeps a sample added later checked here.
const DASHED = 0;

describe('polyline widths on the public corpus', () => {
  it.each(files.map((f) => [f.path]))('%s', (path) => {
    let doc;
    try {
      doc = readCadDocument(new Uint8Array(readFileSync(corpusDir + path)));
    } catch {
      return; // unreadable files are the read-error baseline's business
    }
    const { model, index } = corpusDrawing(doc);
    const bad: string[] = [];
    for (const e of model.entities()) {
      const g = e.geom;
      if (g.kind !== 'LWPOLYLINE' && g.kind !== 'POLYLINE') continue;
      const widths = polylineWidths(g);
      if (!widths) continue;
      wide++;
      if (widths.some((v) => v.bulge !== 0)) arcs++;
      if (widths.some((v) => v.startWidth !== v.endWidth)) tapered++;
      const key = `${e.handle} ${g.kind}`;
      const paint = defaultPaint(e, model) ?? { color: 'foreground' };
      const prims = tessellate(g, paint);
      const fill = prims.find((p) => p.kind === 'fill');
      const anyWide = widths.some(
        (v, i) =>
          (v.startWidth !== 0 || v.endWidth !== 0) &&
          (g.closed || i < widths.length - 1) &&
          (v.x !== widths[(i + 1) % widths.length]!.x ||
            v.y !== widths[(i + 1) % widths.length]!.y),
      );
      if (anyWide && (!fill || !('path' in fill))) {
        bad.push(`${key}: wide but not filled`);
        continue;
      }
      const drawn = prims.flatMap((p) => ('path' in p ? points(p.path) : []));
      // With its linetype: dashes cut from the same outlines, which stay beside them whole.
      const lt = styled(e, model);
      if (lt?.linetype && fill && 'path' in fill) {
        const dashedPrims = tessellate(g, lt);
        const pieces = dashedPrims.find((p) => p.kind === 'fill');
        if (pieces && 'path' in pieces && pieces.continuous) {
          dashed++;
          if (pieces.continuous.join() !== fill.path.join())
            bad.push(`${key}: dashed outline differs from the continuous one`);
          drawn.push(...points(pieces.path));
        }
      }
      const size = Math.max(1, ...drawn.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
      // Every wide segment's outline reaches half its start width out from its start vertex
      // (exactly there with a square end, further at a mitre).
      if (fill && 'path' in fill) {
        const pts = points(fill.path);
        widths.forEach((v, i) => {
          const h = v.startWidth / 2;
          if (h === 0 || (!g.closed && i === widths.length - 1)) return;
          const reaches = pts.some(([x, y]) => Math.hypot(x - v.x, y - v.y) >= h - 1e-6 * size);
          if (!reaches) bad.push(`${key}: segment ${i} drawn narrower than its width`);
        });
      }
      const b = index.bounds(model.ids.idOf(e.handle)!);
      if (b?.kind !== 'box') {
        bad.push(`${key}: bounds ${b?.kind}`);
        continue;
      }
      const tol = 1e-9 * size;
      const outside = drawn.some(
        ([x, y]) =>
          x < b.box.minX - tol ||
          x > b.box.maxX + tol ||
          y < b.box.minY - tol ||
          y > b.box.maxY + tol,
      );
      if (outside) bad.push(`${key}: draws outside its bounds`);
    }
    expect(bad).toEqual([]);
  });

  it('covers every wide polyline the corpus holds', () => {
    expect({ wide, arcs, tapered, dashed }).toEqual({
      wide: WIDE,
      arcs: ARCS,
      tapered: TAPERED,
      dashed: DASHED,
    });
  });
});
