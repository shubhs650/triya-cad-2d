// UCS and UCSICON (M3-06 part 7, 2D only), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "UCS
// (Command)", "UCSICON (Command)"):
//   UCS      Current ucs name:  *WORLD*
//            Specify origin of UCS or [NAmed/OBject/Previous/View/World/Z] <World>:
//              (a point) Specify point on X-axis or <Accept>:
//                        Specify point on the XY plane or <Accept>:
//            Z         Specify rotation angle about Z axis <90>:
//            OBject    Select object to align UCS:
//            NAmed     Enter an option [Restore/Save/Delete/?]:
//                      Enter name of UCS to restore or [?]:
//                      Enter name to save current UCS or [?]:
//                      Enter UCS name(s) to delete <none>:
//                      Enter UCS name(s) to list <*>:
//            Apply     Pick viewport to apply current UCS or [All] <current>:   (a layout only)
//   UCSICON  Enter an option [ON/OFF/Noorigin/ORigin] <ON>:
// Triya draws in plan (PRD: 2D), so AutoCAD's Face, X, Y and ZAxis options, which tilt the XY
// plane, are left out, and a point on the XY plane that would turn the Z axis down is refused.
// The current UCS is the header's $UCSORG, $UCSXDIR, $UCSYDIR and $UCSNAME (paper space's
// $PUCS*), and model space's `*Active` VPORT keeps it too (DXF 110/111/112), as AutoCAD saves
// it per viewport; each change is one undo step. Named UCSs are the UCS table's records.
// Previous goes back through the last ten UCSs of the space this session (AutoCAD: "up to 10").
// UCSICON's ON and ORigin are the `*Active` VPORT's DXF 74 bits 1 and 2 (UCSICON's value).
// Apply (M3-15; AutoCAD: "Applies the current UCS setting to a specified viewport or all
// viewports") keeps a UCS in a layout's floating viewports (DXF 110/111/112) and turns their UCSVP
// on (DXF 71), so each shows it from then on (`viewportUcs`). AutoCAD sets a viewport's UCS from
// model space inside it; Triya cannot make a viewport current yet (MSPACE, M6-02), so Apply is
// offered in a layout, where it applies model space's current UCS, the one a viewport with UCSVP 0
// shows. Its <current> is paper space's own viewport, which keeps no model space UCS: Enter ends.
import { currentVport } from '../edit/snap-grid';
import { offsetCurveOf } from '../edit/offset';
import { hatchBoundary } from '../edit/trim-edges';
import { validViewName } from '../edit/named-view';
import { endPoint, startPoint } from '../geom/eval';
import type { Vec2 } from '../geom/types';
import {
  WORLD_UCS,
  isWorld,
  normAngle,
  planUcs,
  sameUcs,
  toUcs,
  ucsAxes,
  ucsHeaderEntries,
  ucsOf,
  UCS_VARIABLES,
  type PlanUcs,
} from '../input/ucs';
import type { ChangeSetBuilder } from '../model/builder';
import type { EntityGeometry, UcsRecord, ViewportGeometry } from '../model/types';
import type { EntityId } from '../model/entity-ids';
import { viewportFrame } from '../layout/viewport';
import { modelSpaceOf } from './bus';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { viewNameMatches } from './view/named-view';
import { drawingUnits, formatDistance } from './units';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/** True when commands draw in a layout's paper space, whose UCS is the $PUCS* one. */
const inPaper = (ctx: CommandContext): boolean => ctx.space !== modelSpaceOf(ctx.model);

/** The current UCS of the space the commands draw in. */
export function currentUcs(ctx: CommandContext): PlanUcs {
  return ucsOf(ctx.model.header, inPaper(ctx));
}

