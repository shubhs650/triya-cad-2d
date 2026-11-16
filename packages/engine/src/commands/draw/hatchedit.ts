// HATCHEDIT (HE) and -HATCHEDIT (M4-07 part 4), with AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "-HATCHEDIT (Command)"):
//   Select hatch object:
//   Enter hatch option [DIsassociate/Style/Properties/DRaw order/ADd boundaries/
//     Remove boundaries/recreate Boundary/ASsociate/separate Hatches/Origin/LAyer/COlor/
//     Transparency] <Properties>:
//   Enter hatching style [Ignore/Outer/Normal] <Normal>:                                (Style)
//   Enter draw order [do Not change/send to Back/bring to Front/send beHind boundary/
//     bring in front of bounDary] <do Not change>:                                 (DRaw order)
//   Pick internal point or [Select objects]:                                  (ADd boundaries)
//   Select Objects:                                                        (Remove boundaries)
//   Enter type of boundary object [Region/Polyline] <Polyline>:
//     Reassociate hatch with new boundary? [Yes/No] <N>:                   (recreate Boundary)
// Properties, Origin, COlor, LAyer and Transparency ask what -HATCH asks (hatch-options.ts), of
// the hatch picked, and change it; each option changes the hatch once, as one undo step, and
// ends the command, as AutoCAD's -HATCHEDIT does. HATCHEDIT opens the Hatch Edit dialog
// (hatch-dialog.ts, `hatchEditDialog`) when HPDLGMODE says so, and otherwise asks the same
// prompts; a double click on a hatch runs HATCHEDIT.
//
// - A pattern laid out again at a new angle, scale or origin keeps the lines the hatch stores
//   (turned and scaled about its origin, as the Properties palette does), so a pattern the
//   app's library does not have (one a file brought) can still be changed; a new pattern name
//   is placed by the library.
// - Hatches are non-associative in Triya (DEC-015): ASsociate and recreate Boundary's
//   Reassociate are refused, and DIsassociate lets an associative hatch from a file go of its
//   boundary objects. ADd boundaries, Remove boundaries and separate Hatches change the loops,
//   so an associative hatch lets go of its boundary first (AutoCAD would keep it).
// - A hatch that is not associative names no boundary objects, so DRaw order's boundary and
//   Remove boundaries' objects are the objects its loops lie along (one passes through a point
//   in the middle of a loop's edge; `edit/hatch-separate.ts`).
// - recreate Boundary keeps each loop as BOUNDARY's Polyline would (`edit/hatch-retain.ts`), on
//   the current layer; Region is refused, as Triya cannot write regions (PRD non-goal 1).
// - separate Hatches: the hatch keeps its first area (`hatchAreas`), and each other area becomes
//   a copy of it with that area's loops and seed points, drawn just above it.
import { boxesOverlap, boxOf, curveBounds } from '../../geom/bounds';
import { moveInDrawOrder, type DrawOrderMove } from '../../edit/draw-order';
import { copyObjects, dissociateHatch } from '../../edit/edit';
import {
  HATCH_BACKGROUND_APP,
  hatchBackgroundAppId,
  withHatchBackground,
  type BackgroundColor,
} from '../../edit/hatch-background';
import { relaidLines } from '../../edit/hatch-lines';
import { retainedBoundary } from '../../edit/hatch-retain';
import { hatchAreas, loopSamples, passesThrough } from '../../edit/hatch-separate';
import { moveBy } from '../../edit/similarity';
import { objectEdgeCurves } from '../../edit/trim-edges';
import type { ChangeSetBuilder } from '../../model/builder';
import type { EntityId } from '../../model/entity-ids';
import type { EntityPatch } from '../../model/update';
import type { Entity, HatchGeometry, HatchLoop, HatchPatternLine } from '../../model/types';
import { currentProps, currentTransparency } from '../../properties/current';
import { isPatterned } from '../../properties/sheet';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import {
  addBoundaries as pickBoundaries,
  assignSettings,
  copySettings,
  hatchDialog,
  inheritFrom,
  layerNames,
  openHatchDialog,
  originPoint,
  previewHatch,
  viewSelections,
  type HatchDialogState,
} from './hatch-dialog';
import {
  HatchRun,
  NOT_BOUNDARIES,
  dialogMode,
  drawHatchCommands,
  extentsOrigin,
  hatchFill,
  hatchLayerRecord,
  initialSettings,
  shown,
  tolerance,
  userLines,
} from './hatch';
import {
  DRAW_ORDERS,
  SOLID,
  STYLES,
  USE_CURRENT,
  USER,
  hatchColor,
  hatchLayer,
  hatchTransparency,
  isGradient,
  keyword,
  origin,
  placed,
  properties,
  settingsOf,
  transparencyText,
  yesNo,
  type HatchDrawOrder,
  type HatchSettings,
  type Sub,
} from './hatch-options';

