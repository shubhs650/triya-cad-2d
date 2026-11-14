// REGIONs edited on every readable public corpus file that has one (M1-75 part 39): each is
// turned 30° about a point, scaled by 1.5 and moved, as ROTATE, SCALE and MOVE do, and the
// save writes the motion into its ACIS body's transform record. The reopened file maps the
// edited boundary back, and nothing else changes: the regions are the only differences. A
// mirrored region is refused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type RegionGeometry,
  type RegionLoop,
  type Vec2,
} from '@triya/engine';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  UnsupportedChangeError,
  type CadFormat,
} from '@triya/io';
import { describe, expect, it } from 'vitest';
import { loadManifest, readableFiles } from '../corpus/manifest.ts';
import { sniffCadFile } from '../corpus/sniff.ts';
import { withPinnedClock } from '../roundtrip/clock.ts';
import { structuralDiff } from '../roundtrip/diff.ts';

const corpusDir = fileURLToPath(new URL('../../../../corpus/', import.meta.url));
const manifest = loadManifest(`${corpusDir}corpus.json`);
const readable = readableFiles(manifest);

/** Generous for the largest corpus files read four times and written once under load. */
const PER_FILE_BUDGET_MS = 15_000;

type Edge = RegionLoop['edges'][number];

/** ROTATE by `a` about `c`, SCALE by `k` about `c`, then MOVE by `d`, as kernel curves move. */
function rotateScaleMove(a: number, k: number, c: Vec2, d: Vec2) {
  const p = (q: Vec2): Vec2 => ({
    x: c.x + k * ((q.x - c.x) * Math.cos(a) - (q.y - c.y) * Math.sin(a)) + d.x,
    y: c.y + k * ((q.x - c.x) * Math.sin(a) + (q.y - c.y) * Math.cos(a)) + d.y,
  });
  const edge = (e: Edge): Edge => {
    switch (e.kind) {
      case 'LINE':
        return { ...e, start: p(e.start), end: p(e.end) };
      case 'ARC':
        return {
          ...e,
          center: p(e.center),
          radius: k * e.radius,
          startAngle: e.startAngle + a,
          endAngle: e.endAngle + a,
        };
      case 'CIRCLE':
        return { ...e, center: p(e.center), radius: k * e.radius };
      case 'ELLIPSE': {
        const v = e.majorAxis;
        const major = {
          x: k * (v.x * Math.cos(a) - v.y * Math.sin(a)),
          y: k * (v.x * Math.sin(a) + v.y * Math.cos(a)),
        };
        return { ...e, center: p(e.center), majorAxis: major };
      }
    }
  };
  return (g: RegionGeometry): RegionGeometry => ({
    ...g,
    loops: g.loops.map((l) => ({ ...l, edges: l.edges.map(edge) })),
  });
}

/** Mirrored about the vertical line through `x0`; arcs keep running counter-clockwise. */
function mirror(x0: number) {
  const m = (p: Vec2): Vec2 => ({ x: 2 * x0 - p.x, y: p.y });
  const edge = (e: Edge): Edge => {
    switch (e.kind) {
      case 'LINE':
        return { ...e, start: m(e.start), end: m(e.end) };
      case 'ARC':
        return {
          ...e,
          center: m(e.center),
          startAngle: Math.PI - e.endAngle,
          endAngle: Math.PI - e.startAngle,
        };
      case 'CIRCLE':
        return { ...e, center: m(e.center) };
      case 'ELLIPSE':
        return {
          ...e,
          center: m(e.center),
          majorAxis: { x: -e.majorAxis.x, y: e.majorAxis.y },
          startParam: -e.endParam,
          endParam: -e.startParam,
        };
    }
  };
  return (g: RegionGeometry): RegionGeometry => ({
    ...g,
    loops: g.loops.map((l) => ({ ...l, edges: l.edges.map(edge) })),
  });
}

