// HATCH on every readable public corpus file (M4-07 part 1): a rectangle with a circle inside
// it and an area closed by a spline and a line are drawn away from the drawing's own objects,
// then hatched by pick points: the rectangle less the circle with the default pattern (line and
// arc edges, the circle an island), the spline's area solid (a spline edge), and the circle with
// user-defined lines. Part 2: the rectangle hatched again on a layer -HATCH makes, in green,
// 40% transparent, its boundaries kept as polylines. Part 3: the spline's area filled with an
// inverted spherical gradient, red to a true colour, at 30° and not centred, and the rectangle
// hatched once more with a pale blue background colour. The drawing is saved as AC1032 DXF
// (DEC-047) and read back by acad-ts: each hatch maps back as it was made, its loops' edges of
// the same types, still drawn behind its boundary (HPDRAWORDER, a SORTENTSTABLE entry), the
// gradient and the background colour (HATCHBACKGROUNDCOLOR xdata) as they were made.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  blockDrawOrder,
  builtinCommands,
  sortTableOf,
  type Entity,
  type HatchGeometry,
  type ViewReply,
  type ViewRequest,
} from '@triya/engine';
import { bundledPatterns, patternLines } from '@triya/hatch';
import { documentInit, readCadDocument } from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { saveAc1032Dxf } from '../dxf-audit/saves.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);
const PER_FILE_BUDGET_MS = 30_000;
/** Every readable file gets the hatches. */
const HATCHED = readable.length;

type Hatch = Entity & { geom: HatchGeometry };

/** Far from every corpus drawing's objects. */
const X = -777_000;
const Y = -777_000;
const at = (x: number, y: number) => `${X + x},${Y + y}`;

const library = bundledPatterns();

/** The app's side: a view of the area drawn in, and the bundled patterns. */
function view(r: ViewRequest): Promise<ViewReply> {
  if (r.op === 'get') {
    return Promise.resolve({
      ok: true,
      view: { center: { x: X + 100, y: Y + 50 }, width: 300, height: 200, paper: false },
    });
  }
  if (r.op === 'hatchPattern') {
    const p = library.get(r.name);
    if (!p) return Promise.resolve({ ok: false, message: 'unknown' });
    return Promise.resolve({
      ok: true,
      pattern: { name: p.name, custom: false, lines: r.placements.map((o) => patternLines(p, o)) },
    });
  }
  return Promise.resolve({ ok: false, message: 'no view' });
}

/** Numbers to 9 significant figures, so geometry compares across the DXF's 16-digit text. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Number(v.toPrecision(9)) + 0;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, rounded(x)]),
    );
  }
  return v;
}

const unedited = (bytes: Uint8Array) =>
  withPinnedClock(() => DocumentModel.create(documentInit(readCadDocument(bytes))));

/** The block's objects by handle, in the order they are drawn. */
function drawn(model: DocumentModel, block: string): string[] {
  const table = sortTableOf(new ChangeSetBuilder(model), model, block);
  return blockDrawOrder(model, block, table).map((e) => model.ids.handleOf(e.id)!);
}

const edgeTypes = (g: HatchGeometry) => g.loops.map((l) => (l.edges ?? []).map((e) => e.type));

