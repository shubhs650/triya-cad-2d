// DIMASSOC edits on every readable public corpus file (M1-75 part 35): what grip edits of
// associated geometry, DIMDISASSOCIATE and ERASE do. Every DIMASSOC's snapped points move by one
// unit (the geometry having moved), the first is removed (DIMDISASSOCIATE, its dimension and
// geometry letting go of it), and the last dimension is erased with its DIMASSOC when there are
// three or more. The edits map back, and nothing else in the drawing changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChangeSetBuilder, DocumentModel, type DimAssoc, type Handle } from '@triya/engine';
import type { NonGraphicalObject } from '@triya/engine';
import { documentInit, exportDocument, readCadDocument, type CadFormat } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read twice and written once under full-suite load. */
const PER_FILE_BUDGET_MS = 10_000;

const assocsOf = (objects: Iterable<NonGraphicalObject> | undefined): DimAssoc[] =>
  [...(objects ?? [])].filter((o): o is DimAssoc => o.type === 'DIMASSOC');
const comparable = ({ raw: _raw, ...rest }: DimAssoc) => rest;
const geometryOf = (a: DimAssoc): Handle[] =>
  a.points.flatMap((p) => (p ? [...p.geometry, ...(p.intersection?.geometry ?? [])] : []));

describe('TriyaToAcad DIMASSOC edits on the public corpus', () => {
  let edited = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    'edits the DIMASSOCs of %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const assocs = assocsOf(model.objects.values());
        if (assocs.length === 0) return;
        edited++;

        const b = new ChangeSetBuilder(model);
        const reactors = (h: Handle, f: (rs: Handle[]) => Handle[]) => {
          const id = model.ids.idOf(h);
          const e = id === undefined ? undefined : b.entity(id);
          if (e) b.updateEntity(e.id, { reactors: f([...(e.reactors ?? [])]) });
        };
        const [first, ...rest] = assocs;
        const erased = assocs.length >= 3 ? rest.pop() : undefined;
        for (const a of [first!, ...(erased ? [erased] : [])]) {
          b.removeObject(a.handle);
          for (const h of new Set([a.dimension, ...geometryOf(a)])) {
            reactors(h, (rs) => rs.filter((x) => x !== a.handle));
          }
        }
        // ERASE takes the dimension out of its block's entity list.
        const gone = erased && model.entityByHandle(erased.dimension);
        const block = gone?.owner;
        // A dimension style lists the dimensions that override it in its reactors (the corpus's
        // custom_dim_style); acad-ts takes an erased one off, as AutoCAD's ERASE does.
        const style = gone && 'style' in gone.geom ? (gone.geom.style as Handle) : undefined;
        // ERASE also takes the dimension out of its block's draw order.
        const sorter = [...model.objects.values()].find(
          (o) => o.type === 'SORTENTSTABLE' && (o as { block?: Handle }).block === block,
        )?.handle;
        if (erased) b.removeEntity(model.ids.idOf(erased.dimension)!);
        for (const a of rest) {
          const points = a.points.map((p) =>
            p ? { ...p, point: { ...p.point, x: p.point.x + 1 } } : null,
          );
          b.updateObject(a.handle, { points } as Partial<NonGraphicalObject>);
        }
        model.apply(b.build());

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        expect(assocsOf(init.objects).map(comparable), f.path).toEqual(
          assocsOf(model.objects.values()).map(comparable),
        );
        const touched = new Set<Handle>(
          [first!, ...(erased ? [erased] : [])].flatMap((a) => [a.dimension, ...geometryOf(a)]),
        );
        const back = new Map(init.entities?.map((e) => [e.handle, e.reactors ?? []]));
        for (const h of touched) {
          expect(back.get(h) ?? [], `${f.path} ${h}`).toEqual(
            model.entityByHandle(h)?.reactors ?? [],
          );
        }
        // Nothing else changes: the DIMASSOCs, their dimensions' dictionaries and the reactors.
        const ignore = new Set(
          [
            ...assocs.map((a) => a.handle),
            ...assocs.map((a) => a.owner),
            ...touched,
            ...(block ? [block] : []),
            ...(style ? [style] : []),
            ...(sorter ? [sorter] : []),
          ].map((h) => Number.parseInt(h, 16)),
        );
        const diff = structuralDiff(original, reopened, {
          ignoreHandles: ignore,
        }).differences.filter((d) => !(d.handle === '0' && d.path.startsWith('$HANDSEED')));
        expect(
          diff.slice(0, 5).map((d) => `${d.handle} ${d.path}`),
          f.path,
        ).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('found DIMASSOCs to edit', () => {
    expect(edited).toBeGreaterThanOrEqual(23);
  });
});
