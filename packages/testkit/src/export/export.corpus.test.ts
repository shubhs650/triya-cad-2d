// TriyaToAcad on the public corpus (M1-05, M1-75): a markup-style edit of every entity Triya can
// write (move it; grow circles and arcs, turn arcs, text, blocks and feature control frames;
// move hatches with their pattern origin, images, wipeouts, underlays, multilines, multileaders
// and viewport frames), with what the Layers palette and a markup session change outside the
// entities (every layer turned off or on, locked or unlocked and recoloured; $LTSCALE,
// $TEXTSIZE and the current layer), must save so that the edited entities, layers and header
// variables map back to the edit, and every other object in the file comes back exactly as
// read: `structuralDiff` ignoring only the edited handles and variables reports nothing
// (TESTING.md §3).
// The unedited save is the round-trip suite (roundtrip/corpus-roundtrip.test.ts).
import { readFileSync } from 'node:fs';
import { Insert, Polyline } from '@node-projects/acad-ts';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
  type HatchGeometry,
  type HeaderValue,
  type LayerRecord,
  type TextFields,
  type Vec2,
} from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  WRITABLE_TYPES,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = manifest.files.filter((f) => !f.knownIssues.some((k) => /read/i.test(k)));
const writable = new Set<string>(WRITABLE_TYPES);
/** Each file opens, maps, saves and reopens twice; the slowest takes about 1 s alone. */
const PER_FILE_BUDGET_MS = 10_000;

const D: Vec2 = { x: 0.5, y: -0.25 };
const move = (p: Vec2): Vec2 => ({ x: p.x + D.x, y: p.y + D.y });
const TURN = 0.1;
const TWO_PI = 2 * Math.PI;
const turn = (a: number): number => (a + TURN) % TWO_PI;

/** MOVE of a text frame (TEXT, ATTDEF, ATTRIB), with ROTATE in place. */
function movedText<T extends TextFields>(g: T): T {
  return {
    ...g,
    position: move(g.position),
    ...(g.alignmentPoint ? { alignmentPoint: move(g.alignmentPoint) } : {}),
    rotation: turn(g.rotation),
  };
}

type DimensionGeometry = Extract<
  EntityGeometry,
  { kind: 'DIMENSION' | 'ARC_DIMENSION' | 'LARGE_RADIAL_DIMENSION' }
>;

/** MOVE of a dimension: every point (its block, the drawn graphics, is not regenerated). */
function movedDimension(g: DimensionGeometry): EntityGeometry {
  const shared = { definitionPoint: move(g.definitionPoint), textPosition: move(g.textPosition) };
  switch (g.dimType) {
    case 'linear':
    case 'aligned':
    case 'angular3pt':
      return {
        ...g,
        ...shared,
        first: move(g.first),
        second: move(g.second),
        ...(g.dimType === 'angular3pt' ? { vertex: move(g.vertex) } : {}),
      } as EntityGeometry;
    case 'angular':
      return {
        ...g,
        ...shared,
        line1Start: move(g.line1Start),
        line1End: move(g.line1End),
        line2Start: move(g.line2Start),
        arcPoint: move(g.arcPoint),
      };
    case 'radius':
    case 'diameter':
      return { ...g, ...shared, chordPoint: move(g.chordPoint) };
    case 'ordinate':
      return { ...g, ...shared, feature: move(g.feature), leaderEnd: move(g.leaderEnd) };
    case 'jogged':
      return {
        ...g,
        ...shared,
        chordPoint: move(g.chordPoint),
        overrideCenter: move(g.overrideCenter),
        jogPoint: move(g.jogPoint),
      };
    case 'arc':
      return {
        ...g,
        ...shared,
        first: move(g.first),
        second: move(g.second),
        center: move(g.center),
        ...(g.leader ? { leader: [move(g.leader[0]), move(g.leader[1])] as const } : {}),
      };
  }
}

type HatchEdge = NonNullable<HatchGeometry['loops'][number]['edges']>[number];

function movedHatchEdge(e: HatchEdge): HatchEdge {
  switch (e.type) {
    case 'line':
      return { ...e, start: move(e.start), end: move(e.end) };
    case 'arc':
    case 'ellipse':
      return { ...e, center: move(e.center) };
    case 'spline':
      return {
        ...e,
        controlPoints: e.controlPoints.map(move),
        ...(e.fitPoints ? { fitPoints: e.fitPoints.map(move) } : {}),
      };
  }
}

/** MOVE of a hatch: its boundary, seed points and pattern origin (the boundary objects stay). */
function movedHatch(g: HatchGeometry): HatchGeometry {
  return {
    ...g,
    loops: g.loops.map((l) => ({
      ...l,
      ...(l.polyline
        ? {
            polyline: {
              ...l.polyline,
              vertices: l.polyline.vertices.map((v) => ({ ...v, ...move(v) })),
            },
          }
        : {}),
      ...(l.edges ? { edges: l.edges.map(movedHatchEdge) } : {}),
    })),
    seedPoints: g.seedPoints.map(move),
    patternLines: g.patternLines.map((l) => ({ ...l, base: move(l.base) })),
  };
}

