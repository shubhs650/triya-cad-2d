// Entity moves and block order on every readable public corpus file (M1-75 part 24): what CHSPACE
// and the engine's `moveEntity` do. The first plain model-space entity (no reactors, so no
// associativity ties it to its block) moves to paper space, and the first other model-space
// entity moves to the end of model space. Both map back by handle, each block lists its mapped
// entities in the engine's order, and nothing else in the drawing changes: `structuralDiff`
// ignoring only the two block records, the moved entity and model space's draw order table
// reports nothing. A file that states no entity handles (before R11, R12 with $HANDLING 0) refuses
// both instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChangeSetBuilder, DocumentModel, type Entity, type Handle } from '@triya/engine';
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

const PLAIN = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POINT', 'TEXT', 'ELLIPSE']);

const blockNamed = (model: DocumentModel, name: string): Handle | undefined =>
  [...model.blocks.values()].find((d) => d.name.toUpperCase() === name)?.handle;

const entitiesOf = (model: DocumentModel, block: Handle): Entity[] =>
  model.blockEntities(block).map((id) => model.entity(id)!);

/** An entity as it maps back, without the session id and the reader's link. */
function comparable(e: Entity | undefined) {
  if (!e) return e;
  const { id: _id, raw: _raw, ...rest } = e;
  return rest;
}

describe('TriyaToAcad entity moves and order on the public corpus', () => {
  it.each(readable.map((f) => [f.path, f] as const))(
    'moves an entity to paper space and reorders model space in %s',
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
        const ms = blockNamed(model, '*MODEL_SPACE');
        const ps = blockNamed(model, '*PAPER_SPACE');
        if (!ms) return;
        const inMs = entitiesOf(model, ms);
        const moved = ps
          ? inMs.find((e) => PLAIN.has(e.type) && !e.reactors?.length && !e.extDict)
          : undefined;
        const last = inMs.find((e) => e !== moved && e.type !== 'VIEWPORT');
        // Nothing changes where no sheet takes an entity and the one to reorder is already last
        // (a model space of one entity, as ezdxf's R12_with_trash_beyond_EOF.dxf, M2-49).
        if (!moved && (!last || inMs.at(-1) === last)) return;
        const b = new ChangeSetBuilder(model);
        if (moved) b.moveEntity(moved.id, ps!);
        if (last) b.moveEntity(last.id, ms);
        model.apply(b.build());

        // A file that states no entity handles has them numbered in file order on read, so
        // the save refuses to move or reorder (packages/io/test/export-entity-order.test.ts).
        const madeUp = original.madeUpHandles;
        const numbered = [moved, last].some((e) => {
          const n = e ? Number.parseInt(e.handle, 16) : -1;
          return madeUp !== null && n >= madeUp.first && n <= madeUp.last;
        });
        if (numbered) {
          expect(() => exportDocument(readCadDocument(bytes), model, options), f.path).toThrow(
            /no entity handles/,
          );
          return;
        }
        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const back = DocumentModel.create(documentInit(reopened));
        for (const block of [ms, ps].filter((h): h is Handle => h !== undefined)) {
          expect(entitiesOf(back, block).map(comparable), `${f.path} ${block}`).toEqual(
            entitiesOf(model, block).map(comparable),
          );
        }

        const ignoreHandles = new Set<number>();
        for (const h of [ms, ps, moved?.handle]) if (h) ignoreHandles.add(Number.parseInt(h, 16));
        const table = [...model.objects.values()].find(
          (o) => o.type === 'SORTENTSTABLE' && (o as { block?: Handle }).block === ms,
        );
        if (table) ignoreHandles.add(Number.parseInt(table.handle, 16));
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences;
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
