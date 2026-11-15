// POLYGON (M3-01 part 3): a regular polygon as a closed LWPOLYLINE, on AutoCAD 2024's prompts
// (AutoCAD 2024 Help, "POLYGON (Command)"):
//   Enter number of sides <4>:                                 3 to 1024; POLYSIDES
//   Specify center of polygon or [Edge]:
//   Enter an option [Inscribed in circle/Circumscribed about circle] <I>:
//   Specify radius of circle:
//   Edge: Specify first endpoint of edge:  Specify second endpoint of edge:
// A radius picked turns the polygon: a vertex there (inscribed) or an edge's midpoint
// (circumscribed); a radius typed puts the bottom edge level. The number of sides (AutoCAD's
// POLYSIDES, not saved) and the inscribed or circumscribed choice are the drawing's next
// defaults this session. An edge is drawn counter-clockwise from its first endpoint.
import { polygonAbout, polygonOnEdge } from '../../geom/shapes';
import { distance } from '../../geom/vec';
import type { CommandDef } from '../command';
import { currentProps } from '../../properties/current';
import { closed, sketchTolerance } from './sketch';

const SIDES = 'Requires an integer between 3 and 1024.';
const INSCRIBED = 'Inscribed in circle';
const CIRCUMSCRIBED = 'Circumscribed about circle';

/** POLYGON for one document; it remembers the sides and the I/C choice for the next. */
export function polygonCommand(): CommandDef {
  const state = { sides: 4, inscribed: true };
  return {
    name: 'POLYGON',
    async *run(ctx) {
      let sides: number | undefined;
      while (sides === undefined) {
        const a = yield ctx.prompt.integer({
          message: 'Enter number of sides',
          default: { kind: 'number', value: state.sides },
        });
        if (a.kind !== 'number') return;
        if (a.value >= 3 && a.value <= 1024) sides = a.value;
        else ctx.message(SIDES);
      }
      state.sides = sides;
      const props = currentProps(ctx.model);
      const plinegen = ctx.model.header.get('$PLINEGEN') === 1;
      const draw = (vertices: Parameters<typeof closed>[0]): void => {
        const geom = { ...closed(vertices), ...(plinegen && { plinegen }) };
        ctx.edit((b) => b.addEntity({ owner: ctx.space, ...props, geom }));
      };

      const c = yield ctx.prompt.point({
        message: 'Specify center of polygon or',
        options: ['Edge'],
      });
      if (c.kind === 'keyword') {
        const a = yield ctx.prompt.point({ message: 'Specify first endpoint of edge' });
        if (a.kind !== 'point') return;
        for (;;) {
          const b = yield {
            ...ctx.prompt.point({
              message: 'Specify second endpoint of edge',
              rubberBand: { from: a.point },
            }),
            drag: {
              kind: 'sketch',
              sketch: { shape: 'polygonEdge', a: a.point, sides },
              layer: props.layer,
            },
          };
          if (b.kind !== 'point') return;
          if (distance(a.point, b.point) > sketchTolerance(a.point, b.point).linear) {
            return draw(polygonOnEdge(a.point, b.point, sides));
          }
          ctx.message('*Invalid*');
        }
      }
      if (c.kind !== 'point') return;
      const center = c.point;
      const o = yield ctx.prompt.keyword({
        message: 'Enter an option',
        options: [INSCRIBED, CIRCUMSCRIBED],
        defaultLabel: state.inscribed ? 'I' : 'C',
      });
      if (o.kind === 'keyword') state.inscribed = o.keyword === INSCRIBED;
      else if (o.kind !== 'enter') return;
      const inscribed = state.inscribed;
      for (;;) {
        const r = yield {
          ...ctx.prompt.distance({ message: 'Specify radius of circle', base: center }),
          drag: {
            kind: 'sketch',
            sketch: { shape: 'polygon', center, sides, inscribed },
            layer: props.layer,
          },
        };
        if (r.kind !== 'distance') return;
        if (r.value > sketchTolerance(center, r.to ?? center).linear) {
          return draw(polygonAbout(center, r.value, sides, inscribed, r.to));
        }
        ctx.message('Value must be positive and nonzero.');
      }
    },
  };
}
