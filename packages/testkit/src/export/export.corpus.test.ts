// TriyaToAcad on the public corpus (M1-05, M1-75): a markup-style edit of every entity Triya can
// write (move it; grow circles and arcs, turn arcs, text, blocks and feature control frames) must save so that the edited
// entities map back to the edit, and every other object in the file comes back exactly as
// read: `structuralDiff` ignoring only the edited handles reports nothing (TESTING.md §3).
// The unedited save is the round-trip suite (roundtrip/corpus-roundtrip.test.ts).
import { readFileSync } from 'node:fs';
import { Insert, Polyline } from '@node-projects/acad-ts';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type EntityGeometry,
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
    default:
      throw new Error(`no edit for ${g.kind}`);
  }
}

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
        const b = new ChangeSetBuilder(model);
        for (const e of targets) b.updateEntity(e.id, { geom: edited(e.geom) });
        model.apply(b.build());

        const saved = exportDocument(readCadDocument(bytes), model, options);
        const reopened = readCadDocument(saved);
        const back = new Map(documentInit(reopened).entities?.map((e) => [e.handle, e]));
        const wrong = targets
          .map((e) => model.entity(e.id) as Entity)
          .filter((e) => !near(back.get(e.handle)?.geom, e.geom))
          .map((e) => `${e.type} ${e.handle}`);
        expect(wrong, f.path).toEqual([]);

        // A polyline's VERTEX entities and an INSERT's ATTRIBs are edited with it, under their
        // own handles.
        const ignoreHandles = new Set(targets.map((e) => Number.parseInt(e.handle, 16)));
        for (const h of [...ignoreHandles]) {
          const o = original.getCadObject(h);
          if (o instanceof Polyline) for (const v of o.vertices) ignoreHandles.add(v.handle);
          if (o instanceof Insert) for (const a of o.attributes) ignoreHandles.add(a.handle);
        }
        const diff = structuralDiff(original, reopened, { ignoreHandles });
        expect(diff.differences.slice(0, 5), f.path).toEqual([]);
      });
    },
    PER_FILE_BUDGET_MS,
  );
});