type HatchEntity = Entity & { readonly geom: HatchGeometry };

const OPTIONS = [
  'DIsassociate',
  'Style',
  'Properties',
  'DRaw order',
  'ADd boundaries',
  'Remove boundaries',
  'recreate Boundary',
  'ASsociate',
  'separate Hatches',
  'Origin',
  'LAyer',
  'COlor',
  'Transparency',
];

const NON_ASSOCIATIVE = 'Triya makes non-associative hatches.';

/** HATCH (with -HATCH), GRADIENT and HATCHEDIT (with -HATCHEDIT), sharing their settings. */
export function hatchCommands(): CommandDef[] {
  let settings: HatchSettings | undefined;
  const settingsFor = (ctx: CommandContext) => (settings ??= initialSettings(ctx));
  return [...drawHatchCommands(settingsFor, hatchDialog), hatcheditCommand(settingsFor)];
}

export function hatchCommand(): CommandDef {
  return hatchCommands()[0]!;
}

export function hatcheditCommand(settingsFor: (ctx: CommandContext) => HatchSettings): CommandDef {
  return {
    name: 'HATCHEDIT',
    dashVariant: true,
    usesSelection: 'during',
    async *run(ctx): CommandGenerator {
      for (;;) {
        const a = yield ctx.prompt.selection({
          message: 'Select hatch object',
          single: true,
          pickfirst: true,
          editable: true,
        });
        if (a.kind !== 'selection' || a.ids.length === 0) return;
        const e = ctx.model.entity(a.ids[0]!);
        if (e?.geom.kind !== 'HATCH') {
          ctx.message('Object selected is not a hatch.');
          continue;
        }
        if (!ctx.dash && (await dialogMode(ctx))) {
          yield* hatchEditDialog(ctx, e as HatchEntity, settingsFor(ctx));
        } else yield* editHatch(ctx, e as HatchEntity, settingsFor(ctx));
        ctx.preview([]);
        return;
      }
    },
  };
}

/**
 * The Hatch Edit dialog (hatch-dialog.ts) on the hatch picked. OK makes every change it holds
 * in one undo step: boundaries added and removed, the pattern or gradient and its placement
 * (`applySettings`), the island style, transparency, draw order and separate hatches.
 */
