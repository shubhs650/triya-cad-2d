// ZOOM, PAN, REGEN and REGENALL (M2-02 part 2), AutoCAD 2024's prompts and options; they change
// the view through the view host (host.ts), never the drawing. ZOOM and PAN are transparent
// (`'Z`, `'P`). ZOOM Dynamic picks a window, as COMMANDS.md allows (AutoCAD's view box is a
// relic of slow regenerations). ZOOM Object (M2-03) fits the view around the objects selected,
// the pre-selection if there is one.
//   Specify corner of window, enter a scale factor (nX or nXP), or
//   [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:
// (AutoCAD 2024 Help, "ZOOM (Command)", "PAN (Command)", "-PAN (Command)", "REGEN (Command)").
import type { Vec2 } from '../../geom/types';
import type { CommandContext, CommandDef, CommandGenerator } from '../command';
import type { ViewReply, ViewRequest } from './host';

const ZOOM_OPTIONS = [
  'All',
  'Center',
  'Dynamic',
  'Extents',
  'Previous',
  'Scale',
  'Window',
  'Object',
];

/** AutoCAD's answer to anything ZOOM cannot read. */
export const ZOOM_INVALID = 'Requires a distance, numberX, or option keyword.';
const NOT_POSITIVE = 'Value must be positive and nonzero.';

export interface ZoomScale {
  readonly factor: number;
  /** `n` is relative to the limits, `nX` to the current view, `nXP` to paper space units. */
  readonly relativeTo: 'limits' | 'view' | 'paper';
}

/** A ZOOM scale as typed: `2`, `0.5x`, `1/48xp`'s decimal `0.0208xp`. Undefined if it is not one. */
export function parseZoomScale(text: string): ZoomScale | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(xp|x)?$/i.exec(text.trim());
  if (!m) return undefined;
  const unit = m[2]?.toLowerCase();
  return {
    factor: Number(m[1]),
    relativeTo: unit === 'x' ? 'view' : unit === 'xp' ? 'paper' : 'limits',
  };
}

/** Asks the view host, saying on the command line why it refused. */
export async function viewRequest(ctx: CommandContext, r: ViewRequest): Promise<ViewReply> {
  const reply = await ctx.view.request(r);
  if (!reply.ok) ctx.message(reply.message);
  return reply;
}

/** Real-time PAN or ZOOM with the left button, until Enter or Esc. */
async function* realtime(ctx: CommandContext, mode: 'pan' | 'zoom'): CommandGenerator {
  if (!(await viewRequest(ctx, { op: 'realtime', mode })).ok) return;
  try {
    yield ctx.prompt.keyword({ message: 'Press ESC or ENTER to exit' });
  } finally {
    await ctx.view.request({ op: 'realtime', mode: 'none' });
  }
}

/** A window from its first corner (picked or asked for) to the opposite one. */
async function* zoomWindow(ctx: CommandContext, corner?: Vec2): CommandGenerator {
  let a = corner;
  if (!a) {
    const first = yield ctx.prompt.point({ message: 'Specify first corner' });
    if (first.kind !== 'point') return;
    a = first.point;
  }
  const b = yield ctx.prompt.point({
    message: 'Specify opposite corner',
    rubberBand: { from: a, box: true },
  });
  if (b.kind === 'point') await viewRequest(ctx, { op: 'window', a, b: b.point });
}

async function zoomScale(ctx: CommandContext, s: ZoomScale): Promise<void> {
  if (!(s.factor > 0)) return ctx.message(NOT_POSITIVE);
  await viewRequest(ctx, { op: 'scale', ...s });
}