/** The current UCS's name, as AutoCAD reports it: `*WORLD*`, `*NO NAME*` or its name. */
function ucsName(ctx: CommandContext): string {
  const names = inPaper(ctx) ? UCS_VARIABLES.paper : UCS_VARIABLES.model;
  const name = ctx.model.header.get(names.name);
  if (typeof name === 'string' && name !== '') return name;
  return isWorld(currentUcs(ctx)) ? '*WORLD*' : '*NO NAME*';
}

/** The last UCSs of a space, newest last (AutoCAD keeps ten). */
const PREVIOUS_MAX = 10;
interface Remembered {
  readonly ucs: PlanUcs;
  readonly name: string;
}

/**
 * Makes `u` (named `name`, '' for none) the space's current UCS in one undo step: the header,
 * and model space's `*Active` VPORT. Nothing changes when it is current already.
 */
function setUcs(ctx: CommandContext, u: PlanUcs, name: string): boolean {
  const paper = inPaper(ctx);
  const names = paper ? UCS_VARIABLES.paper : UCS_VARIABLES.model;
  const nowName = ctx.model.header.get(names.name);
  if (sameUcs(currentUcs(ctx), u) && (nowName ?? '') === name) return false;
  const entries = ucsHeaderEntries(u, name, paper);
  const vport = paper ? undefined : currentVport(ctx.model);
  ctx.edit((b) => {
    for (const [key, value] of entries) b.setHeader(key, value);
    if (vport) {
      const a = ucsAxes(u);
      b.updateTableRecord('vports', vport.handle, {
        ucs: { ...a, elevation: vport.ucs.elevation, orthographic: 0 },
      });
    }
  });
  return true;
}

/** The UCS `ucsAxes` says, as the angle of an X axis from the world's, made exact for whole degrees. */
function angleTowards(from: Vec2, to: Vec2): number | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) === 0) return undefined;
  return exactAngle(Math.atan2(dy, dx));
}

/** An angle within 1e-12 of whole degrees made exactly that many degrees' radians. */
function exactAngle(a: number): number {
  const deg = (normAngle(a) * 180) / Math.PI;
  const whole = Math.round(deg);
  return Math.abs(deg - whole) < 1e-9 ? normAngle((whole * Math.PI) / 180) : normAngle(a);
}

/**
 * The UCS an object aligns (AutoCAD 2024 Help, "UCS (Command)", Object): a line from its
 * endpoint nearer the pick towards the other; an arc from its centre towards its endpoint
 * nearer the pick; a circle from its centre towards the pick; a polyline from its first vertex
 * towards the second; a point at it; a solid or trace from its first corner towards the second;
 * text, an attribute definition or a block reference at its insertion point, turned by its
 * rotation; a dimension at the middle of its text, X as the UCS's when it was drawn (DXF 51 is
 * minus that axis's angle). AutoCAD 2024 aligns to any object but xlines and 3D polylines, "in
 * most cases" at the end nearest the pick with X along an edge, without saying more (M3-06 part
 * 8, the common drafter expectation): an ellipse at its centre along its major axis, as an arc
 * aligns at its centre; a hatch at its boundary's corner nearest the pick, X along the boundary
 * on from it. Undefined for the others (rays, xlines, splines, mtext, leaders and the rest).
 */
