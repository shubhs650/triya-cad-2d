// M1-103 on the public corpus: every XCLIPped reference draws its block's contents inside its
// clip, and its frame. A reference that has not moved since XCLIP made the filter stands where
// the filter's inverse insert transform undoes, so its clip in the drawing is the boundary as
// stored: an independent check of the clip's placement through the reference's own transform,
// on AutoCAD's files (ACadSharp's samples insert their block at 1/25.4) and ezdxf's xclip.dxf
// (rectangular, polygonal and inverted clips, one with XCLIP OFF).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InsertGeometry, SpatialFilter, Vec2 } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import { defaultPaint, expandInsert, insertClips, type BlockSource } from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** The stored boundary as the closed polygon it stands for (a rectangle for two points). */
function stored(f: SpatialFilter): Vec2[] {
  const b = f.boundary;
  if (b.length !== 2) return [...b];
  const [x0, x1] = [Math.min(b[0]!.x, b[1]!.x), Math.max(b[0]!.x, b[1]!.x)];
  const [y0, y1] = [Math.min(b[0]!.y, b[1]!.y), Math.max(b[0]!.y, b[1]!.y)];
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Where the clip should be drawn: through the filter's inverse insert transform into the block,
 * then out by the reference's DXF placement, p = position + R(rotation) · S(scale) · (b − base).
 */
function expected(f: SpatialFilter, g: InsertGeometry, base: Vec2): number[] {
  const m = f.inverseInsert;
  const c = Math.cos(g.rotation);
  const s = Math.sin(g.rotation);
  return stored(f).flatMap((p) => {
    const bx = m[0]! * p.x + m[1]! * p.y + m[3]! - base.x;
    const by = m[4]! * p.x + m[5]! * p.y + m[7]! - base.y;
    const sx = g.scale.x * bx;
    const sy = g.scale.y * by;
    return [g.position.x + c * sx - s * sy, g.position.y + s * sx + c * sy];
  });
}

describe('XCLIPped references on the public corpus (M1-103)', () => {
  let files = 0;
  let clipped = 0;
  for (const f of readable) {
    const text = f.format === 'dwg' ? '' : readFileSync(`${corpusDir}${f.path}`, 'latin1');
    if (f.format !== 'dwg' && !/AcDbSpatialFilter/.test(text)) continue;
    const { model } = corpusDrawing(
      readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`))),
    );
    const filters = [...model.objects.values()].filter(
      (o): o is SpatialFilter => o.type === 'SPATIAL_FILTER',
    );
    if (filters.length === 0) continue;
    files++;
    it(`draws each clipped reference of ${f.path} inside its stored boundary`, () => {
      const src: BlockSource = {
        model,
        paint: defaultPaint,
        insertContext: defaultPaint.insertContext,
        order: (block) => model.blockEntities(block),
        clip: insertClips(model),
      };
      const problems: string[] = [];
      for (const s of filters) {
        const id = model.ids.idOf(s.insert);
        const insert = id === undefined ? undefined : model.entity(id);
        if (!insert) {
          problems.push(`${s.handle}: no INSERT`);
          continue;
        }
        const { prims } = expandInsert(insert, src, { dashes: false });
        const inside = prims.filter((p) => p.clip);
        if (!s.enabled) {
          if (inside.length > 0) problems.push(`${s.handle}: clipped while XCLIP is off`);
          continue;
        }
        clipped++;
        if (inside.length === 0) problems.push(`${s.handle}: nothing drawn inside the clip`);
        const g = insert.geom as InsertGeometry;
        const want = expected(s, g, model.blocks.get(g.block)!.basePoint);
        const unmoved = stored(s).flatMap((p) => [p.x, p.y]);
        if (!f.path.includes('ezdxf') && want.some((v, i) => Math.abs(v - unmoved[i]!) > 1e-6)) {
          problems.push(`${s.handle}: an AutoCAD sample's reference moved since it was clipped`);
        }
        for (const p of inside) {
          const got = p.clip![p.clip!.length - 1]!;
          const off = got.some((v, i) => Math.abs(v - want[i]!) > 1e-9 * (1 + Math.abs(want[i]!)));
          if (got.length !== want.length || off) {
            problems.push(`${s.handle}: clip ${got.join(',')} is not ${want.join(',')}`);
            break;
          }
        }
        // The frame shows unless XCLIPFRAME is 0 (R2004 and R2007 store it as a 290 flag).
        const frame = model.header.get('$XCLIPFRAME');
        const framed = prims.filter((p) => !p.clip).length > 0;
        if (framed !== (frame !== 0 && frame !== false)) problems.push(`${s.handle}: frame`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('finds the clipped references', () => {
    expect(files).toBeGreaterThanOrEqual(21);
  });

  it('clips every reference whose XCLIP is on', () => {
    // Counted as the per-file tests run, before this one: 20 ACadSharp saves of one reference,
    // and xclip.dxf's 9 filters less the one with XCLIP OFF.
    expect(clipped).toBe(28);
  });
});