async function* zoomCenter(ctx: CommandContext): CommandGenerator {
  const c = yield ctx.prompt.point({ message: 'Specify center point' });
  if (c.kind !== 'point') return;
  const now = await viewRequest(ctx, { op: 'get' });
  if (!now.ok || !now.view) return;
  for (;;) {
    const a = yield ctx.prompt.distance({
      message: 'Enter magnification or height',
      default: { kind: 'distance', value: now.view.height },
      base: c.point,
      arbitrary: true,
    });
    if (a.kind === 'distance') {
      if (!(a.value > 0)) {
        ctx.message(NOT_POSITIVE);
        continue;
      }
      await viewRequest(ctx, { op: 'center', center: c.point, height: a.value });
      return;
    }
    if (a.kind !== 'string') return;
    const s = parseZoomScale(a.value);
    if (!s) {
      ctx.message(ZOOM_INVALID);
      continue;
    }
    if (!(s.factor > 0)) {
      ctx.message(NOT_POSITIVE);
      continue;
    }
    // nX magnifies the current view; nXP centres first, then scales against paper space.
    const height = s.relativeTo === 'view' ? now.view.height / s.factor : now.view.height;
    if (!(await viewRequest(ctx, { op: 'center', center: c.point, height })).ok) return;
    if (s.relativeTo === 'paper') await zoomScale(ctx, s);
    return;
  }
}

export function zoomCommand(): CommandDef {
  return {
    name: 'ZOOM',
    transparent: true,
    async *run(ctx) {
      for (;;) {
        const a = yield ctx.prompt.point({
          message: 'Specify corner of window, enter a scale factor (nX or nXP), or',
          options: ZOOM_OPTIONS,
          defaultLabel: 'real time',
          arbitrary: true,
        });
        if (a.kind === 'point') return yield* zoomWindow(ctx, a.point);
        if (a.kind === 'enter') return yield* realtime(ctx, 'zoom');
        if (a.kind === 'string') {
          const s = parseZoomScale(a.value);
          if (!s) {
            ctx.message(ZOOM_INVALID);
            continue;
          }
          return zoomScale(ctx, s);
        }
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'All':
            return void (await viewRequest(ctx, { op: 'all' }));
          case 'Center':
            return yield* zoomCenter(ctx);
          case 'Extents':
            return void (await viewRequest(ctx, { op: 'extents' }));
          case 'Previous':
            return void (await viewRequest(ctx, { op: 'previous' }));
          case 'Object': {
            const sel = yield ctx.prompt.selection({ message: 'Select objects' });
            if (sel.kind !== 'selection' || sel.ids.length === 0) return;
            return void (await viewRequest(ctx, { op: 'objects', ids: sel.ids }));
          }
          case 'Scale':
            for (;;) {
              const t = yield ctx.prompt.string({ message: 'Enter a scale factor (nX or nXP)' });
              if (t.kind !== 'string') return;
              const s = parseZoomScale(t.value);
              if (s) return zoomScale(ctx, s);
              ctx.message(ZOOM_INVALID);
            }
          default:
            // Window, and Dynamic as a window.
            return yield* zoomWindow(ctx);
        }
      }
    },
  };
}

/** PAN (real time) and -PAN (a displacement, or two points). */
export function panCommand(): CommandDef {
  return {
    name: 'PAN',
    transparent: true,
    dashVariant: true,
    async *run(ctx) {
      if (!ctx.dash) return yield* realtime(ctx, 'pan');
      const a = yield ctx.prompt.point({ message: 'Specify base point or displacement' });
      if (a.kind !== 'point') return;
      const b = yield ctx.prompt.point({
        message: 'Specify second point',
        rubberBand: { from: a.point },
      });
      // Enter at the second point makes the first a displacement, as with MOVE.
      const by =
        b.kind === 'point'
          ? { x: b.point.x - a.point.x, y: b.point.y - a.point.y }
          : b.kind === 'enter'
            ? a.point
            : undefined;
      if (by) await viewRequest(ctx, { op: 'pan', by });
    },
  };
}

/** REGEN (the space shown) and REGENALL (every viewport of it). */
export function regenCommand(all: boolean): CommandDef {
  return {
    name: all ? 'REGENALL' : 'REGEN',
    // eslint-disable-next-line require-yield -- a command that prompts for nothing
    async *run(ctx) {
      const r = await viewRequest(ctx, { op: 'regen', all });
      if (r.ok) ctx.message(r.view?.paper ? 'Regenerating layout.' : 'Regenerating model.');
    },
  };
}
