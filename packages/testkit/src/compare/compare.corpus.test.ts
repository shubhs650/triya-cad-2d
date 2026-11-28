// The compare engine (M8-05) on revised public corpus pairs, the acceptance "diff tests on
// revised corpus pairs". Every readable corpus drawing is revised the way a drafter revises
// one, with the engine's own change sets: one entity erased, one moved, one recoloured and a
// line drawn. The revision is saved as AC1032 DXF (DEC-047) and read again, and COMPARE of the
// original with the revision must list exactly those four changes; COMPARE of the drawing with
// its own unedited save must list none. DWG files are left out (DEC-047: save is DXF only, and a
// DWG's own reading disagrees with its DXF save's in four places, post-launch task M8-08).
// ACadSharp's sample saved as ASCII and binary DXF of one release is a pair with no differences,
// and its R2013 and R2018 saves are a real revision: AutoCAD's sample gained MTEXT columns, a
// multiline attribute and a changed block between them.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type Handle,
} from '@triya/engine';
import { compareDrawings, type CompareItem } from '@triya/compare';
import { documentInit, readCadDocument, saveDxf } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { eachCorpusFile } from '../corpus/each-file.ts';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);

const read = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));
const bytesOf = (path: string) => new Uint8Array(readFileSync(`${corpusDir}${path}`));

/** Model space's block record. */
function modelSpace(model: DocumentModel): Handle {
  for (const r of model.tables.blockRecords.values()) {
    if (r.name.toUpperCase() === '*MODEL_SPACE') return r.handle;
  }
  throw new Error('no model space');
}

/** `g` moved by (dx, 0), for the simple shapes the revision moves. */
function moved(g: EntityGeometry, dx: number): EntityGeometry {
  const p = <T extends { x: number; y: number }>(q: T): T => ({ ...q, x: q.x + dx });
  switch (g.kind) {
    case 'LINE':
      return { ...g, start: p(g.start), end: p(g.end) };
    case 'CIRCLE':
    case 'ARC':
      return { ...g, center: p(g.center) };
    case 'POINT':
      return { ...g, position: p(g.position) };
    case 'LWPOLYLINE':
      return { ...g, vertices: g.vertices.map((v) => p(v)) };
    default:
      throw new Error(`cannot move ${g.kind}`);
  }
}

const SIMPLE = new Set(['LINE', 'CIRCLE', 'ARC', 'POINT', 'LWPOLYLINE']);

/** An entity nothing else refers to (no group, associative hatch or dimension reactors). */
const free = (e: Entity) =>
  SIMPLE.has(e.type) && (e.reactors?.length ?? 0) === 0 && e.extDict === undefined;

const brief = (items: readonly CompareItem[]) =>
  items.map((i) => ({ status: i.status, a: i.a, b: i.b, changes: i.changes }));

let files = 0;
let revised = 0;
let compared = 0;