async function* hatchEditDialog(
  ctx: CommandContext,
  e: HatchEntity,
  shared: HatchSettings,
): Sub<void> {
  const before = settingsOf(ctx, e, shared);
  // Boundaries added are found as HATCH finds them, with the hatch's settings.
  const run = new HatchRun(ctx, { ...copySettings(before), originMode: 0 });
  run.setOrigin(before.origin);
  const removed = new Set<number>();
  let state: HatchDialogState = {
    settings: { ...copySettings(before), drawOrder: 'none', separate: false },
    transparency: transparencyText(e.transparency),
    specified: false,
    origin: before.origin,
    extents: 0,
    storeOrigin: false,
    inheritOrigin: false,
    tab: isGradient(before.pattern) ? 'gradient' : 'hatch',
    more: false,
  };
  const loops = () => [...e.geom.loops.filter((_, i) => !removed.has(i)), ...run.found().loops];
  const edited = async (): Promise<HatchGeometry | undefined> => {
    const after = editedSettings(ctx, state, before, loops());
    const lines = await editedLines(ctx, e.geom, before, after);
    if (!lines) return undefined;
    return { ...e.geom, loops: loops(), ...hatchFill(after, lines) };
  };
  for (;;) {
    const { state: next, button } = yield* openHatchDialog(ctx, {
      type: 'hatch',
      edit: true,
      ...state,
      layers: layerNames(ctx),
      boundaries: loops().length,
      boundarySet: false,
    });
    state = next;
    assignSettings(run.s, state.settings);
    switch (button) {
      case undefined:
        await applyEdit(ctx, e, shared, before, state, run, removed);
        return;
      case 'pick':
      case 'select':
        yield* pickBoundaries(ctx, run, button === 'select', async () => {
          const g = await edited();
          ctx.preview(g ? [g] : []);
        });
        break;
      case 'remove': {
        const a = yield ctx.prompt.selection({ message: 'Select Objects' });
        if (a.kind !== 'selection' || a.ids.length === 0) break;
        const gone = [...boundaryObjects(ctx, e, a.ids).values()].flat();
        const left = e.geom.loops.length - new Set([...removed, ...gone]).size;
        if (left + run.found().loops.length === 0) {
          ctx.message('A hatch keeps at least one boundary.');
        } else for (const i of gone) removed.add(i);
        break;
      }
      case 'recreate':
        yield* recreateBoundary(ctx, e);
        break;
      case 'view':
        yield* viewSelections(ctx, loops());
        break;
      case 'preview':
        if (yield* previewHatch(ctx, await edited())) {
          await applyEdit(ctx, e, shared, before, state, run, removed);
          return;
        }
        break;
      case 'inherit':
        state = (yield* inheritFrom(ctx, state)) ?? state;
        break;
      case 'origin':
        state = { ...state, specified: true, origin: yield* originPoint(ctx), extents: 0 };
        break;
      default:
        break;
    }
  }
}

/** The settings Hatch Edit's OK gives the hatch: its own origin unless another is specified. */
function editedSettings(
  ctx: CommandContext,
  state: HatchDialogState,
  before: HatchSettings,
  loops: readonly HatchLoop[],
): HatchSettings {
  const origin = !state.specified
    ? before.origin
    : state.extents > 0
      ? (extentsOrigin(loops, state.extents, tolerance(ctx)) ?? state.origin)
      : state.origin;
  return { ...copySettings(state.settings), origin };
}

/** Hatch Edit's OK (see `hatchEditDialog`). */
async function applyEdit(
  ctx: CommandContext,
  e: HatchEntity,
  shared: HatchSettings,
  before: HatchSettings,
  state: HatchDialogState,
  run: HatchRun,
  removed: ReadonlySet<number>,
): Promise<void> {
  const added = run.found();
  if (removed.size > 0 || added.loops.length > 0) {
    ctx.edit((b) => {
      const g = loose(b, ctx, e);
      b.updateEntity(e.id, {
        geom: {
          ...g,
          loops: [...g.loops.filter((_, i) => !removed.has(i)), ...added.loops],
          seedPoints: [...g.seedPoints, ...added.seedPoints],
        },
      });
    });
  }
  const now = () => ctx.model.entity(e.id) as HatchEntity;
  const after = editedSettings(ctx, state, before, now().geom.loops);
  if (state.specified && state.storeOrigin) {
    shared.origin = state.origin;
    shared.originMode = state.extents;
  }
  await applySettings(ctx, now(), settingsOf(ctx, now(), shared), after);
  const style = after.islands ? STYLES.indexOf(after.style) : 2;
  if (style !== now().geom.style) {
    ctx.edit((b) => b.updateEntity(e.id, { geom: { ...now().geom, style } }));
  }
  if (state.transparency !== transparencyText(e.transparency)) {
    const t = state.transparency;
    const value = t === USE_CURRENT ? currentProps(ctx.model).transparency : currentTransparency(t);
    ctx.edit((b) => b.updateEntity(e.id, { transparency: value }));
  }
  reorder(ctx, now(), after.drawOrder);
  if (after.separate) separate(ctx, now());
}