describe('HATCH on the public corpus (M4-07)', () => {
  let hatched = 0;

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s saves the hatches made, which read back as made',
    async (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const model = unedited(bytes);
      const bus = new PromptBus({ model, registry: builtinCommands(), view: { request: view } });
      const before = new Set([...model.entities()].map((e) => e.id));
      const script = [
        ...['RECTANG', at(0, 0), at(100, 100)],
        ...['CIRCLE', at(50, 50), '20'],
        ...['SPLINE', at(120, 0), at(150, 80), at(180, 0), ''],
        ...['LINE', at(110, 0), at(190, 0), ''],
        ...['-HATCH', at(10, 10), ''],
        ...['-HATCH', 'P', 'S', at(150, 20), ''],
        ...['-HATCH', 'P', 'U', '30', '2', 'Y', at(50, 50), ''],
        ...['-HATCH', 'LA', 'TRIYA-HATCH-M4', 'CO', '3', '', 'T', '40', 'A', 'R', 'Y', ''],
        ...[at(10, 10), ''],
        ...['-HATCH', 'A', 'R', 'N', '', 'P', 'G', 'GR_INVSPH', '30', 'N'],
        ...['CO', '1', 'T', '10,20,30', at(150, 20), ''],
        ...['-HATCH', 'P', 'TRIYA_LINES45', '', '', 'CO', '.', 'T', '200,220,240', at(10, 10), ''],
      ];
      for (const answer of script) await bus.submit(answer);
      expect(bus.promptText, f.path).toBe('Command:');
      const hatches = [...model.entities()].filter(
        (e): e is Hatch => !before.has(e.id) && e.geom.kind === 'HATCH',
      );
      expect(hatches.map((h) => edgeTypes(h.geom))).toEqual([
        [['line', 'line', 'line', 'line'], ['arc']],
        [expect.arrayContaining(['line', 'spline'])],
        [['arc']],
        [['line', 'line', 'line', 'line'], ['arc']],
        [expect.arrayContaining(['line', 'spline'])],
        [['line', 'line', 'line', 'line'], ['arc']],
      ]);
      expect(hatches.map((h) => [h.geom.pattern, h.geom.patternType])).toEqual([
        ['TRIYA_LINES45', 1],
        ['SOLID', 1],
        ['_USER', 0],
        ['_USER', 0],
        ['SOLID', 1],
        ['TRIYA_LINES45', 1],
      ]);
      expect(hatches[4]!.geom.gradient).toMatchObject({ name: 'INVSPHERICAL', shift: 1 });
      expect(hatches[5]!.geom.background).toEqual({ kind: 'rgb', r: 200, g: 220, b: 240 });
      const rectangle = [...model.entities()].find(
        (e) => !before.has(e.id) && e.geom.kind === 'LWPOLYLINE',
      )!;
      const kept = [...model.entities()].filter(
        (e) => !before.has(e.id) && e.geom.kind === 'LWPOLYLINE' && e.id !== rectangle.id,
      );
      expect(kept, f.path).toHaveLength(2);

      const save = withPinnedClock(() => saveAc1032Dxf(readCadDocument(bytes), model));
      const back = unedited(save);
      const order = drawn(back, rectangle.owner);
      const last = hatches[3]!;
      const lastBack = back.entityByHandle(last.handle)!;
      expect(back.tables.layers.get(lastBack.layer)?.name, f.path).toBe('TRIYA-HATCH-M4');
      expect(lastBack.color, f.path).toEqual({ kind: 'aci', index: 3 });
      expect(lastBack.transparency, f.path).toEqual({ alpha: 153 });
      for (const k of kept) expect(back.entityByHandle(k.handle), f.path).toBeDefined();
      for (const h of hatches) {
        // Behind its boundary: the first and last hatches behind the rectangle.
        if (h === hatches[0] || h === last || h === hatches[5]) {
          expect(order.indexOf(h.handle), f.path).toBeLessThan(order.indexOf(rectangle.handle));
        }
        const reread = back.entityByHandle(h.handle) as Hatch | undefined;
        expect(reread, f.path).toBeDefined();
        expect(edgeTypes(reread!.geom), f.path).toEqual(edgeTypes(h.geom));
        expect(rounded(reread!.geom.loops), f.path).toEqual(rounded(h.geom.loops));
        expect(rounded(reread!.geom.patternLines), f.path).toEqual(rounded(h.geom.patternLines));
        expect(reread!.geom, f.path).toMatchObject({
          pattern: h.geom.pattern,
          solid: h.geom.solid,
          associative: false,
          style: h.geom.style,
          patternType: h.geom.patternType,
          double: h.geom.double,
        });
        expect(rounded(reread!.geom.gradient), f.path).toEqual(rounded(h.geom.gradient));
        expect(reread!.geom.background, f.path).toEqual(h.geom.background);
      }
      hatched++;
    },
    PER_FILE_BUDGET_MS,
  );

  it('hatched every readable drawing', () => {
    expect(hatched).toBe(HATCHED);
  });
});
