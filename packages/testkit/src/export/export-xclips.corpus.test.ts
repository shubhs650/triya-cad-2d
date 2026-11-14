// XCLIP edits on every readable public corpus file (M1-75 part 40): what XCLIP's options do. The
// first clip of a file is turned off and given front and back clipping planes (ON/OFF,
// Clipdepth), the second gets a new boundary drawn after its reference moved (New boundary;
// refused on an inverted clip, whose extension dictionary keeps the inner boundary), the third is
// removed (Delete), and the first single block reference without a clip in a file from R14 on is
// clipped (a first XCLIP, which makes its dictionaries). The edits map back, and nothing else in
// the drawing changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACadVersion } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type Handle,
  type NonGraphicalObject,
  type SpatialFilter,
} from '@triya/engine';
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

/** The filters in handle order (a file lists its objects in an order of its own). */
const filtersOf = (objects: Iterable<NonGraphicalObject> | undefined): SpatialFilter[] =>
  [...(objects ?? [])]
    .filter((o): o is SpatialFilter => o.type === 'SPATIAL_FILTER')
    .sort((a, b) => Number.parseInt(a.handle, 16) - Number.parseInt(b.handle, 16));
const comparable = ({ raw: _raw, ...rest }: SpatialFilter) => rest;

/** The 3×4 inverse of a reference's transform (plan view: scale, turn about +Z, move). */
function inverseOf(e: Entity): number[] {
  const g = e.geom as {
    position: { x: number; y: number };
    scale: { x: number; y: number; z: number };
    rotation: number;
  };
  const c = Math.cos(g.rotation);
  const s = Math.sin(g.rotation);
  const { x: sx, y: sy, z: sz } = g.scale;
  const { x, y } = g.position;
  // Block point p = S⁻¹ · R⁻¹ · (w − t). A file stores no negative zero (DXF writes 0.0, DWG
  // its zero bit code), so none is made here.
  const r0 = [c / sx, s / sx];
  const r1 = [-s / sy, c / sy];
  // prettier-ignore
  return [
    r0[0]!, r0[1]!, 0, -(r0[0]! * x + r0[1]! * y),
    r1[0]!, r1[1]!, 0, -(r1[0]! * x + r1[1]! * y),
    0, 0, 1 / sz, 0,
  ].map((v) => v + 0);
}

describe('TriyaToAcad XCLIP edits on the public corpus', () => {
  let clipped = 0;
  let made = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    'edits, removes and makes the clips of %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const original = readCadDocument(bytes);
        const version = original.header?.version ?? ACadVersion.AC1032;
        const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
        const filters = filtersOf(model.objects.values());
        const target =
          version >= ACadVersion.AC1014
            ? [...model.entities()].find(
                (e) =>
                  e.geom.kind === 'INSERT' &&
                  !e.geom.array &&
                  !filters.some((s) => s.insert === e.handle),
              )
            : undefined;
        if (filters.length === 0 && !target) return;
        if (filters.length > 0) clipped++;

        const b = new ChangeSetBuilder(model);
        const [off, reshaped, deleted] = filters;
        if (off) {
          b.updateObject(off.handle, {
            enabled: !off.enabled,
            frontClip: 1.5,
            backClip: -2.5,
          } as Partial<NonGraphicalObject>);
        }
        if (reshaped && reshaped.extDict === undefined) {
          b.updateObject(reshaped.handle, {
            boundary: reshaped.boundary.map((p) => ({ x: p.x + 1, y: p.y - 1 })),
            inverseInsert: reshaped.inverseInsert.map((v, i) =>
              i === 3 ? v - 1 : i === 7 ? v + 1 : v,
            ),
          } as Partial<NonGraphicalObject>);
        }
        if (deleted) b.removeObject(deleted.handle);
        const fresh: Handle[] = [];
        if (target) {
          made++;
          const xdict = target.extDict ?? model.handles.allocate();
          if (target.extDict === undefined) {
            b.updateEntity(target.id, { extDict: xdict });
            fresh.push(xdict);
          }
          const owner = model.handles.allocate();
          fresh.push(owner);
          const g = target.geom as { position: { x: number; y: number } };
          const { x, y } = g.position;
          fresh.push(
            b.addObject({
              type: 'SPATIAL_FILTER',
              owner,
              reactors: [owner],
              insert: target.handle,
              boundary: [
                { x: x - 1, y: y - 1 },
                { x: x + 1, y: y + 1 },
              ],
              normal: { x: 0, y: 0, z: 1 },
              origin: { x: 0, y: 0, z: 0 },
              enabled: true,
              inverseInsert: inverseOf(target),
              boundaryTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            } as Omit<SpatialFilter, 'handle'>).handle,
          );
        }
        model.apply(b.build());

        const reopened = readCadDocument(exportDocument(readCadDocument(bytes), model, options));
        const init = documentInit(reopened);
        expect(filtersOf(init.objects).map(comparable), f.path).toEqual(
          filtersOf(model.objects.values()).map(comparable),
        );
        if (target) {
          const back = init.entities?.find((e) => e.handle === target.handle);
          expect(back?.extDict, f.path).toBe(model.entityByHandle(target.handle)!.extDict);
        }
        // Nothing else changes: the filters, the ACAD_FILTER dictionary a removed one leaves, the
        // clipped reference and the dictionaries made for it.
        const ignoreHandles = new Set(
          [
            ...[off, reshaped, deleted].flatMap((s) => (s ? [s.handle] : [])),
            ...(deleted ? [deleted.owner] : []),
            ...(target ? [target.handle] : []),
            ...(target?.extDict ? [target.extDict] : []),
            ...fresh,
          ].map((h) => Number.parseInt(h, 16)),
        );
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) => !(d.handle === '0' && d.path.startsWith('$HANDSEED')),
        );
        expect(
          diff.slice(0, 5).map((d) => `${d.handle} ${d.path}`),
          f.path,
        ).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('found clips to edit and references to clip', () => {
    expect(clipped).toBeGreaterThanOrEqual(21);
    expect(made).toBeGreaterThanOrEqual(21);
  });
});
