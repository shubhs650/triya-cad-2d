// M1-14/M1-15/M1-17 on the public corpus: every INSERT, every DIMENSION with a stored `*D`
// block and every ACAD_TABLE with a stored `*T` block draws where the spatial index says it is.
// The index bounds a reference from its block's extents with its own transform code (M1-07),
// so this checks the renderer's placement against an independent computation, on real files,
// through nesting, MINSERT arrays and arrowheads. (A table whose block holds text is bounded
// by its grid's disc until text has metrics, M1-35.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Entity } from '@triya/engine';
import { readCadDocument } from '@triya/io';
import {
  PATH_A,
  PATH_C,
  PATH_E,
  PATH_L,
  PATH_M,
  PATH_Q,
  PATH_Z,
  defaultPaint,
  expandInsert,
  referenceOf,
  type BlockSource,
  type RenderPrimitive,
} from '@triya/render';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { corpusDrawing } from './document.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

/** The points a primitive's path passes through: move and line targets, arc and ellipse ends. */
function* points(p: RenderPrimitive): Generator<{ x: number; y: number }> {
  if (p.kind === 'point') return yield p;
  if (p.kind === 'infinite') return yield p.base;
  const path = p.path;
  for (let i = 0; i < path.length;) {
    const op = path[i]!;
    if (op === PATH_M || op === PATH_L) {
      yield { x: path[i + 1]!, y: path[i + 2]! };
      i += 3;
    } else if (op === PATH_A) {
      const [cx, cy, r, , a1] = path.slice(i + 1, i + 6) as number[];
      yield { x: cx! + r! * Math.cos(a1!), y: cy! + r! * Math.sin(a1!) };
      i += 7;
    } else if (op === PATH_E) {
      const [cx, cy, rx, ry, rot, , a1] = path.slice(i + 1, i + 8) as number[];
      const ux = rx! * Math.cos(a1!);
      const uy = ry! * Math.sin(a1!);
      yield {
        x: cx! + ux * Math.cos(rot!) - uy * Math.sin(rot!),
        y: cy! + ux * Math.sin(rot!) + uy * Math.cos(rot!),
      };
      i += 9;
    } else if (op === PATH_Q || op === PATH_C) {
      // A Bézier stays inside its control points' hull: its end point is the one that counts.
      const n = op === PATH_Q ? 2 : 3;
      yield { x: path[i + 2 * n - 1]!, y: path[i + 2 * n]! };
      i += 1 + 2 * n;
    } else if (op === PATH_Z) {
      i += 1;
    } else {
      throw new Error(`bad path command ${op}`);
    }
  }
}

describe('block references on the public corpus (M1-14, M1-15, M1-17)', () => {
  const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));

  it('draws every INSERT, stored dimension and stored table inside its spatial-index bounds', () => {
    const wrong: string[] = [];
    const drawn = {
      INSERT: 0,
      DIMENSION: 0,
      ARC_DIMENSION: 0,
      LARGE_RADIAL_DIMENSION: 0,
      ACAD_TABLE: 0,
    };
    for (const f of readable) {
      let doc;
      try {
        doc = readCadDocument(new Uint8Array(readFileSync(`${corpusDir}${f.path}`)));
      } catch {
        continue; // read failures are the round-trip suite's concern
      }
      const { model, index } = corpusDrawing(doc);
      const src: BlockSource = {
        model,
        paint: defaultPaint,
        insertContext: defaultPaint.insertContext,
        // Placement only: the order the parts draw in does not matter here.
        order: (block) => model.blockEntities(block),
      };
      const def = (h: string) => model.blocks.get(h);
      for (const block of model.blocks.keys()) {
        for (const id of model.blockEntities(block)) {
          const e: Entity | undefined = model.entity(id);
          if (!e || !referenceOf(e, def)) continue;
          const kind = e.geom.kind as keyof typeof drawn;
          const b = index.bounds(id);
          const { prims } = expandInsert(e, src, { dashes: false });
          if (prims.length > 0) drawn[kind]++;
          if (b?.kind !== 'box') continue;
          const { minX, minY, maxX, maxY } = b.box;
          const slack =
            1e-6 * Math.max(1, maxX - minX, maxY - minY, Math.abs(minX), Math.abs(maxX));
          for (const p of prims) {
            for (const q of points(p)) {
              if (
                q.x < minX - slack ||
                q.x > maxX + slack ||
                q.y < minY - slack ||
                q.y > maxY + slack
              ) {
                wrong.push(
                  `${f.path} ${kind} ${e.handle}: (${q.x}, ${q.y}) outside ` +
                    `[${minX}, ${minY}]–[${maxX}, ${maxY}]`,
                );
                break;
              }
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 20)).toEqual([]);
    // Counts at M1-15 part 1 (every dimension with a stored block draws), so a change that
    // stops references drawing shows here. Raise them when corpus files are added.
    expect(drawn.INSERT).toBeGreaterThanOrEqual(479);
    expect(drawn.DIMENSION).toBeGreaterThanOrEqual(258);
    expect(drawn.ARC_DIMENSION).toBeGreaterThanOrEqual(1);
    // The two jogged radius dimensions of uncommon.dxf (M1-34).
    expect(drawn.LARGE_RADIAL_DIMENSION).toBe(2);
    // M1-17: the two tables of each acadsharp sample (18 drawings).
    expect(drawn.ACAD_TABLE).toBeGreaterThanOrEqual(36);
  });
});
