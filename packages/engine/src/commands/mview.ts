// MVIEW (M6-02 part 1): layout viewports, on AutoCAD 2024's prompts (AutoCAD 2024 Help,
// "MVIEW (Command)"):
//   Specify corner of viewport or [ON/OFF/Fit/Lock/2/3/4] <Fit>:
//     a corner:  Specify opposite corner:                one viewport in that rectangle
//     Fit:       one viewport filling the printable area (the display without a page setup)
//     ON / OFF:  Select objects:                         the viewports picked shown or not
//     Lock:      Viewport View Locking [ON/OFF]:  Select objects:
//     2:         Enter viewport arrangement [Horizontal/Vertical] <Vertical>:
//                Specify first corner or [Fit] <Fit>:  Specify opposite corner:
//     3:         Enter viewport arrangement [Horizontal/Vertical/Above/Below/Left/Right] <Right>:
//                then the area as for 2
//     4:         Specify first corner or [Fit] <Fit>:  Specify opposite corner:
//     Object:    Select object to clip viewport:          a viewport clipped by the object
//     Polygonal: Specify start point:  Specify next point or [Arc/Length/Undo]:  ...
//                                                          a viewport clipped by the polygon
// A new viewport shows model space's extents (AutoCAD zooms each new viewport to them) and goes
// on the current layer. Object and Polygonal (M6-02 part 2) make a non-rectangular viewport
// framed by the object's or the polygon's box and clipped by it, as VPCLIP clips one
// (`vpclip.ts`, `edit/viewport-clip.ts`); the polygon is a closed polyline made first, as
// AutoCAD makes it. AutoCAD's other options wait for later parts of M6-02: Restore (VPORTS'
// configurations), NEw and NAmed (the Viewports dialog) and LAyer (with VPLAYER); Shadeplot is
// 3D (excluded).
// Outside a layout's paper space AutoCAD refuses MVIEW ("** Command not allowed in Model Tab **").
import { unionBox, type Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import { blockExtentsOf } from '../edit/mleader';
import { PAPER_VIEWPORT_FLAGS } from '../edit/named-view';
import { viewportClipFrame, clipObjectProblem, clipViewport } from '../edit/viewport-clip';
import { layoutSheet } from '../layout/sheet';
import { VIEWPORT_LOCKED, VIEWPORT_OFF } from '../layout/viewport';
import type { Entity, LwPolylineGeometry, ViewportGeometry } from '../model/types';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import { currentLayer } from '../properties/current';
import { isPaperSpace, modelSpaceOf } from './bus';
import type { CommandContext, CommandDef } from './command';
import type { Prompt, PromptAnswer } from './prompt';
import { addBoundary, polygonProblem, polygonalBoundary } from './vpclip';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

/**
 * DXF 90 of a viewport MVIEW makes: AutoCAD's own floating viewports carry 819232 (UCS icon
 * shown 32, 32768, grid beyond limits 262144, adaptive grid 524288; sample_AC1015 and later).
 */
export const FLOATING_VIEWPORT_FLAGS = 819_232;

/** How MVIEW 2 and 3 share the area (AutoCAD's arrangement keywords). */
export type ViewportArrangement = 'Horizontal' | 'Vertical' | 'Above' | 'Below' | 'Left' | 'Right';

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({
  minX,
  minY,
  maxX,
  maxY,
});

/**
 * The frames MVIEW makes for `count` viewports in `area`, as AutoCAD arranges them: 2 Horizontal
 * one above the other, Vertical side by side; 3 Horizontal in three rows, Vertical in three
 * columns, Above/Below/Left/Right the large one (half the area) on that side and the other half
 * split in two; 4 in quadrants. The large one first, then top to bottom and left to right.
 */
export function viewportArrangement(
  area: Box,
  count: 1 | 2 | 3 | 4,
  arrangement: ViewportArrangement = 'Right',
): Box[] {
  const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = area;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const top = box(x0, ym, x1, y1);
  const bottom = box(x0, y0, x1, ym);
  const left = box(x0, y0, xm, y1);
  const right = box(xm, y0, x1, y1);
  switch (count) {
    case 1:
      return [area];
    case 2:
      return arrangement === 'Horizontal' ? [top, bottom] : [left, right];
    case 4:
      return [box(x0, ym, xm, y1), box(xm, ym, x1, y1), box(x0, y0, xm, ym), box(xm, y0, x1, ym)];
  }
  const h = (y1 - y0) / 3;
  const w = (x1 - x0) / 3;
  switch (arrangement) {
    case 'Horizontal':
      return [box(x0, y1 - h, x1, y1), box(x0, y0 + h, x1, y1 - h), box(x0, y0, x1, y0 + h)];
    case 'Vertical':
      return [box(x0, y0, x0 + w, y1), box(x0 + w, y0, x1 - w, y1), box(x1 - w, y0, x1, y1)];
    case 'Above':
      return [top, box(x0, y0, xm, ym), box(xm, y0, x1, ym)];
    case 'Below':
      return [bottom, box(x0, ym, xm, y1), box(xm, ym, x1, y1)];
    case 'Left':
      return [left, box(xm, ym, x1, y1), box(xm, y0, x1, ym)];
    case 'Right':
      return [right, box(x0, ym, xm, y1), box(x0, y0, xm, ym)];
  }
}

/**
 * The view a viewport with `frame` shows `extents` in: centred on them and as high as fits them
 * whole (ZOOM Extents in the viewport), in plan, where the display coordinates are the world's.
 * Undefined when `extents` has no size.
 */
export function viewportFit(
  frame: Box,
  extents: Box,
): { center: Vec2; height: number } | undefined {
  const fw = frame.maxX - frame.minX;
  const fh = frame.maxY - frame.minY;
  const ew = extents.maxX - extents.minX;
  const eh = extents.maxY - extents.minY;
  const height = Math.max(eh, fw > 0 ? (ew * fh) / fw : 0);
  if (!(height > 0) || !Number.isFinite(height)) return undefined;
  return {
    center: { x: (extents.minX + extents.maxX) / 2, y: (extents.minY + extents.maxY) / 2 },
    height,
  };
}

/** A plan VIEWPORT with `frame` on the sheet showing `view` of model space. */
export function newViewportGeometry(
  frame: Box,
  view: { center: Vec2; height: number },
  id: number,
  status: number,
  flags: number = FLOATING_VIEWPORT_FLAGS,
): ViewportGeometry {
  return {
    kind: 'VIEWPORT',
    center: { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 },
    width: frame.maxX - frame.minX,
    height: frame.maxY - frame.minY,
    id,
    status,
    flags,
    viewCenter: view.center,
    viewHeight: view.height,
    viewDirection: { x: 0, y: 0, z: 1 },
    viewTarget: { x: 0, y: 0, z: 0 },
    twist: 0,
    lensLength: 50,
    frontClip: 0,
    backClip: 0,
    frozenLayers: [],
    plotStyleSheet: '',
    renderMode: 0,
  };
}

const viewportOf = (e: Entity | undefined): ViewportGeometry | undefined =>
  e?.geom.kind === 'VIEWPORT' ? e.geom : undefined;

/** The box two points span, or undefined when it has no area. */
function spanned(a: Vec2, b: Vec2): Box | undefined {
  const out = box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  return out.maxX > out.minX && out.maxY > out.minY ? out : undefined;
}

/**
 * Model space's extents for a new viewport's view: as the canvas measures them (text by its
 * glyphs), else from the geometry the engine bounds (no text), else model space's limits.
 */
async function modelExtents(ctx: CommandContext): Promise<Box | undefined> {
  const ms = modelSpaceOf(ctx.model);
  const ids = ctx.model.blockEntities(ms);
  if (ids.length > 0) {
    const r = await ctx.view.request({ op: 'bounds', ids });
    if (r.ok && r.box) return r.box;
    const own = blockExtentsOf(ctx.model, ms);
    if (own) {
      const base = ctx.model.blocks.get(ms)?.basePoint ?? { x: 0, y: 0 };
      return box(own.minX + base.x, own.minY + base.y, own.maxX + base.x, own.maxY + base.y);
    }
  }
  const lo = ctx.model.header.get('$LIMMIN') as Vec2 | undefined;
  const hi = ctx.model.header.get('$LIMMAX') as Vec2 | undefined;
  return lo && hi ? spanned(lo, hi) : undefined;
}

/** What Fit fills: the layout's printable area, else the display (no page setup). */
async function fitArea(ctx: CommandContext): Promise<Box | undefined> {
  const layout = ctx.model.layouts.find((l) => l.blockRecord === ctx.space);
  const sheet = layout && layoutSheet(layout);
  if (sheet) return sheet.printable;
  const r = await ctx.view.request({ op: 'get' });
  if (r.ok && r.view) {
    const { center: c, width: w, height: h } = r.view;
    return spanned({ x: c.x - w / 2, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y + h / 2 });
  }
  const lim = layout?.limits;
  return lim ? spanned(lim.min, lim.max) : undefined;
}

/** A point prompt's answer that is no keyword: the bus lets no other kind through. */
const pointOf = (a: PromptAnswer): Vec2 => (a as { point: Vec2 }).point;

/** Fit's area, or a message why there is none. */
async function fit(ctx: CommandContext): Promise<Box | undefined> {
  const out = await fitArea(ctx);
  if (!out) ctx.message('The layout has no printable area to fit.');
  return out;
}

/** "Specify first corner or [Fit] <Fit>:" (or MVIEW's own first prompt's corner): the area. */
async function* area(ctx: CommandContext, first?: Vec2): Sub<Box | undefined> {
  for (;;) {
    let corner = first;
    first = undefined;
    if (!corner) {
      const a = yield ctx.prompt.point({
        message: 'Specify first corner or',
        options: ['Fit'],
        default: { kind: 'keyword', keyword: 'Fit' },
      });
      // Enter or Fit; anything else ends the command first.
      if (a.kind === 'keyword') return fit(ctx);
      corner = pointOf(a);
    }
    const b = yield ctx.prompt.point({
      message: 'Specify opposite corner',
      rubberBand: { from: corner, box: true },
    });
    const out = spanned(corner, pointOf(b));
    if (out) return out;
    // AutoCAD's message for a viewport with no width or height.
    ctx.message('Invalid window specification.');
  }
}

/** What clips a new viewport: an object of the space shown, or a polygon to make first. */
type NewClip = { readonly id: EntityId } | { readonly polygon: LwPolylineGeometry };

/**
 * Makes viewports with `frames` in the space shown, each showing model space's extents; the one
 * viewport framed by `clip`'s box is clipped by it (Object, Polygonal).
 */
async function addViewports(
  ctx: CommandContext,
  frames: readonly Box[],
  clip?: NewClip,
): Promise<void> {
  const space = ctx.space;
  const extents = await modelExtents(ctx);
  const all = [...ctx.model.entities()].filter((e) => e.geom.kind === 'VIEWPORT');
  const here = all.filter((e) => e.owner === space);
  // DXF 69: AutoCAD numbers viewports uniquely; 1 is a layout's own paper-space viewport.
  let id = Math.max(1, ...all.map((e) => (e.geom as ViewportGeometry).id)) + 1;
  // DXF 68: on and its place in the stack in the current layout (*Paper_Space), 0 in another.
  const current = ctx.model.blocks.get(space)?.name.toUpperCase() === '*PAPER_SPACE';
  let status = Math.max(0, ...here.map((e) => (e.geom as ViewportGeometry).status));
  const layer = currentLayer(ctx.model);
  ctx.edit((b) => {
    if (here.length === 0) {
      // A layout shown with no viewport yet gets its own paper-space one (id 1) first, as
      // AutoCAD makes it the first time a layout is shown; the save writes the view shown into
      // it (`paperViewsChange`). Its frame is the sheet until then.
      const layout = ctx.model.layouts.find((l) => l.blockRecord === space);
      const lim = layout?.limits && spanned(layout.limits.min, layout.limits.max);
      const sheet = (layout && layoutSheet(layout)?.paper) ?? lim ?? frames.reduce(unionBox);
      const view = {
        center: { x: (sheet.minX + sheet.maxX) / 2, y: (sheet.minY + sheet.maxY) / 2 },
        height: sheet.maxY - sheet.minY,
      };
      status = current ? 1 : 0;
      b.addEntity({
        owner: space,
        layer: zeroLayer(ctx) ?? layer,
        geom: newViewportGeometry(sheet, view, 1, status, PAPER_VIEWPORT_FLAGS),
      });
    }
    // The polygon is made before the viewport it clips, as AutoCAD makes it (its handle is the
    // lower: text_in_viewports.dxf).
    const boundary = clip && ('id' in clip ? clip.id : addBoundary(ctx, b, clip.polygon));
    for (const frame of frames) {
      // Nothing in model space to show: the viewport shows it 1:1 about the frame.
      const view = (extents && viewportFit(frame, extents)) ?? {
        center: { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 },
        height: frame.maxY - frame.minY,
      };
      const vp = b.addEntity({
        owner: space,
        layer,
        geom: newViewportGeometry(frame, view, id++, current ? ++status : 0),
      });
      if (boundary !== undefined) clipViewport(b, ctx.model, vp.id, boundary);
    }
  });
}

const zeroLayer = (ctx: CommandContext): Handle | undefined =>
  [...ctx.model.tables.layers.values()].find((l) => l.name === '0')?.handle;

/**
 * "Select objects:" for ON, OFF and Lock: the floating viewports of the space shown among the
 * objects picked (a layout's own paper-space viewport is never one).
 */
async function* viewportsPicked(ctx: CommandContext): Sub<EntityId[]> {
  const a = yield ctx.prompt.selection({ message: 'Select objects', editable: true });
  return (a as { ids: readonly EntityId[] }).ids.filter((id) => {
    const e = ctx.model.entity(id);
    const g = viewportOf(e);
    return g !== undefined && g.id !== 1 && e!.owner === ctx.space;
  });
}

/** ON and OFF: the viewports picked shown or not (DXF 90 bit 0x20000, and 68 with it). */
async function* onOff(ctx: CommandContext, on: boolean): Sub<void> {
  const ids = yield* viewportsPicked(ctx);
  if (ids.length === 0) return;
  const current = ctx.model.blocks.get(ctx.space)?.name.toUpperCase() === '*PAPER_SPACE';
  let status = Math.max(
    0,
    ...ctx.model
      .blockEntities(ctx.space)
      .map((id) => viewportOf(ctx.model.entity(id))?.status ?? 0),
  );
  ctx.edit((b) => {
    for (const id of ids) {
      const g = viewportOf(ctx.model.entity(id))!;
      const off = (g.flags & VIEWPORT_OFF) !== 0;
      if (off === !on) continue;
      // DXF 68 is 0 for a viewport that is off (DXF reference), its place in the stack again
      // once it is on in the current layout.
      b.updateEntity(id, {
        geom: {
          ...g,
          flags: on ? g.flags & ~VIEWPORT_OFF : g.flags | VIEWPORT_OFF,
          status: on && current ? ++status : on ? g.status : 0,
        },
      });
    }
  });
}

/** Lock: "Viewport View Locking [ON/OFF]:" and the viewports picked (DXF 90 bit 0x4000). */
async function* lock(ctx: CommandContext): Sub<void> {
  const a = yield ctx.prompt.keyword({
    message: 'Viewport View Locking',
    options: ['ON', 'OFF'],
  });
  const locked = (a as { keyword: string }).keyword === 'ON';
  const ids = yield* viewportsPicked(ctx);
  ctx.edit((b) => {
    for (const id of ids) {
      const g = viewportOf(ctx.model.entity(id))!;
      const flags = locked ? g.flags | VIEWPORT_LOCKED : g.flags & ~VIEWPORT_LOCKED;
      if (flags !== g.flags) b.updateEntity(id, { geom: { ...g, flags } });
    }
  });
}

/** Object: "Select object to clip viewport:" until an object that clips one is picked. */
async function* clipObject(ctx: CommandContext): Sub<EntityId | undefined> {
  for (;;) {
    const a = yield ctx.prompt.selection({
      message: 'Select object to clip viewport',
      single: true,
    });
    const ids = (a as { ids: readonly EntityId[] }).ids;
    if (ids.length === 0) return undefined;
    const e = ctx.model.entity(ids[0]!)!;
    const problem = clipObjectProblem(ctx.model, e, ctx.space);
    if (!problem) return e.id;
    ctx.message(problem);
  }
}

export function mviewCommand(): CommandDef {
  return {
    name: 'MVIEW',
    async *run(ctx) {
      // Viewports are paper space's objects: from a viewport made current, AutoCAD's MVIEW and
      // VPCLIP work in paper space, which the layout stays in (M6-02 part 3).
      if (ctx.viewport.current !== undefined) await ctx.viewport.set(undefined);
      // The Block Editor works in a block definition, as in model space.
      if (!isPaperSpace(ctx.model, ctx.space)) {
        ctx.message('** Command not allowed in Model Tab **');
        return;
      }
      const a = yield ctx.prompt.point({
        message: 'Specify corner of viewport or',
        options: ['ON', 'OFF', 'Fit', 'Lock', 'Object', 'Polygonal', '2', '3', '4'],
        default: { kind: 'keyword', keyword: 'Fit' },
      });
      if (a.kind !== 'keyword') {
        const frame = yield* area(ctx, pointOf(a));
        if (frame) await addViewports(ctx, [frame]);
        return;
      }
      switch (a.keyword) {
        case 'ON':
        case 'OFF':
          yield* onOff(ctx, a.keyword === 'ON');
          return;
        case 'Lock':
          yield* lock(ctx);
          return;
        case 'Object': {
          const id = yield* clipObject(ctx);
          if (id !== undefined) {
            const frame = viewportClipFrame(ctx.model.entity(id)!.geom)!;
            await addViewports(ctx, [frame], { id });
          }
          return;
        }
        case 'Polygonal': {
          const polygon = yield* polygonalBoundary(ctx, polygonProblem);
          if (polygon) await addViewports(ctx, [viewportClipFrame(polygon)!], { polygon });
          return;
        }
        case 'Fit': {
          const frame = await fit(ctx);
          if (frame) await addViewports(ctx, [frame]);
          return;
        }
        case '2':
        case '3': {
          const two = a.keyword === '2';
          const options: ViewportArrangement[] = two
            ? ['Horizontal', 'Vertical']
            : ['Horizontal', 'Vertical', 'Above', 'Below', 'Left', 'Right'];
          const k = yield ctx.prompt.keyword({
            message: 'Enter viewport arrangement',
            options,
            default: { kind: 'keyword', keyword: two ? 'Vertical' : 'Right' },
          });
          const frame = yield* area(ctx);
          if (frame) {
            const arrangement = (k as { keyword: ViewportArrangement }).keyword;
            await addViewports(ctx, viewportArrangement(frame, two ? 2 : 3, arrangement));
          }
          return;
        }
        case '4': {
          const frame = yield* area(ctx);
          if (frame) await addViewports(ctx, viewportArrangement(frame, 4));
          return;
        }
      }
    },
  };
}