/** The edit: what MOVE, SCALE (about the centre) and ROTATE (in place) would leave. */
function edited(g: EntityGeometry): EntityGeometry {
  switch (g.kind) {
    case 'LINE':
      return { ...g, start: move(g.start), end: move(g.end) };
    case 'XLINE':
    case 'RAY':
      return { ...g, base: move(g.base) };
    case 'CIRCLE':
      return { ...g, center: move(g.center), radius: g.radius * 2 };
    case 'ARC':
      return {
        ...g,
        center: move(g.center),
        radius: g.radius * 2,
        startAngle: turn(g.startAngle),
        endAngle: turn(g.endAngle),
      };
    case 'ELLIPSE':
      return { ...g, center: move(g.center) };
    case 'POINT':
      return { ...g, position: move(g.position) };
    case 'LWPOLYLINE':
      return { ...g, vertices: g.vertices.map((v) => ({ ...v, ...move(v) })) };
    case 'TEXT':
    case 'ATTDEF':
      return movedText(g);
    case 'INSERT':
      // MOVE takes the ATTRIBs along (a multiline one's embedded MTEXT too); ROTATE turns the
      // block about its insertion point.
      return {
        ...g,
        position: move(g.position),
        rotation: turn(g.rotation),
        attributes: g.attributes.map((a) => ({
          ...movedText(a),
          ...(a.mtext ? { mtext: { ...a.mtext, position: move(a.mtext.position) } } : {}),
        })),
      };
    case 'MTEXT':
      return { ...g, position: move(g.position), rotation: turn(g.rotation) };
    case 'SOLID':
    case '3DFACE': {
      const [a, b, c, d] = g.corners.map(move);
      return { ...g, corners: [a!, b!, c!, d!] };
    }
    case 'SPLINE':
      return {
        ...g,
        controlPoints: g.controlPoints.map(move),
        ...(g.fitPoints ? { fitPoints: g.fitPoints.map(move) } : {}),
      };
    case 'POLYLINE':
      return {
        ...g,
        vertices: g.vertices.map((v) => ({ ...v, ...move(v) })),
        ...(g.frame ? { frame: g.frame.map(move) } : {}),
      };
    case 'DIMENSION':
    case 'ARC_DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
      return movedDimension(g);
    case 'LEADER':
      return { ...g, vertices: g.vertices.map(move) };
    case 'TOLERANCE':
      return { ...g, position: move(g.position), rotation: turn(g.rotation) };
    case 'HATCH':
      return movedHatch(g);
    case 'IMAGE':
    case 'WIPEOUT':
    case 'PDFUNDERLAY':
      return { ...g, position: move(g.position) };
    case 'MLINE':
      return {
        ...g,
        start: move(g.start),
        vertices: g.vertices.map((v) => ({ ...v, position: move(v.position) })),
      };
    case 'MULTILEADER':
      return {
        ...g,
        contentBase: move(g.contentBase),
        ...(g.text ? { text: { ...g.text, position: move(g.text.position) } } : {}),
        ...(g.block ? { block: { ...g.block, position: move(g.block.position) } } : {}),
        branches: g.branches.map((b) => ({
          ...b,
          connection: move(b.connection),
          lines: b.lines.map((l) => ({ ...l, vertices: l.vertices.map(move) })),
        })),
      };
    case 'VIEWPORT':
      // MOVE of the frame in paper space; the view it shows stays.
      return { ...g, center: move(g.center) };
    default:
      throw new Error(`no edit for ${g.kind}`);
  }
}

/** The Layers palette's toggles and a colour change, on every layer. */
function editedLayer(l: LayerRecord): Partial<LayerRecord> {
  const index = l.color.kind === 'aci' && l.color.index === 3 ? 4 : 3;
  return { on: !l.on, locked: !l.locked, color: { kind: 'aci', index } };
}

/** Header variables a markup session changes: LTSCALE, TEXTSIZE and the current layer. */
function editedHeader(model: DocumentModel): Map<string, HeaderValue> {
  const out = new Map<string, HeaderValue>();
  const ltscale = model.header.get('$LTSCALE');
  const textsize = model.header.get('$TEXTSIZE');
  if (typeof ltscale === 'number') out.set('$LTSCALE', ltscale * 2);
  if (typeof textsize === 'number') out.set('$TEXTSIZE', textsize + 1);
  const current = model.header.get('$CLAYER');
  const other = [...model.tables.layers.values()].find((l) => l.name !== current);
  if (typeof current === 'string' && other) out.set('$CLAYER', other.name);
  return out;
}

/** A layer as it maps back: `raw` is the reader's link, and DXF 70 holds frozen/locked. */
function comparableLayer(l: LayerRecord | undefined): unknown {
  if (!l) return l;
  const { raw: _raw, flags, ...rest } = l;
  const others = (flags ?? 0) & ~5;
  return { ...rest, ...(others ? { flags: others } : {}) };
}