async function* editHatch(ctx: CommandContext, e: HatchEntity, shared: HatchSettings): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter hatch option',
    options: OPTIONS,
    default: { kind: 'keyword', keyword: 'Properties' },
  });
  const before = settingsOf(ctx, e, shared);
  const after: HatchSettings = { ...before, gradient: { ...before.gradient } };
  switch (keyword(a)) {
    case 'DIsassociate':
      if (e.geom.associative) ctx.edit((b) => dissociateHatch(b, ctx.model, e));
      return;
    case 'ASsociate':
      ctx.message(NON_ASSOCIATIVE);
      return;
    case 'Style':
      yield* style(ctx, e);
      return;
    case 'DRaw order':
      yield* drawOrder(ctx, e);
      return;
    case 'ADd boundaries':
      yield* addBoundaries(ctx, e, before);
      return;
    case 'Remove boundaries':
      yield* removeBoundaries(ctx, e);
      return;
    case 'recreate Boundary':
      yield* recreateBoundary(ctx, e);
      return;
    case 'separate Hatches':
      separate(ctx, e);
      return;
    case 'Origin': {
      // Stored as the default origin, it is HATCH's (HPORIGIN).
      const p = yield* origin(ctx, shared);
      if (!p) return;
      after.origin = p;
      break;
    }
    case 'COlor':
      yield* hatchColor(ctx, after);
      break;
    case 'LAyer':
      yield* hatchLayer(ctx, after, 'Enter layer name for hatch or');
      break;
    case 'Transparency': {
      const t = yield* hatchTransparency(
        ctx,
        transparencyText(e.transparency),
        'Enter transparency value for hatch or',
      );
      if (t === undefined) return;
      const value =
        t === USE_CURRENT ? currentProps(ctx.model).transparency : currentTransparency(t);
      ctx.edit((b) => b.updateEntity(e.id, { transparency: value }));
      return;
    }
    default:
      yield* properties(ctx, after);
  }
  await applySettings(ctx, e, before, after);
}

/** What a hatch's settings say of its fill, but for the background. */
const fillKey = (s: HatchSettings) =>
  JSON.stringify([
    s.pattern,
    s.custom,
    s.scale,
    s.angle,
    s.spacing,
    s.double,
    s.origin,
    isGradient(s.pattern) && s.gradient,
  ]);

/**
 * The hatch's lines for `after`, from those it stores where the pattern is the same (see the
 * head comment); undefined when the library has no such pattern (said).
 */
async function editedLines(
  ctx: CommandContext,
  g: HatchGeometry,
  before: HatchSettings,
  after: HatchSettings,
): Promise<readonly HatchPatternLine[] | undefined> {
  if (after.pattern === SOLID || isGradient(after.pattern)) return [];
  const o = after.origin;
  if (after.pattern === USER) return userLines(after.angle, after.spacing, after.double, o);
  if (before.pattern === after.pattern && isPatterned(g) && g.patternType !== 0) {
    const turned = relaidLines(
      g.patternLines,
      before.origin,
      after.angle - before.angle,
      after.scale / before.scale,
    );
    const d = { x: o.x - before.origin.x, y: o.y - before.origin.y };
    return turned.map((l) => ({ ...l, base: { x: l.base.x + d.x, y: l.base.y + d.y } }));
  }
  const p = await placed(ctx, after.pattern, { angle: after.angle, scale: after.scale, origin: o });
  return p?.lines[0];
}

const sameColor = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The hatch changed as `after` says where it differs from `before`, as one undo step. */
async function applySettings(
  ctx: CommandContext,
  e: HatchEntity,
  before: HatchSettings,
  after: HatchSettings,
): Promise<void> {
  const g = e.geom;
  const refill = fillKey(before) !== fillKey(after);
  const lines = refill ? await editedLines(ctx, g, before, after) : g.patternLines;
  if (!lines) return;
  const { background: _bg, gradient: _gr, ...rest } = g;
  let geom: HatchGeometry = refill ? { ...rest, ...hatchFill(after, lines), style: g.style } : g;
  const background = geom.solid ? undefined : after.background;
  if (!sameColor(geom.background, background)) {
    const { background: _old, ...without } = geom;
    geom = background ? { ...without, background } : without;
  }
  const model = ctx.model;
  ctx.edit((b) => {
    const current = currentProps(model);
    const patch: { -readonly [K in keyof EntityPatch]: EntityPatch[K] } = {};
    if (geom !== g) patch.geom = geom;
    if (!sameColor(g.background, geom.background)) {
      const app = geom.background
        ? hatchBackgroundAppId(b, model)
        : [...model.tables.appIds.values()].find(
            (r) => r.name.toUpperCase() === HATCH_BACKGROUND_APP,
          )?.handle;
      if (app) {
        patch.xdata = withHatchBackground(e.xdata, app, geom.background as BackgroundColor);
      }
    }
    const color = after.color ?? current.color;
    if (!sameColor(color, e.color)) patch.color = color;
    if (after.layer !== before.layer) {
      patch.layer =
        after.layer === undefined ? current.layer : hatchLayerRecord(b, ctx, after.layer);
    }
    if (Object.keys(patch).length > 0) b.updateEntity(e.id, patch);
  });
}