export function objectUcs(g: EntityGeometry, pick: Vec2): PlanUcs | undefined {
  const nearer = (a: Vec2, b: Vec2): [Vec2, Vec2] =>
    Math.hypot(a.x - pick.x, a.y - pick.y) <= Math.hypot(b.x - pick.x, b.y - pick.y)
      ? [a, b]
      : [b, a];
  const along = (origin: Vec2, to: Vec2): PlanUcs | undefined => {
    const angle = angleTowards(origin, to);
    return angle === undefined ? undefined : { origin: { x: origin.x, y: origin.y }, angle };
  };
  switch (g.kind) {
    case 'LINE': {
      const [o, other] = nearer(g.start, g.end);
      return along(o, other);
    }
    case 'ARC': {
      const c = offsetCurveOf(g);
      if (!c || c.kind !== 'ARC') return undefined;
      const [end] = nearer(startPoint(c), endPoint(c));
      return along(c.center, end);
    }
    case 'CIRCLE': {
      const c = offsetCurveOf(g);
      if (!c || c.kind !== 'CIRCLE') return undefined;
      return along(c.center, pick) ?? { origin: c.center, angle: 0 };
    }
    case 'LWPOLYLINE': {
      const [a, b] = g.vertices;
      return a && b ? along(a, b) : undefined;
    }
    case 'POINT':
      return { origin: { x: g.position.x, y: g.position.y }, angle: 0 };
    case 'SOLID':
    case 'TRACE':
      return along(g.corners[0], g.corners[1]);
    case 'TEXT':
    case 'ATTDEF':
    case 'INSERT':
      return { origin: { x: g.position.x, y: g.position.y }, angle: exactAngle(g.rotation) };
    case 'DIMENSION':
    case 'LARGE_RADIAL_DIMENSION':
    case 'ARC_DIMENSION':
      return {
        origin: { x: g.textPosition.x, y: g.textPosition.y },
        angle: exactAngle(-g.horizontalDirection),
      };
    case 'ELLIPSE':
      return along(g.center, { x: g.center.x + g.majorAxis.x, y: g.center.y + g.majorAxis.y });
    case 'HATCH': {
      // Each boundary curve's start and where it goes on to: a polyline's vertices one by one.
      let best: [Vec2, Vec2] | undefined;
      const consider = (a: Vec2, b: Vec2) => {
        const d = Math.hypot(a.x - pick.x, a.y - pick.y);
        if (!best || d < Math.hypot(best[0].x - pick.x, best[0].y - pick.y)) best = [a, b];
      };
      for (const c of hatchBoundary(g)) {
        if (c.kind === 'LWPOLYLINE') {
          c.vertices.forEach((v, i) => consider(v, c.vertices[(i + 1) % c.vertices.length]!));
        } else consider(startPoint(c), endPoint(c));
      }
      return best && along(best[0], best[1]);
    }
    default:
      return undefined;
  }
}

const NO_OBJECT_UCS = 'Cannot align UCS to that object.';

/** "Select object to align UCS:" until an object that aligns one is picked; undefined on Enter or Esc. */
async function* alignTo(ctx: CommandContext): Sub<PlanUcs | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({ message: 'Select object to align UCS', single: true });
    if (a.kind !== 'selection' || a.ids.length === 0) return undefined;
    const e = ctx.model.entity(a.ids[0]!);
    const u = e && objectUcs(e.geom, a.pick ?? { x: 0, y: 0 });
    if (u) return u;
    ctx.message(NO_OBJECT_UCS);
  }
}

/** The UCS records whose names match the `?`/`*` patterns typed (comma separated). */
const matching = (ctx: CommandContext, patterns: string): UcsRecord[] =>
  [...ctx.model.tables.ucs.values()].filter((r) => viewNameMatches(r.name, patterns));

const recordNamed = (ctx: CommandContext, name: string): UcsRecord | undefined => {
  const key = name.toUpperCase();
  return [...ctx.model.tables.ucs.values()].find((r) => r.name.toUpperCase() === key);
};

/** ? : the saved UCSs whose names match, each with its origin and axes. */
async function* listUcs(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.string({
    message: 'Enter UCS name(s) to list',
    default: { kind: 'string', value: '*' },
  });
  if (a.kind !== 'string') return;
  const found = matching(ctx, a.value.trim() === '' ? '*' : a.value);
  ctx.message(`Current ucs name:  ${ucsName(ctx)}`);
  if (found.length === 0) {
    ctx.message('No matching UCS names found.');
    return;
  }
  ctx.message('Saved coordinate systems:');
  const u = drawingUnits(ctx.model.header);
  const v = (p: { x: number; y: number; z: number }) =>
    `<${formatDistance(p.x, u)},${formatDistance(p.y, u)},${formatDistance(p.z, u)}>`;
  for (const r of found) {
    ctx.message(`${r.name}`);
    ctx.message(`  Origin = ${v(r.origin)}, X Axis = ${v(r.xAxis)}`);
    ctx.message(`  Y Axis = ${v(r.yAxis)}`);
  }
}

