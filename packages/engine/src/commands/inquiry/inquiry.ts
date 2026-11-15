// The inquiry commands (M3-07): ID, DIST, AREA and MEASUREGEOM, with AutoCAD 2024's prompts and
// the lines they write (AutoCAD 2024 Help, "ID (Command)", "DIST (Command)", "AREA (Command)",
// "MEASUREGEOM (Command)"). They read the drawing and change nothing; lengths, angles and areas
// are written in the drawing's units (units.ts: RTOS and ANGTOS with LUNITS/LUPREC and
// AUNITS/AUPREC). Their results set the session's AREA, PERIMETER and DISTANCE variables, which
// AutoCAD does not save with the drawing ("Not saved" in each variable's help page).
//
//   ID          Specify point:
//               X = 3.0000     Y = 4.0000     Z = 0.0000
//   DIST        Specify first point:
//               Specify second point or [Multiple points]:
//               Distance = 14.1421,  Angle in XY Plane = 45,  Angle from XY Plane = 0
//               Delta X = 10.0000,  Delta Y = 10.0000,  Delta Z = 0.0000
//   AREA        Specify first corner point or [Object/Add area/Subtract area] <Object>:
//               Specify next point or [Length/Undo/Total] <Total>:
//               Area = 50.0000, Perimeter = 30.0000
//   MEASUREGEOM Enter an option [Distance/Radius/Angle/ARea/Volume] <Distance>:
//               (again after each measurement, with eXit, the default)
//
// AutoCAD's "next point" prompts also offer Arc (an arc segment drawn as PLINE's are); Triya
// offers it when PLINE's arc segments exist (M3-01), and MEASUREGEOM's Quick mode (measuring
// what the cursor hovers over) is M3-07's next part. The help pages show the result lines but
// not every space in them: the spacing above is AutoCAD 2024's command line as commonly quoted.
import type { Arc, Line } from '../../geom/curves';
import { explodePolyline } from '../../geom/eval';
import { closestPoint } from '../../geom/closest';
import { toleranceForSize } from '../../geom/tolerance';
import type { Vec2 } from '../../geom/types';
import { angleOf, distance, dot, length, normalize, sub, add, scale, cross } from '../../geom/vec';
import type { DocumentModel } from '../../model/document';
import type { Entity, EntityGeometry, LineGeometry } from '../../model/types';
import type { CommandContext, CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatAngle, formatDistance, type DrawingUnits } from '../units';
import { areaText, measureObject, measurePolygon, volumeText, type Measured } from './measure';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** The AREA, PERIMETER and DISTANCE variables: the last results, per drawing, 0 at first. */
interface InquiryResults {
  area: number;
  perimeter: number;
  distance: number;
}

const RESULTS = new WeakMap<DocumentModel, InquiryResults>();

/** The last area, perimeter and distance an inquiry command measured in `model`. */
export function inquiryResults(model: DocumentModel): Readonly<InquiryResults> {
  let r = RESULTS.get(model);
  if (!r) RESULTS.set(model, (r = { area: 0, perimeter: 0, distance: 0 }));
  return r;
}

const results = (ctx: CommandContext) => inquiryResults(ctx.model) as InquiryResults;
const unitsOf = (ctx: CommandContext): DrawingUnits => drawingUnits(ctx.model.header);

/** An angle as MEASUREGEOM Angle writes it: `90°` in decimal degrees, ANGTOS's form otherwise. */
function angleText(radians: number, u: DrawingUnits): string {
  const text = formatAngle(radians, u);
  return u.aunits === 0 ? `${text}°` : text;
}

/** ID's line, and DIST's two lines, for points `a` to `b`. */
function distanceLines(a: Vec2, b: Vec2, u: DrawingUnits): [string, string] {
  const d = (v: number) => formatDistance(v, u);
  const delta = sub(b, a);
  return [
    `Distance = ${d(length(delta))},  Angle in XY Plane = ${formatAngle(angleOf(delta), u)},  Angle from XY Plane = ${formatAngle(0, u)}`,
    `Delta X = ${d(delta.x)},  Delta Y = ${d(delta.y)},  Delta Z = ${d(0)}`,
  ];
}