/** Style: the island detection style, DXF 75. */
async function* style(ctx: CommandContext, e: HatchEntity): Sub<void> {
  const names = ['Ignore', 'Outer', 'Normal'];
  const a = yield ctx.prompt.keyword({
    message: 'Enter hatching style',
    options: names,
    default: { kind: 'keyword', keyword: names[2 - Math.min(2, Math.max(0, e.geom.style))]! },
  });
  const s = 2 - names.indexOf(keyword(a)!);
  if (s !== e.geom.style) ctx.edit((b) => b.updateEntity(e.id, { geom: { ...e.geom, style: s } }));
}

/**
 * The objects a hatch's boundary is: those an associative hatch names, else the objects of its
 * space its loops lie along (see the head comment).
 */
export function boundaryObjects(
  ctx: CommandContext,
  e: HatchEntity,
  among?: readonly EntityId[],
): Map<EntityId, number[]> {
  const model = ctx.model;
  const g = e.geom;
  const out = new Map<EntityId, number[]>();
  const loopsOf = (id: EntityId, i: number) => out.set(id, [...(out.get(id) ?? []), i]);
  if (g.associative && !among) {
    g.loops.forEach((l, i) => {
      for (const h of l.sources ?? []) {
        const id = model.ids.idOf(h);
        if (id && model.entity(id)) loopsOf(id, i);
      }
    });
    if (out.size > 0) return out;
  }
  const tol = tolerance(ctx);
  const samples = g.loops.map(loopSamples);
  const all = samples.flat();
  if (all.length === 0) return out;
  const box = boxOf(all);
  const near = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 1e-6;
  for (const id of among ?? model.blockEntities(e.owner)) {
    const x = model.entity(id);
    if (!x || x.id === e.id || NOT_BOUNDARIES.has(x.geom.kind) || (!among && !shown(ctx, x))) {
      continue;
    }
    const curves = objectEdgeCurves({ model, tol }, x, { extend: false, hatches: false }).filter(
      (c) => c.kind === 'XLINE' || c.kind === 'RAY' || boxesOverlap(curveBounds(c, tol), box, near),
    );
    if (curves.length === 0) continue;
    samples.forEach((s, i) => passesThrough(curves, s, tol) && loopsOf(x.id, i));
  }
  return out;
}

/** DRaw order: the hatch moved as HATCH's DRaw order would place it, or left where it is. */
async function* drawOrder(ctx: CommandContext, e: HatchEntity): Sub<void> {
  const names = DRAW_ORDERS.map(([o, name]): [HatchDrawOrder, string] =>
    o === 'none' ? [o, 'do Not change'] : [o, name],
  );
  const a = yield ctx.prompt.keyword({
    message: 'Enter draw order',
    options: names.map(([, n]) => n),
    default: { kind: 'keyword', keyword: 'do Not change' },
  });
  reorder(ctx, e, names.find(([, n]) => n === keyword(a))?.[0] ?? 'none');
}

/** The hatch moved in the draw order as `order` says ('none': left where it is). */
function reorder(ctx: CommandContext, e: HatchEntity, order: HatchDrawOrder): void {
  let move: DrawOrderMove | undefined;
  if (order === 'back' || order === 'front') move = { to: order };
  else if (order === 'behind' || order === 'above') {
    const reference = [...boundaryObjects(ctx, e).keys()];
    if (reference.length === 0) {
      ctx.message('The hatch has no boundary objects.');
      return;
    }
    move = { to: order === 'behind' ? 'under' : 'above', reference };
  }
  if (move) ctx.edit((b) => moveInDrawOrder(b, ctx.model, [e.id], move));
}

