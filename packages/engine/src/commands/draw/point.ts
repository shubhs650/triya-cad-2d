// POINT and DONUT (M3-01 part 4), on AutoCAD 2024's prompts (AutoCAD 2024 Help, "POINT
// (Command)", "DONUT (Command)"):
//   POINT: Current point modes:  PDMODE=0  PDSIZE=0.0000
//          Specify a point:
//   DONUT: Specify inside diameter of donut <0.5000>:
//          Specify outside diameter of donut <1.0000>:
//          Specify center of donut or <exit>:            again and again; Enter ends
// POINT places one point, as AutoCAD's command line does (the ribbon's Multiple Points repeats
// it, M7-01). How points show is PDMODE and PDSIZE, drawn by the renderer (`@triya/render`
// `pointFigure`). A donut is a closed LWPOLYLINE of two half-circle arcs with a constant width
// (`geom/shapes.ts` `donutOf`); its diameters are remembered for the next DONUT, as AutoCAD's
// DONUTID and DONUTOD (initially 0.5 and 1), which it does not save.
import { donutOf } from '../../geom/ellipse-xline';
import type { HeaderValue } from '../../model/types';
import type { CommandDef } from '../command';
import type { Prompt, PromptAnswer } from '../prompt';
import { currentProps } from '../../properties/current';
import { drawingUnits, formatNumber } from '../units';

export function pointCommand(): CommandDef {
  return {
    name: 'POINT',
    async *run(ctx) {
      const mode = ctx.model.header.get('$PDMODE');
      const size = ctx.model.header.get('$PDSIZE');
      const units = drawingUnits(ctx.model.header);
      ctx.message(
        `Current point modes:  PDMODE=${typeof mode === 'number' ? mode : 0}  PDSIZE=${formatNumber(
          typeof size === 'number' ? size : 0,
          units.luprec,
        )}`,
      );
      const a = yield ctx.prompt.point({ message: 'Specify a point' });
      if (a.kind !== 'point') return;
      const props = currentProps(ctx.model);
      ctx.edit((b) =>
        b.addEntity({ owner: ctx.space, ...props, geom: { kind: 'POINT', position: a.point } }),
      );
    },
  };
}

/** DONUT for one document: it remembers the diameters (DONUTID, DONUTOD) for the next. */
export function donutCommand(): CommandDef {
  const state = { inside: 0.5, outside: 1 };
  return {
    name: 'DONUT',
    async *run(ctx) {
      const diameter = async function* (
        which: 'inside' | 'outside',
      ): AsyncGenerator<Prompt, boolean, PromptAnswer> {
        for (;;) {
          const a = yield ctx.prompt.distance({
            message: `Specify ${which} diameter of donut`,
            default: { kind: 'distance', value: state[which] },
          });
          if (a.kind !== 'distance') return false;
          // AutoCAD takes a zero inside diameter (a filled circle) but no negative one.
          if (a.value > 0 || (which === 'inside' && a.value === 0)) {
            state[which] = a.value;
            return true;
          }
          ctx.message(
            which === 'inside' ? 'Value must be positive.' : 'Value must be positive and nonzero.',
          );
        }
      };
      if (!(yield* diameter('inside'))) return;
      if (!(yield* diameter('outside'))) return;
      const { inside, outside } = state;
      for (;;) {
        const props = currentProps(ctx.model);
        const a = yield {
          ...ctx.prompt.point({ message: 'Specify center of donut or', defaultLabel: 'exit' }),
          drag: { kind: 'sketch', sketch: { shape: 'donut', inside, outside }, layer: props.layer },
        };
        if (a.kind !== 'point') return;
        const d = donutOf(a.point, inside, outside);
        ctx.edit((b) =>
          b.addEntity({
            owner: ctx.space,
            ...props,
            geom: {
              kind: 'LWPOLYLINE',
              vertices: d.vertices,
              closed: true,
              constantWidth: d.width,
            },
          }),
        );
      }
    },
  };
}

/**
 * The PDMODE values AutoCAD has (AutoCAD 2024 Help, "PDMODE (System Variable)"): a figure (0 dot,
 * 1 none, 2 plus, 3 cross, 4 tick) with 32 adding a circle, 64 a square, 96 both. In the Point
 * Style dialog's order: a row of each, left to right.
 */
export const POINT_MODES: readonly number[] = [0, 32, 64, 96].flatMap((ring) =>
  [0, 1, 2, 3, 4].map((figure) => ring + figure),
);

/**
 * DDPTYPE (M3-01 part 6): the Point Style dialog (AutoCAD 2024 Help, "Point Style Dialog Box"),
 * opened on PDMODE and PDSIZE. OK sets those that changed in one undo step, as AutoCAD's dialog
 * sets the two variables; the points are drawn anew by the renderer, which reads them each
 * frame. Cancel (Esc) changes nothing. An answer with a mode AutoCAD has not or a size that is no
 * number is ignored, as the dialog cannot give one.
 */
export function ddptypeCommand(): CommandDef {
  return {
    name: 'DDPTYPE',
    async *run(ctx) {
      const mode = numberOr(ctx.model.header.get('$PDMODE'), 0);
      const size = numberOr(ctx.model.header.get('$PDSIZE'), 0);
      const a = yield ctx.prompt.dialog({
        message: 'Point Style',
        dialog: { type: 'pointstyle', mode, size },
      });
      if (a.kind !== 'dialog' || a.action !== 'ok' || !a.pointStyle) return;
      const next = a.pointStyle;
      if (!POINT_MODES.includes(next.mode) || !Number.isFinite(next.size)) return;
      const entries: [string, HeaderValue][] = [];
      if (next.mode !== mode) entries.push(['$PDMODE', next.mode]);
      if (next.size !== size) entries.push(['$PDSIZE', next.size]);
      if (entries.length > 0) ctx.edit((b) => entries.forEach(([k, v]) => b.setHeader(k, v)));
    },
  };
}

const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