/** NAmed: Restore, Save, Delete or ? the UCS table's records. */
async function* named(ctx: CommandContext, previous: (u: Remembered) => void): Sub<void> {
  const o = yield ctx.prompt.keyword({
    message: 'Enter an option',
    options: ['Restore', 'Save', 'Delete', '?'],
  });
  if (o.kind !== 'keyword') return;
  if (o.keyword === '?') return yield* listUcs(ctx);
  if (o.keyword === 'Delete') {
    const a = yield ctx.prompt.string({
      message: 'Enter UCS name(s) to delete',
      defaultLabel: 'none',
    });
    if (a.kind !== 'string' || a.value.trim() === '') return;
    const found = matching(ctx, a.value);
    if (found.length === 0) {
      ctx.message('No matching UCS names found.');
      return;
    }
    ctx.edit((b) => {
      for (const r of found) b.removeTableRecord('ucs', r.handle);
      // A deleted UCS that is current stays current, unnamed (AutoCAD: "*NO NAME*").
      for (const paper of [false, true]) {
        const key = (paper ? UCS_VARIABLES.paper : UCS_VARIABLES.model).name;
        const now = ctx.model.header.get(key);
        if (
          typeof now === 'string' &&
          found.some((r) => r.name.toUpperCase() === now.toUpperCase())
        )
          b.setHeader(key, '');
      }
    });
    ctx.message(`Deleted ${found.length} UCS${found.length === 1 ? '' : 's'}.`);
    return;
  }
  const save = o.keyword === 'Save';
  for (;;) {
    const a = yield ctx.prompt.string({
      message: save ? 'Enter name to save current UCS or' : 'Enter name of UCS to restore or',
      options: ['?'],
    });
    if (a.kind === 'keyword') {
      yield* listUcs(ctx);
      continue;
    }
    if (a.kind !== 'string' || a.value.trim() === '') return;
    const name = a.value.trim();
    if (!save) {
      const r = recordNamed(ctx, name);
      const u = r && planUcs(r.origin, r.xAxis, r.yAxis);
      if (!r) ctx.message(`Cannot find UCS named "${name}".`);
      else if (!u)
        ctx.message(`UCS "${r.name}" does not lie in the XY plane: Triya draws in plan.`);
      else {
        const was: Remembered = { ucs: currentUcs(ctx), name: nameNow(ctx) };
        if (setUcs(ctx, u, r.name)) previous(was);
        return;
      }
      continue;
    }
    if (!validViewName(name) || name.startsWith('*')) {
      ctx.message('Invalid UCS name.');
      continue;
    }
    const existing = recordNamed(ctx, name);
    if (existing) {
      const k = yield ctx.prompt.keyword({
        message: `UCS "${existing.name}" already exists. Replace it?`,
        options: ['Yes', 'No'],
        default: { kind: 'keyword', keyword: 'No' },
      });
      if (k.kind !== 'keyword' || k.keyword !== 'Yes') return;
    }
    const u = currentUcs(ctx);
    const axes = ucsAxes(u);
    const paper = inPaper(ctx);
    ctx.edit((b: ChangeSetBuilder) => {
      const kept = existing?.name ?? name;
      if (existing)
        b.updateTableRecord('ucs', existing.handle, { ...axes, elevation: 0, orthographic: 0 });
      else b.addTableRecord('ucs', { name, ...axes, elevation: 0, orthographic: 0 });
      // The saved UCS is the current one now, by name, as AutoCAD reports it after a save.
      b.setHeader((paper ? UCS_VARIABLES.paper : UCS_VARIABLES.model).name, kept);
    });
    return;
  }
}