const pathLength = (points: readonly Vec2[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0);

const segmentsOf = (points: readonly Vec2[], closed: boolean): LineGeometry[] => {
  const lines: LineGeometry[] = points
    .slice(1)
    .map((p, i) => ({ kind: 'LINE', start: points[i]!, end: p }));
  if (closed && points.length > 2) {
    lines.push({ kind: 'LINE', start: points.at(-1)!, end: points[0]! });
  }
  return lines;
};

/**
 * The points after the first of a measured path ("Specify next point or [Length/Undo/Total]"),
 * until Enter or Total: undefined when the command is cancelled. `closed` previews the polygon
 * closed back to the first point (AREA); `report` writes the running total after each point
 * (DIST Multiple points).
 */
async function* nextPoints(
  ctx: CommandContext,
  first: Vec2,
  o: { readonly prefix: string; readonly closed: boolean; readonly report?: boolean },
): Sub<Vec2[] | undefined> {
  const points: Vec2[] = [first];
  const total = () => {
    if (o.report) ctx.message(`Distance = ${formatDistance(pathLength(points), unitsOf(ctx))}`);
  };
  for (;;) {
    ctx.preview(segmentsOf(points, o.closed));
    const enough = points.length >= (o.closed ? 3 : 2);
    const last = points.at(-1)!;
    const a = yield ctx.prompt.point({
      message: `${o.prefix}Specify next point or`,
      options: enough ? ['Length', 'Undo', 'Total'] : ['Length', 'Undo'],
      ...(enough && { default: { kind: 'keyword', keyword: 'Total' } }),
      rubberBand: { from: last },
    });
    if (a.kind === 'point') {
      points.push(a.point);
      total();
    } else if (a.kind === 'keyword' && a.keyword === 'Length') {
      // PLINE's Length: on in the last segment's direction (east before there is one).
      const before = points.at(-2);
      const dir = before ? normalize(sub(last, before)) : { x: 1, y: 0 };
      const l = yield ctx.prompt.distance({ message: 'Specify length of line', base: last });
      if (l.kind !== 'distance') {
        if (l.kind === 'enter') continue;
        ctx.preview([]);
        return undefined;
      }
      points.push(add(last, scale(dir, l.value)));
      total();
    } else if (a.kind === 'keyword' && a.keyword === 'Undo') {
      if (points.length > 1) {
        points.pop();
        total();
      } else ctx.message('All segments already undone.');
    } else if (a.kind === 'enter' || (a.kind === 'keyword' && a.keyword === 'Total')) {
      ctx.preview([]);
      return points;
    } else {
      ctx.preview([]);
      return undefined;
    }
  }
}

/** "Select …": the object picked, and where; 'enter' for Enter, undefined when cancelled. */
async function* pickObject(
  ctx: CommandContext,
  message: string,
): Sub<{ entity: Entity; at: Vec2 | undefined } | 'enter' | undefined> {
  const a = yield ctx.prompt.selection({ message, single: true });
  if (a.kind !== 'selection') return a.kind === 'enter' ? 'enter' : undefined;
  if (a.ids.length === 0) return 'enter';
  const entity = ctx.model.entity(a.ids[0]!);
  return entity ? { entity, at: a.pick } : 'enter';
}

// --- ID ---------------------------------------------------------------------------------------

function idCommand(): CommandDef {
  return {
    name: 'ID',
    transparent: true,
    usesSelection: 'none',
    async *run(ctx) {
      const a = yield ctx.prompt.point({ message: 'Specify point' });
      if (a.kind !== 'point') return;
      // The bus makes the point LASTPOINT, as ID does in AutoCAD.
      const d = (v: number) => formatDistance(v, unitsOf(ctx));
      ctx.message(`X = ${d(a.point.x)}     Y = ${d(a.point.y)}     Z = ${d(0)}`);
    },
  };
}

// --- DIST and MEASUREGEOM Distance -----------------------------------------------------------

async function* measureDistance(ctx: CommandContext): Sub<boolean> {
  const a = yield ctx.prompt.point({ message: 'Specify first point' });
  if (a.kind !== 'point') return false;
  const first = a.point;
  const b = yield ctx.prompt.point({
    message: 'Specify second point or',
    options: ['Multiple points'],
    rubberBand: { from: first },
  });
  if (b.kind === 'point') {
    for (const line of distanceLines(first, b.point, unitsOf(ctx))) ctx.message(line);
    results(ctx).distance = distance(first, b.point);
    return true;
  }
  if (b.kind !== 'keyword') return false;
  const points = yield* nextPoints(ctx, first, { prefix: '', closed: false, report: true });
  if (!points) return false;
  const total = pathLength(points);
  ctx.message(`Distance = ${formatDistance(total, unitsOf(ctx))}`);
  results(ctx).distance = total;
  return true;
}

function distCommand(): CommandDef {
  return {
    name: 'DIST',
    transparent: true,
    usesSelection: 'none',
    async *run(ctx) {
      yield* measureDistance(ctx);
    },
  };
}

// --- AREA, MEASUREGEOM ARea and Volume ---------------------------------------------------------

type Mode = 'none' | 'add' | 'subtract';

/** "Area = …, Perimeter = …" (or Circumference, or an open object's Length). */
function areaLine(m: Measured, u: DrawingUnits): string {
  return `Area = ${areaText(m.area, u)}, ${m.label} = ${formatDistance(m.perimeter, u)}`;
}

/**
 * AREA's prompts, or MEASUREGEOM's ARea (`exit`: eXit offered at once) and Volume (`volume`:
 * each area asks for a height and is written as a volume). Add and Subtract keep a running
 * total until eXit or Enter; without them one area ends it. Returns whether it measured.
 */
async function* measureArea(
  ctx: CommandContext,
  o: { readonly exit: boolean; readonly volume: boolean },
): Sub<boolean> {
  const noun = o.volume ? 'volume' : 'area';
  const addOption = `Add ${noun}`;
  const subtractOption = `Subtract ${noun}`;
  let mode: Mode = 'none';
  let total = 0;
  let measured = false;

  /** Writes one measurement; false when its height was not given. */
  async function* report(m: Measured): Sub<boolean> {
    const u = unitsOf(ctx);
    let value = m.area;
    if (o.volume) {
      const h = yield ctx.prompt.distance({ message: 'Specify height' });
      if (h.kind !== 'distance') return false;
      value = m.area * Math.abs(h.value);
      ctx.message(`Volume = ${volumeText(value, u)}`);
    } else ctx.message(areaLine(m, u));
    measured = true;
    const r = results(ctx);
    r.perimeter = m.perimeter;
    if (mode === 'none') {
      if (!o.volume) r.area = m.area;
      return true;
    }
    total += mode === 'add' ? value : -value;
    if (!o.volume) r.area = total;
    ctx.message(
      o.volume ? `Total volume = ${volumeText(total, u)}` : `Total area = ${areaText(total, u)}`,
    );
    return true;
  }

  for (;;) {
    const options: string[] =
      mode === 'none'
        ? ['Object', addOption, subtractOption, ...(o.exit ? ['eXit'] : [])]
        : ['Object', mode === 'add' ? subtractOption : addOption, 'eXit'];
    const a: PromptAnswer = yield ctx.prompt.point({
      message: 'Specify first corner point or',
      options,
      ...(mode === 'none' && { default: { kind: 'keyword', keyword: 'Object' } }),
    });
    const prefix = mode === 'none' ? '' : `(${mode.toUpperCase()} mode) `;
    if (a.kind === 'point') {
      const points = yield* nextPoints(ctx, a.point, { prefix, closed: true });
      if (!points) return measured;
      if (!(yield* report(measurePolygon(points)))) return measured;
      if (mode === 'none') return true;
      continue;
    }
    if (a.kind !== 'keyword') return measured;
    if (a.keyword === 'eXit') return measured;
    if (a.keyword === addOption || a.keyword === subtractOption) {
      mode = a.keyword === addOption ? 'add' : 'subtract';
      continue;
    }
    // Object: one object; in Add or Subtract mode, objects until Enter.
    for (;;) {
      const picked = yield* pickObject(ctx, `${prefix}Select objects`);
      if (picked === undefined) return measured;
      if (picked === 'enter') {
        if (mode === 'none') return measured;
        break;
      }
      const m = measureObject(picked.entity.geom);
      if (!m) {
        ctx.message('Selected object does not have an area.');
        continue;
      }
      if (!(yield* report(m))) return measured;
      if (mode === 'none') return true;
    }
  }
}

function areaCommand(): CommandDef {
  return {
    name: 'AREA',
    transparent: true,
    usesSelection: 'none',
    async *run(ctx) {
      yield* measureArea(ctx, { exit: false, volume: false });
    },
  };
}

// --- MEASUREGEOM Radius and Angle --------------------------------------------------------------

/** The arc or circle `g` is, or for a polyline the arc segment nearest `at`. */
function arcOf(g: EntityGeometry, at: Vec2 | undefined): { radius: number } | undefined {
  if (g.kind === 'CIRCLE' || g.kind === 'ARC') return g;
  if (g.kind !== 'LWPOLYLINE' && g.kind !== 'POLYLINE') return undefined;
  const pieces = explodePolyline({ kind: 'LWPOLYLINE', vertices: g.vertices, closed: g.closed });
  const size = Math.max(1, ...g.vertices.map((v) => Math.max(Math.abs(v.x), Math.abs(v.y))));
  const tol = toleranceForSize(size);
  let best: Line | Arc | undefined;
  let bestD = Infinity;
  for (const piece of pieces) {
    const d = at ? closestPoint(piece, at, tol).distance : piece.kind === 'ARC' ? 0 : Infinity;
    if (d < bestD) {
      bestD = d;
      best = piece;
    }
  }
  return best?.kind === 'ARC' ? best : undefined;
}

async function* measureRadius(ctx: CommandContext): Sub<boolean> {
  for (;;) {
    const picked = yield* pickObject(ctx, 'Select arc or circle');
    if (picked === undefined || picked === 'enter') return false;
    const arc = arcOf(picked.entity.geom, picked.at);
    if (!arc) {
      ctx.message('Select an arc or a circle.');
      continue;
    }
    const u = unitsOf(ctx);
    ctx.message(`Radius = ${formatDistance(arc.radius, u)}`);
    ctx.message(`Diameter = ${formatDistance(2 * arc.radius, u)}`);
    results(ctx).distance = arc.radius;
    return true;
  }
}

/** The angle at `vertex` between the directions to `a` and `b`, 0 to π. */
function angleAt(vertex: Vec2, a: Vec2, b: Vec2): number {
  const u = sub(a, vertex);
  const v = sub(b, vertex);
  return Math.abs(Math.atan2(cross(u, v), dot(u, v)));
}

/** Where two lines (taken as unbounded) meet; undefined when they are parallel. */
function meet(l1: Line, l2: Line): Vec2 | undefined {
  const d1 = sub(l1.end, l1.start);
  const d2 = sub(l2.end, l2.start);
  const den = cross(d1, d2);
  if (Math.abs(den) <= 1e-12 * length(d1) * length(d2)) return undefined;
  const t = cross(sub(l2.start, l1.start), d2) / den;
  return add(l1.start, scale(d1, t));
}

/** The end of a line farther from `from`: the side of the line a pick off its end means. */
const farEnd = (l: Line, from: Vec2): Vec2 =>
  distance(l.start, from) >= distance(l.end, from) ? l.start : l.end;

async function* measureAngle(ctx: CommandContext): Sub<boolean> {
  const u = unitsOf(ctx);
  const done = (radians: number) => {
    ctx.message(`Angle = ${angleText(radians, u)}`);
    return true;
  };
  for (;;) {
    const picked = yield* pickObject(ctx, 'Select arc, circle, line, or <Specify vertex>');
    if (picked === undefined) return false;
    if (picked === 'enter') {
      const v = yield ctx.prompt.point({ message: 'Specify angle vertex' });
      if (v.kind !== 'point') return false;
      const a = yield ctx.prompt.point({
        message: 'Specify first angle endpoint',
        rubberBand: { from: v.point },
      });
      if (a.kind !== 'point') return false;
      const b = yield ctx.prompt.point({
        message: 'Specify second angle endpoint',
        rubberBand: { from: v.point },
      });
      if (b.kind !== 'point') return false;
      return done(angleAt(v.point, a.point, b.point));
    }
    const g = picked.entity.geom;
    if (g.kind === 'ARC') {
      const sweep = g.endAngle - g.startAngle;
      return done(sweep <= 0 ? sweep + 2 * Math.PI : sweep);
    }
    if (g.kind === 'CIRCLE') {
      // The point picked on the circle is the first end of the angle, its centre the vertex.
      const first = picked.at ?? add(g.center, { x: g.radius, y: 0 });
      const b = yield ctx.prompt.point({
        message: 'Specify second angle endpoint',
        rubberBand: { from: g.center },
      });
      if (b.kind !== 'point') return false;
      return done(angleAt(g.center, first, b.point));
    }
    if (g.kind === 'LINE') {
      const second = yield* pickObject(ctx, 'Select second line');
      if (second === undefined || second === 'enter') return false;
      const g2 = second.entity.geom;
      if (g2.kind !== 'LINE') {
        ctx.message('Select a line.');
        return false;
      }
      const vertex = meet(g, g2);
      if (!vertex) {
        ctx.message('Lines are parallel.');
        return true;
      }
      // Each line's side of the vertex is the side it was picked on (its far end without a pick).
      const side = (l: Line, at: Vec2 | undefined) =>
        at && distance(at, vertex) > 0 ? at : farEnd(l, vertex);
      return done(angleAt(vertex, side(g, picked.at), side(g2, second.at)));
    }
    ctx.message('Select an arc, a circle or a line.');
  }
}

// --- MEASUREGEOM -------------------------------------------------------------------------------

const MEASURE_OPTIONS = ['Distance', 'Radius', 'Angle', 'ARea', 'Volume'];

function measuregeomCommand(): CommandDef {
  return {
    name: 'MEASUREGEOM',
    transparent: true,
    usesSelection: 'none',
    async *run(ctx) {
      let first = true;
      for (;;) {
        const a = yield ctx.prompt.keyword({
          message: 'Enter an option',
          options: first ? MEASURE_OPTIONS : [...MEASURE_OPTIONS, 'eXit'],
          default: { kind: 'keyword', keyword: first ? 'Distance' : 'eXit' },
        });
        if (a.kind !== 'keyword' || a.keyword === 'eXit') return;
        first = false;
        switch (a.keyword) {
          case 'Distance':
            yield* measureDistance(ctx);
            break;
          case 'Radius':
            yield* measureRadius(ctx);
            break;
          case 'Angle':
            yield* measureAngle(ctx);
            break;
          case 'ARea':
            yield* measureArea(ctx, { exit: true, volume: false });
            break;
          case 'Volume':
            yield* measureArea(ctx, { exit: true, volume: true });
            break;
        }
      }
    },
  };
}

/** The inquiry commands, made per drawing. */
export const INQUIRY_COMMANDS: readonly (() => CommandDef)[] = [
  idCommand,
  distCommand,
  areaCommand,
  measuregeomCommand,
];