describe('COMPARE on revised public corpus pairs (M8-05)', () => {
  eachCorpusFile(
    readableFiles(manifest).filter((f) => f.format !== 'dwg'),
    (f) => {
      const bytes = bytesOf(f.path);
      withPinnedClock(() => {
        const original = read(bytes);
        files++;
        compared += original.entityCount;

        // The drawing and its own save: nothing changed.
        const same = read(saveDxf(readCadDocument(bytes), original));
        const r0 = compareDrawings(original, same);
        expect(brief(r0.items), f.path).toEqual([]);

        // The revision: erase, move, recolour and draw in model space.
        const ms = modelSpace(original);
        const model = read(bytes);
        const targets = model
          .blockEntities(ms)
          .map((id) => model.entity(id)!)
          .filter(free)
          .slice(0, 3);
        if (targets.length < 3) return;
        const [erased, shifted, recoloured] = targets as [Entity, Entity, Entity];
        const layer0 = [...model.tables.layers.values()].find((l) => l.name === '0')!;
        const b = new ChangeSetBuilder(model);
        b.removeEntity(erased.id);
        b.updateEntity(shifted.id, { geom: moved(shifted.geom, 7) });
        const red = recoloured.color.kind === 'aci' && recoloured.color.index === 1 ? 3 : 1;
        b.updateEntity(recoloured.id, { color: { kind: 'aci', index: red } });
        const drawn = b.addEntity({
          owner: ms,
          layer: layer0.handle,
          geom: { kind: 'LINE', start: { x: -1e3, y: -1e3 }, end: { x: -2e3, y: -1e3 } },
        });
        model.apply(b.build());
        const revision = read(saveDxf(readCadDocument(bytes), model));
        revised++;

        const r = compareDrawings(original, revision);
        const expected: ReturnType<typeof brief> = [
          { status: 'removed', a: erased.handle, b: undefined, changes: [] },
          { status: 'modified', a: shifted.handle, b: shifted.handle, changes: ['geometry'] },
          { status: 'modified', a: recoloured.handle, b: recoloured.handle, changes: ['color'] },
        ];
        expected.sort((x, y) => order(original, ms, x.a) - order(original, ms, y.a));
        expected.push({ status: 'added', a: undefined, b: drawn.handle, changes: [] });
        expect(brief(r.items), f.path).toEqual(expected);
        expect(r.counts.unchanged, f.path).toBe(r0.counts.unchanged - 3);
        // The other way round, the revision's changes are undone.
        const back = compareDrawings(revision, original);
        expect(back.counts, f.path).toEqual({ ...r.counts, added: 1, removed: 1 });
        expect(back.items.find((i) => i.status === 'removed')?.a, f.path).toBe(drawn.handle);
      });
    },
    () => {
      // ACadSharp's samples, ezdxf's examples and the self-authored drawings with simple shapes.
      expect(files).toBeGreaterThanOrEqual(100);
      expect(revised).toBeGreaterThan(40);
      expect(compared).toBeGreaterThan(15_000);
    },
  );

  it('finds nothing between the ASCII and binary DXF saves of one release', () => {
    const dir = 'public/third-party/acadsharp/';
    for (const v of ['AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032']) {
      const ascii = read(bytesOf(`${dir}sample_${v}_ascii.dxf`));
      const binary = read(bytesOf(`${dir}sample_${v}_binary.dxf`));
      const r = compareDrawings(ascii, binary);
      expect(brief(r.items), v).toEqual([]);
      expect(r.counts.unchanged, v).toBe(ascii.entityCount - blockEntityCount(ascii));
      expect(r.unchanged.every((p) => p.matchedBy === 'handle')).toBe(true);
    }
  });

  it('lists what AutoCAD’s sample gained between its R2013 and R2018 saves', () => {
    const dir = 'public/third-party/acadsharp/';
    const r2013 = read(bytesOf(`${dir}sample_AC1027_ascii.dxf`));
    const r2018 = read(bytesOf(`${dir}sample_AC1032_ascii.dxf`));
    const r = compareDrawings(r2013, r2018);
    expect(
      r.items.map((i) => [i.status, i.a, i.type, i.changes.join(' '), i.fields.join(' ')]),
    ).toEqual([
      ['modified', '3EC', 'MTEXT', 'geometry', 'columns'],
      ['modified', '3F5', 'MTEXT', 'geometry', 'columns'],
      ['modified', '3F6', 'MTEXT', 'geometry', 'columns'],
      ['modified', '779', 'MTEXT', 'geometry', 'columns'],
      ['modified', '783', 'INSERT', 'block', ''],
      ['modified', '79C', 'INSERT', 'attributes block', 'attributes'],
    ]);
    expect(r.counts).toEqual({ added: 0, removed: 0, modified: 6, unchanged: 157 });
  });
});

/** Entities inside block definitions, which COMPARE does not list. */
function blockEntityCount(model: DocumentModel): number {
  let n = 0;
  for (const e of model.entities()) {
    const name = model.tables.blockRecords.get(e.owner)?.name.toUpperCase() ?? '';
    if (name !== '*MODEL_SPACE' && !name.startsWith('*PAPER_SPACE')) n++;
  }
  return n;
}

/** Where an entity stands in model space's order, for the expected list's order. */
function order(model: DocumentModel, ms: Handle, h: Handle | undefined): number {
  return model.blockEntities(ms).findIndex((id) => model.entity(id)?.handle === h);
}