/** The current UCS's name as the header keeps it ('' unnamed). */
function nameNow(ctx: CommandContext): string {
  const v = ctx.model.header.get((inPaper(ctx) ? UCS_VARIABLES.paper : UCS_VARIABLES.model).name);
  return typeof v === 'string' ? v : '';
}

/**
 * The new UCS from a point: its origin there, then (unless Accept) the X axis towards a point,
 * then a point on the XY plane, which must lie on the positive Y side so that Z stays up.
 */
async function* fromOrigin(ctx: CommandContext, origin: Vec2): Sub<PlanUcs | undefined> {
  const now = currentUcs(ctx);
  const x = yield ctx.prompt.point({
    message: 'Specify point on X-axis or',
    defaultLabel: 'Accept',
    rubberBand: { from: origin },
  });
  if (x.kind === 'enter') return { origin, angle: now.angle };
  if (x.kind !== 'point') return undefined;
  const angle = angleTowards(origin, x.point);
  if (angle === undefined) {
    ctx.message('Point is the same as the origin: the X axis keeps its direction.');
    return { origin, angle: now.angle };
  }
  for (;;) {
    const y = yield ctx.prompt.point({
      message: 'Specify point on the XY plane or',
      defaultLabel: 'Accept',
      rubberBand: { from: origin },
    });
    if (y.kind === 'enter') return { origin, angle };
    if (y.kind !== 'point') return undefined;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const side = ux * (y.point.y - origin.y) - uy * (y.point.x - origin.x);
    if (side > 0) return { origin, angle };
    // AutoCAD would turn the XY plane over (Z down); a plan drawing keeps Z up (PRD: 2D).
    ctx.message(
      'The point must be on the positive Y side of the X axis: Triya keeps the Z axis up.',
    );
  }
}

/** The layout's floating viewports (not paper space's own, id 1), topmost last. */
function floatingViewports(ctx: CommandContext): { id: EntityId; geom: ViewportGeometry }[] {
  if (!ctx.model.hasBlock(ctx.space)) return [];
  const out: { id: EntityId; geom: ViewportGeometry }[] = [];
  for (const id of ctx.model.blockEntities(ctx.space)) {
    const g = ctx.model.entity(id)?.geom;
    if (g?.kind === 'VIEWPORT' && g.id !== 1) out.push({ id, geom: g });
  }
  return out;
}

/**
 * Apply: model space's current UCS kept in the viewport picked, or every floating viewport of the
 * layout (All), with UCSVP on; one undo step.
 */
async function* applyUcs(ctx: CommandContext): Sub<void> {
  const viewports = floatingViewports(ctx);
  let chosen: { id: EntityId; geom: ViewportGeometry }[] | undefined;
  while (!chosen) {
    const a = yield ctx.prompt.point({
      message: 'Pick viewport to apply current UCS or',
      options: ['All'],
      defaultLabel: 'current',
    });
    if (a.kind === 'keyword') chosen = viewports;
    else if (a.kind !== 'point') return;
    else {
      const p = a.point;
      const hit = viewports.findLast(({ geom }) => {
        const f = viewportFrame(geom);
        return p.x >= f.minX && p.x <= f.maxX && p.y >= f.minY && p.y <= f.maxY;
      });
      if (hit) chosen = [hit];
      else ctx.message('No viewport found at that point.');
    }
  }
  const a = ucsAxes(ucsOf(ctx.model.header, false));
  ctx.edit((b) => {
    for (const { id, geom } of chosen) {
      const ucs = { ...a, elevation: geom.ucs?.elevation ?? 0, orthographic: 0 };
      b.updateEntity(id, { geom: { ...geom, ucsPerViewport: true, ucs } });
    }
  });
}