/** Numbers equal to 1e-9 of the largest coordinate; angles compared on the circle. */
function close(actual: unknown, expected: unknown, eps: number, path: string): void {
  if (typeof expected === 'number') {
    const a = actual as number;
    const d = /Angle|Param$/.test(path)
      ? Math.abs(Math.atan2(Math.sin(a - expected), Math.cos(a - expected)))
      : Math.abs(a - expected);
    expect(d, `${path}: ${String(actual)} vs ${expected}`).toBeLessThanOrEqual(eps);
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      close((actual as Record<string, unknown>)[k], v, eps, `${path}.${k}`);
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

const regions = (model: DocumentModel): Entity[] =>
  [...model.entities()].filter((e) => e.geom.kind === 'REGION');

/** A point of the region's boundary to turn and scale about. */
const pivot = (g: RegionGeometry): Vec2 => {
  const e = g.loops[0]!.edges[0]!;
  return e.kind === 'LINE' ? e.start : e.center;
};

let edited = 0;

describe('TriyaToAcad REGIONs on the public corpus', () => {
  const files = readable.filter(
    (f) =>
      f.format === 'dwg' ||
      /AcDbModelerGeometry/.test(readFileSync(`${corpusDir}${f.path}`, 'latin1')),
  );
  it.each(files.map((f) => [f.path, f] as const))(
    'turns, scales and moves the REGIONs of %s',
    (_path, f) => {
      const bytes = new Uint8Array(readFileSync(`${corpusDir}${f.path}`));
      const { format } = sniffCadFile(bytes);
      const options = {
        format: (format === 'dwg' ? 'dwg' : 'dxf') as CadFormat,
        binary: format === 'dxf-binary',
      };
      withPinnedClock(() => {
        const open = (from: Uint8Array): DocumentModel =>
          DocumentModel.create(documentInit(readCadDocument(from)));
        const model = open(bytes);
        const targets = regions(model);
        if (targets.length === 0) return;

        // Refused: a mirror image.
        const mirrored = open(bytes);
        const m0 = new ChangeSetBuilder(mirrored);
        const first = regions(mirrored)[0]!;
        const g0 = first.geom as RegionGeometry;
        m0.updateEntity(first.id, { geom: mirror(pivot(g0).x)(g0) });
        mirrored.apply(m0.build());
        expect(() => exportDocument(readCadDocument(bytes), mirrored, options), f.path).toThrow(
          UnsupportedChangeError,
        );

        const b = new ChangeSetBuilder(model);
        for (const e of targets) {
          const g = e.geom as RegionGeometry;
          b.updateEntity(e.id, {
            geom: rotateScaleMove(Math.PI / 6, 1.5, pivot(g), { x: 12.5, y: -7.25 })(g),
          });
        }
        model.apply(b.build());
        const saved = exportDocument(readCadDocument(bytes), model, options);

        const back = new Map(regions(open(saved)).map((e) => [e.handle, e.geom]));
        for (const e of regions(model)) {
          const g = e.geom as RegionGeometry;
          const size = Math.max(
            1,
            ...g.loops.flatMap((l) =>
              l.edges.flatMap((x) =>
                x.kind === 'LINE'
                  ? [Math.abs(x.start.x), Math.abs(x.start.y)]
                  : [Math.abs(x.center.x), Math.abs(x.center.y)],
              ),
            ),
          );
          close(back.get(e.handle), g, 1e-9 * size, `${f.path} ${e.handle}`);
        }
        const differences = structuralDiff(readCadDocument(bytes), readCadDocument(saved), {
          ignoreHandles: new Set(targets.map((e) => Number.parseInt(e.handle, 16))),
        }).differences.slice(0, 5);
        expect(differences, f.path).toEqual([]);
        edited += targets.length;
      });
    },
    PER_FILE_BUDGET_MS,
  );

  it('edited the REGION of every ACadSharp sample', () => {
    // One in each DWG (R14 to R2018 and the base sample) and each ASCII and binary DXF.
    expect(edited).toBeGreaterThanOrEqual(19);
  });
});