/** The hatch's geometry as the edit has it, an associative hatch letting go of its boundary. */
function loose(b: ChangeSetBuilder, ctx: CommandContext, e: HatchEntity): HatchGeometry {
  if (e.geom.associative) dissociateHatch(b, ctx.model, e);
  return b.entity(e.id)!.geom as HatchGeometry;
}

/** ADd boundaries: areas found by pick points or objects, added to the hatch's loops. */
async function* addBoundaries(ctx: CommandContext, e: HatchEntity, s: HatchSettings): Sub<void> {
  const run = new HatchRun(ctx, s);
  let selecting = false;
  for (;;) {
    const found = run.found();
    ctx.preview(found.loops.length > 0 ? [{ ...e.geom, loops: found.loops, seedPoints: [] }] : []);
    const a = selecting
      ? yield ctx.prompt.selection({
          message: 'Select objects or',
          options: ['picK internal point'],
        })
      : yield ctx.prompt.point({ message: 'Pick internal point or', options: ['Select objects'] });
    const k = keyword(a);
    if (k === 'Select objects') selecting = true;
    else if (k === 'picK internal point') selecting = false;
    else if (a.kind === 'point') await run.pick(a.point);
    else if (a.kind === 'selection' && a.ids.length > 0) run.select(a.ids);
    else break;
  }
  ctx.preview([]);
  const found = run.found();
  if (found.loops.length === 0) return;
  ctx.edit((b) => {
    const g = loose(b, ctx, e);
    b.updateEntity(e.id, {
      geom: {
        ...g,
        loops: [...g.loops, ...found.loops],
        seedPoints: [...g.seedPoints, ...found.seedPoints],
      },
    });
  });
}

/** Remove boundaries: the loops the objects selected lie along come out of the hatch. */
async function* removeBoundaries(ctx: CommandContext, e: HatchEntity): Sub<void> {
  const a = yield ctx.prompt.selection({ message: 'Select Objects' });
  if (a.kind !== 'selection' || a.ids.length === 0) return;
  const gone = new Set([...boundaryObjects(ctx, e, a.ids).values()].flat());
  if (gone.size === 0) return;
  if (gone.size === e.geom.loops.length) {
    ctx.message('A hatch keeps at least one boundary.');
    return;
  }
  ctx.edit((b) => {
    const g = loose(b, ctx, e);
    b.updateEntity(e.id, { geom: { ...g, loops: g.loops.filter((_, i) => !gone.has(i)) } });
  });
}

/** recreate Boundary: each loop kept as a polyline on the current layer. */
async function* recreateBoundary(ctx: CommandContext, e: HatchEntity): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Enter type of boundary object',
    options: ['Region', 'Polyline'],
    default: { kind: 'keyword', keyword: 'Polyline' },
  });
  if (keyword(a) === 'Region') {
    ctx.message('Triya cannot make regions.');
    return;
  }
  if (yield* yesNo(ctx, 'Reassociate hatch with new boundary?', false)) {
    ctx.message(NON_ASSOCIATIVE);
  }
  const kept = e.geom.loops.flatMap(retainedBoundary);
  if (kept.length === 0) return;
  ctx.edit((b) => {
    const current = currentProps(ctx.model);
    for (const geom of kept) b.addEntity({ owner: e.owner, ...current, geom });
  });
}

/** separate Hatches: one hatch for each area (see the head comment). */
function separate(ctx: CommandContext, e: HatchEntity): void {
  const areas = hatchAreas(e.geom);
  if (areas.length < 2) {
    ctx.message('The hatch has only one area.');
    return;
  }
  ctx.edit((b) => {
    const g = loose(b, ctx, e);
    const part = (k: number): HatchGeometry => ({
      ...g,
      loops: areas[k]!.loops.map((i) => g.loops[i]!),
      seedPoints: areas[k]!.seeds.map((i) => g.seedPoints[i]!),
    });
    b.updateEntity(e.id, { geom: part(0) });
    const copies: EntityId[] = [];
    for (let k = 1; k < areas.length; k++) {
      const [id] = copyObjects(b, ctx.model, [e.id], moveBy({ x: 0, y: 0 })).ids;
      b.updateEntity(id!, { geom: part(k) });
      copies.push(id!);
    }
    // In order, just above the hatch they came from.
    moveInDrawOrder(b, ctx.model, copies, { to: 'above', reference: [e.id] });
  });
}