export function ucsCommand(): CommandDef {
  const history = new Map<boolean, Remembered[]>();
  const stack = (ctx: CommandContext): Remembered[] => {
    const paper = inPaper(ctx);
    let s = history.get(paper);
    if (!s) history.set(paper, (s = []));
    return s;
  };
  const remember = (ctx: CommandContext, r: Remembered) => {
    const s = stack(ctx);
    s.push(r);
    if (s.length > PREVIOUS_MAX) s.shift();
  };
  return {
    name: 'UCS',
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      ctx.message(`Current ucs name:  ${ucsName(ctx)}`);
      const was: Remembered = { ucs: currentUcs(ctx), name: nameNow(ctx) };
      const change = (u: PlanUcs | undefined, name = '') => {
        if (u && setUcs(ctx, u, name)) remember(ctx, was);
      };
      const a = yield ctx.prompt.point({
        message: 'Specify origin of UCS or',
        options: [
          'NAmed',
          'OBject',
          'Previous',
          'View',
          'World',
          'Z',
          ...(inPaper(ctx) ? ['Apply'] : []),
        ],
        default: { kind: 'keyword', keyword: 'World' },
      });
      if (a.kind === 'point') return change(yield* fromOrigin(ctx, a.point));
      if (a.kind !== 'keyword') return;
      switch (a.keyword) {
        case 'World':
          return change(WORLD_UCS);
        case 'Previous': {
          const s = stack(ctx);
          const last = s.pop();
          if (!last) {
            ctx.message('There is no previous UCS.');
            return;
          }
          setUcs(ctx, last.ucs, last.name);
          return;
        }
        case 'Z': {
          const r = yield ctx.prompt.angle({
            message: 'Specify rotation angle about Z axis',
            default: { kind: 'angle', value: Math.PI / 2 },
            turn: true,
          });
          if (r.kind !== 'angle') return;
          const now = currentUcs(ctx);
          return change({ origin: now.origin, angle: exactAngle(now.angle + r.value) });
        }
        case 'OBject':
          return change(yield* alignTo(ctx));
        case 'View': {
          // X along the screen's horizontal: a plan view turned by its twist on screen.
          const twist = inPaper(ctx) ? 0 : (currentVport(ctx.model)?.twist ?? 0);
          return change({ origin: currentUcs(ctx).origin, angle: exactAngle(-twist) });
        }
        case 'NAmed':
          return yield* named(ctx, (r) => remember(ctx, r));
        case 'Apply':
          return yield* applyUcs(ctx);
      }
    },
  };
}

/** UCSICON's bits (DXF 74): the icon shows, and at the UCS's origin where it can. */
export const UCS_ICON = { on: 1, origin: 2 } as const;

export function ucsIconCommand(): CommandDef {
  return {
    name: 'UCSICON',
    transparent: true,
    usesSelection: 'none',
    keepsSelection: true,
    async *run(ctx) {
      const v = currentVport(ctx.model);
      const now = v?.ucsIcon ?? UCS_ICON.on;
      const a = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: ['ON', 'OFF', 'Noorigin', 'ORigin'],
        default: { kind: 'keyword', keyword: now & UCS_ICON.on ? 'ON' : 'OFF' },
      });
      if (a.kind !== 'keyword') return;
      if (!v) {
        ctx.message('The drawing has no current viewport to keep the UCS icon in.');
        return;
      }
      const bits =
        a.keyword === 'ON'
          ? now | UCS_ICON.on
          : a.keyword === 'OFF'
            ? now & ~UCS_ICON.on
            : a.keyword === 'ORigin'
              ? now | UCS_ICON.origin
              : now & ~UCS_ICON.origin;
      if (bits !== v.ucsIcon)
        ctx.edit((b) => b.updateTableRecord('vports', v.handle, { ucsIcon: bits }));
    },
  };
}

export const UCS_COMMANDS: readonly (() => CommandDef)[] = [ucsCommand, ucsIconCommand];

/** A world point as the current UCS gives it (ID, DIST and the status bar's coordinates). */
export const pointInUcs = (ctx: CommandContext, p: Vec2): Vec2 => toUcs(currentUcs(ctx), p);
