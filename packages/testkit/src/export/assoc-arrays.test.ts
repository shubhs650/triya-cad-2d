// Associative arrays read from a file (M3-03 part 2; PRD FR-D2 "associative array objects
// preserved from files"): an array AutoCAD made is an INSERT of an anonymous block with the
// ACDBASSOC* objects that make it editable. Triya cannot edit those (their DXF form is not
// documented, #379), so it keeps them: a save writes them back untouched, and the array can be
// moved, turned, scaled, mirrored, copied and erased as the block reference it is. The drawing
// is authored (roundtrip/assoc-array-drawing.ts).
import type { CadDocument } from '@node-projects/acad-ts';
import { UnknownNonGraphicalObject } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  copyObjects,
  DocumentModel,
  eraseObjects,
  mirrorIn,
  moveBy,
  scaleAbout,
  transformObjects,
  turnAbout,
  type Similarity,
} from '@triya/engine';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';
import { roundTrip } from '../roundtrip/roundtrip.ts';
import {
  ASSOC_ARRAY,
  ASSOC_OBJECT_NAMES,
  assocArrayDrawing,
} from '../roundtrip/assoc-array-drawing.ts';

const drawing = assocArrayDrawing();

/** The drawing opened, edited by `edit`, saved as AC1032 DXF and reopened. */
function edited(edit: (b: ChangeSetBuilder, model: DocumentModel) => void): {
  original: CadDocument;
  reopened: CadDocument;
  model: DocumentModel;
} {
  return withPinnedClock(() => {
    const original = readCadDocument(drawing.bytes);
    const kept = readCadDocument(drawing.bytes);
    const model = DocumentModel.create(documentInit(kept));
    const b = new ChangeSetBuilder(model);
    edit(b, model);
    model.apply(b.build());
    const reopened = readCadDocument(saveAc1032Dxf(kept, model));
    return { original, reopened, model };
  });
}

const arrayId = (model: DocumentModel) => model.ids.idOf(drawing.insert)!;
const handleOf = (h: string) => Number.parseInt(h, 16);

/** The association objects as the reopened file holds them: name and codes, by handle. */
function assocObjects(doc: CadDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of drawing.assoc) {
    const o = doc.getCadObject(handleOf(h));
    if (!o) continue;
    const codes = o instanceof UnknownNonGraphicalObject ? JSON.stringify(o.rawDxfCodes) : '';
    out.set(h, `${o.objectName} ${codes}`);
  }
  return out;
}

describe('associative arrays read from a file', () => {
  it('reads as AutoCAD keeps one: an INSERT of an anonymous block of item INSERTs', () => {
    const model = DocumentModel.create(documentInit(readCadDocument(drawing.bytes)));
    const array = model.entity(arrayId(model))!;
    expect(array.geom).toMatchObject({
      kind: 'INSERT',
      block: drawing.arrayBlock,
      position: ASSOC_ARRAY.position,
    });
    expect(array.reactors).toEqual([drawing.assoc[4]]);
    const items = model.blockEntities(drawing.arrayBlock).map((id) => model.entity(id)!.geom);
    expect(items).toHaveLength(ASSOC_ARRAY.columns * ASSOC_ARRAY.rows);
    expect(items.every((g) => g.kind === 'INSERT' && g.block === drawing.sourceBlock)).toBe(true);
    const doc = readCadDocument(drawing.bytes);
    expect(drawing.assoc.map((h) => doc.getCadObject(handleOf(h))?.objectName)).toEqual([
      ...ASSOC_OBJECT_NAMES,
    ]);
  });

  it('saves back with no structural difference and every association object kept', () => {
    const r = roundTrip(drawing.bytes);
    expect(r.status, JSON.stringify(r.sample)).toBe('clean');
    expect(r.rawObjects).toEqual({ kept: 4, lost: [] });
  });

  const transforms: [string, Similarity][] = [
    ['MOVE', moveBy({ x: 30, y: -12 })],
    ['ROTATE', turnAbout({ x: 100, y: 50 }, Math.PI / 6)],
    ['SCALE', scaleAbout({ x: 100, y: 50 }, 2)],
    ['MIRROR', mirrorIn({ x: 0, y: 0 }, { x: 0, y: 1 })],
  ];

  it.each(transforms)('%s carries the array and keeps its association objects', (_name, t) => {
    const { original, reopened, model } = edited((b, m) => {
      transformObjects(b, m, [arrayId(m)], t);
    });
    const moved = reopened.getCadObject(handleOf(drawing.insert));
    expect(moved?.objectName).toBe('INSERT');
    expect(moved?.reactors?.map((r: { handle: number }) => r.handle)).toEqual([
      handleOf(drawing.assoc[4]!),
    ]);
    expect(model.entity(arrayId(model))!.reactors).toEqual([drawing.assoc[4]]);
    const report = structuralDiff(original, reopened, {
      ignoreHandles: new Set([handleOf(drawing.insert)]),
    });
    expect(report.differences).toEqual([]);
    expect(assocObjects(reopened)).toEqual(assocObjects(original));
  });

  it('COPY makes a plain block reference showing the same items, outside the association', () => {
    let copy = '';
    const { original, reopened } = edited((b, m) => {
      const r = copyObjects(b, m, [arrayId(m)], moveBy({ x: 0, y: 100 }));
      copy = b.entity(r.ids[0]!)!.handle;
    });
    const c = reopened.getCadObject(handleOf(copy)) as unknown as {
      objectName: string;
      reactors?: unknown[];
      block: { handle: number };
    };
    expect(c.objectName).toBe('INSERT');
    expect(c.reactors ?? []).toEqual([]);
    expect(c.block.handle).toBe(handleOf(drawing.arrayBlock));
    // Model space lists the copy among its entities; nothing else changes.
    const space = original.modelSpace!.handle;
    const report = structuralDiff(original, reopened, {
      ignoreHandles: new Set([handleOf(copy), space]),
    });
    expect(report.differences).toEqual([]);
  });

  it('ERASE removes the array and keeps the association objects as they were', () => {
    const { original, reopened } = edited((b, m) => {
      eraseObjects(b, m, [arrayId(m)]);
    });
    expect(reopened.getCadObject(handleOf(drawing.insert))).toBeNull();
    expect(assocObjects(reopened)).toEqual(assocObjects(original));
    // The array and source blocks stay in the drawing, unreferenced.
    const space = original.modelSpace!.handle;
    const report = structuralDiff(original, reopened, {
      ignoreHandles: new Set([handleOf(drawing.insert), space]),
    });
    expect(report.differences).toEqual([]);
  });
});