function edit(model: DocumentModel, e: Entity, geom: EntityGeometry): void {
  const b = new ChangeSetBuilder(model);
  b.updateEntity(e.id, { geom });
  model.apply(b.build());
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Equal up to float noise relative to the drawing's magnitude; angles compared mod 2π. */
function near(a: unknown, b: unknown, key = ''): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) <= tol) return true;
    if (/angle|rotation|param/i.test(key)) {
      const d = Math.abs(a - b) % TWO_PI;
      return Math.min(d, TWO_PI - d) <= 1e-9;
    }
    return false;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b);
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k),
  );
}

describe('TriyaToAcad edits on the public corpus', () => {
  it('covers the readable corpus', () => {
    expect(readable.length).toBeGreaterThan(100);
  });

  it('refuses an R12 viewport’s view, which lives in its MVIEW xdata (M1-86)', () => {
    const path = 'public/third-party/acadsharp/sample_AC1009_ascii.dxf';
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
    for (const changes of [
      { viewHeight: 1 },
      { twist: 0.5 },
      { frozenLayers: [] as string[], flags: 0 },
    ]) {
      const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
      const vp = [...model.entities()].find((e) => e.type === 'VIEWPORT')!;
      edit(model, vp, { ...vp.geom, ...changes } as EntityGeometry);

      expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
        /VIEWPORT .*M1-86/,
      );
    }
  });

  it('refuses an edit of the layer 0 an R12 file does not have (acad-ts makes it up)', () => {
    const path = 'public/third-party/ezdxf/examples_dxf/Minimal_DXF_AC1006.dxf';
    const bytes = new Uint8Array(readFileSync(`${corpusDir}${path}`));
    const model = DocumentModel.create(documentInit(readCadDocument(bytes)));
    const zero = [...model.tables.layers.values()].find((l) => l.name === '0')!;
    const b = new ChangeSetBuilder(model);
    b.updateTableRecord('layers', zero.handle, { color: { kind: 'aci', index: 3 } });
    model.apply(b.build());

    expect(() => exportDocument(readCadDocument(bytes), model, { format: 'dxf' })).toThrow(
      /layer 0 .*made it up/,
    );
  });

  it.each(readable.map((f) => [f.path, f] as const))(
    '%s',
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
        const targets = [...model.entities()].filter((e) => writable.has(e.type));
        // An R12 file without layer 0 reads with a made-up one, which saves only as read.
        const madeUp = original.madeUpHandles?.added;
        const layers = [...model.tables.layers.values()].filter(
          (l) => !madeUp?.has(Number.parseInt(l.handle, 16)),
        );
        const header = editedHeader(model);
        const b = new ChangeSetBuilder(model);
        for (const e of targets) b.updateEntity(e.id, { geom: edited(e.geom) });
        for (const l of layers) b.updateTableRecord('layers', l.handle, editedLayer(l));
        for (const [name, value] of header) b.setHeader(name, value);
        model.apply(b.build());

        const saved = exportDocument(readCadDocument(bytes), model, options);
        const reopened = readCadDocument(saved);
        const init = documentInit(reopened);
        const back = new Map(init.entities?.map((e) => [e.handle, e]));
        const wrong = targets
          .map((e) => model.entity(e.id) as Entity)
          .filter((e) => !near(back.get(e.handle)?.geom, e.geom))
          .map((e) => `${e.type} ${e.handle}`);
        expect(wrong, f.path).toEqual([]);
        const backLayers = new Map(init.tables?.layers?.map((l) => [l.handle, l]));
        const wrongLayers = layers
          .map((l) => model.tables.layers.get(l.handle)!)
          .filter((l) => !same(comparableLayer(backLayers.get(l.handle)), comparableLayer(l)))
          .map((l) => l.name);
        expect(wrongLayers, f.path).toEqual([]);
        const backHeader = new Map(init.header);
        expect(
          [...header.keys()].filter((n) => !same(backHeader.get(n), header.get(n))),
          f.path,
        ).toEqual([]);

        // A polyline's VERTEX entities and an INSERT's ATTRIBs are edited with it, under their
        // own handles.
        const ignoreHandles = new Set(
          [...targets, ...layers].map((e) => Number.parseInt(e.handle, 16)),
        );
        for (const h of [...ignoreHandles]) {
          const o = original.getCadObject(h);
          if (o instanceof Polyline) for (const v of o.vertices) ignoreHandles.add(v.handle);
          if (o instanceof Insert) for (const a of o.attributes) ignoreHandles.add(a.handle);
        }
        // The edited variables, and the header's current-layer record ($CLAYER), are the edit.
        const diff = structuralDiff(original, reopened, { ignoreHandles }).differences.filter(
          (d) =>
            d.handle !== '0' ||
            ![...header.keys(), '_currentLayer'].some(
              (n) => d.path === n || d.path.startsWith(`${n}.`),
            ),
        );
        expect(diff.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
