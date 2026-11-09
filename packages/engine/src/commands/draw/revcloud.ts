// REVCLOUD (M2-08) with AutoCAD 2024's prompts (AutoCAD 2024 Help, "REVCLOUD (Command)",
// REVCLOUDCREATETYPE):
//   Minimum arc length: 0.5000   Maximum arc length: 0.5000   Style: Normal   Type: Rectangular
//   Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style] <Object>:
// Rectangular asks for the opposite corner; Polygonal for points until Enter; Freehand follows
// the crosshairs and closes when they come back to the start; Object turns a circle, ellipse,
// polyline or spline into a cloud in its place. The cloud is an LWPOLYLINE of arcs
// (edit/revcloud.ts). Modify (AutoCAD 2021+) is not offered yet (ROADMAP M2-24).
//
// The arc lengths and style stay for the drawing's session, as AutoCAD keeps them. AutoCAD
// 2021+ sizes the first cloud's arcs as a fraction of the view's diagonal; the fraction is not
// documented, Triya takes 1/40 to two significant figures (0.5 × DIMSCALE without a view, the
// pre-2021 default).
import type { Vec2 } from '../../geom/types';
import { distance } from '../../geom/vec';
import type { ChangeSetBuilder } from '../../model/builder';
import type { DocumentModel } from '../../model/document';
import type { EntityId } from '../../model/entity-ids';
import type { Handle } from '../../model/handle';
import type { Entity, LwPolylineGeometry, Xdata } from '../../model/types';
import {
  REVCLOUD_APP,
  REVCLOUD_MAX_ARCS,
  cloudArcCount,
  cloudPoints,
  cloudPolyline,
  cloudRandom,
  cloudRunsOf,
  polygonRuns,
  rectangleCorners,
  type CloudStyle,
} from '../../edit/revcloud';
import { formatNumber, type Prompt, type PromptAnswer } from '../prompt';
import type { CommandContext, CommandDef } from '../command';
import { currentLayer } from './line';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

export type CloudType = 'Rectangular' | 'Polygonal' | 'Freehand';

const OPTIONS = ['Arc length', 'Object', 'Rectangular', 'Polygonal', 'Freehand', 'Style'];

const FIRST_POINT: Record<CloudType, string> = {
  Rectangular: 'Specify first corner point',
  Polygonal: 'Specify start point',
  Freehand: 'Specify first point',
};

/** AutoCAD refuses a maximum arc length over three times the minimum. */
const MAX_OVER_MIN = 3;

/** Two significant figures: 12.875 → 13, 0.4321 → 0.43. */
function twoFigures(v: number): number {
  const p = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / p) * p;
}

/** Precision of numbers on the command line: LUPREC, 4 unless the drawing says. */
function precision(model: DocumentModel): number {
  const v = model.header.get('$LUPREC');
  return typeof v === 'number' && v >= 0 && v <= 8 ? v : 4;
}

/** The `RevcloudProps` APPID, added to the drawing when it has none. */
export function revcloudAppId(b: ChangeSetBuilder, model: DocumentModel): Handle {
  for (const r of model.tables.appIds.values()) {
    if (r.name.toUpperCase() === REVCLOUD_APP.toUpperCase()) return r.handle;
  }
  return b.addTableRecord('appIds', { name: REVCLOUD_APP, flags: 0 }).handle;
}

/** The xdata AutoCAD 2021+ marks a revision cloud with: 1070 0, 1040 the arc length. */
export const revcloudXdata = (appId: Handle, arc: number): Xdata => [
  {
    appId,
    values: [
      { code: 1070, value: 0 },
      { code: 1040, value: arc },
    ],
  },
];

/** The properties a converted object hands its cloud: everything but its geometry. */
function propsOf(e: Entity) {
  return {
    layer: e.layer,
    color: e.color,
    linetype: e.linetype,
    lineweight: e.lineweight,
    transparency: e.transparency,
    ltScale: e.ltScale,
    visible: e.visible,
    ...(e.plotStyle !== undefined && { plotStyle: e.plotStyle }),
    ...(e.material !== undefined && { material: e.material }),
  };
}

export function revcloudCommand(): CommandDef {
  let style: CloudStyle | undefined;
  let type: CloudType = 'Rectangular';

  async function initialStyle(ctx: CommandContext): Promise<CloudStyle> {
    const view = await ctx.view.request({ op: 'get' });
    let arc: number;
    if (view.ok && view.view && view.view.height > 0) {
      arc = twoFigures(Math.hypot(view.view.width, view.view.height) / 40);
    } else {
      const dimscale = ctx.model.header.get('$DIMSCALE');
      arc = 0.5 * (typeof dimscale === 'number' && dimscale > 0 ? dimscale : 1);
    }
    return { minArc: arc, maxArc: arc, calligraphy: false };
  }

  function status(ctx: CommandContext, s: CloudStyle): void {
    const n = (v: number) => formatNumber(v, precision(ctx.model));
    ctx.message(
      `Minimum arc length: ${n(s.minArc)}   Maximum arc length: ${n(s.maxArc)}   ` +
        `Style: ${s.calligraphy ? 'Calligraphy' : 'Normal'}   Type: ${type}`,
    );
  }

  /** Adds the cloud; false (and a message) when it would have too many arcs. */
  function add(
    ctx: CommandContext,
    points: readonly Vec2[],
    closed: boolean,
    reverse = false,
    replaces?: Entity,
  ): EntityId | undefined {
    const s = style!;
    let id: EntityId | undefined;
    ctx.edit((b) => {
      const geom: LwPolylineGeometry = cloudPolyline(points, closed, s, reverse);
      const appId = revcloudAppId(b, ctx.model);
      const xdata = revcloudXdata(appId, s.minArc);
      if (replaces) {
        b.removeEntity(replaces.id);
        id = b.addEntity({ owner: replaces.owner, ...propsOf(replaces), geom, xdata }).id;
      } else {
        id = b.addEntity({ owner: ctx.space, layer: currentLayer(ctx.model), geom, xdata }).id;
      }
    });
    return id;
  }

  function tooMany(ctx: CommandContext, runs: readonly (readonly Vec2[])[]): boolean {
    if (cloudArcCount(runs, style!) <= REVCLOUD_MAX_ARCS) return false;
    ctx.message(
      `The arc length is too small for this cloud (over ${REVCLOUD_MAX_ARCS} arcs). ` +
        'Specify a longer arc length.',
    );
    return true;
  }

  async function* arcLength(ctx: CommandContext): Sub<void> {
    const s = style!;
    let min: number | undefined;
    while (min === undefined) {
      const a = yield ctx.prompt.distance({
        message: 'Specify minimum length of arc',
        default: { kind: 'distance', value: s.minArc },
      });
      if (a.kind !== 'distance') return;
      if (a.value > 0) min = a.value;
      else ctx.message('Requires a positive value.');
    }
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: 'Specify maximum length of arc',
        default: { kind: 'distance', value: Math.min(Math.max(s.maxArc, min), MAX_OVER_MIN * min) },
      });
      if (a.kind !== 'distance') return;
      if (a.value < min) ctx.message('Maximum arc length cannot be less than minimum arc length.');
      else if (a.value > MAX_OVER_MIN * min) {
        ctx.message('Maximum arc length cannot exceed 3 times the minimum arc length.');
      } else {
        style = { ...s, minArc: min, maxArc: a.value };
        return;
      }
    }
  }

  async function* arcStyle(ctx: CommandContext): Sub<void> {
    const now = style!.calligraphy ? 'Calligraphy' : 'Normal';
    const a = yield ctx.prompt.keyword({
      message: 'Select arc style',
      options: ['Normal', 'Calligraphy'],
      default: { kind: 'keyword', keyword: now },
    });
    if (a.kind !== 'keyword') return;
    style = { ...style!, calligraphy: a.keyword === 'Calligraphy' };
    ctx.message(`Arc style = ${a.keyword}`);
  }

  /** "Reverse direction [Yes/No] <No>:", undefined when cancelled by another answer. */
  async function* reverse(ctx: CommandContext): Sub<boolean | undefined> {
    const a = yield ctx.prompt.keyword({
      message: 'Reverse direction',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    return a.kind === 'keyword' ? a.keyword === 'Yes' : undefined;
  }

  async function* object(ctx: CommandContext): Sub<void> {
    for (;;) {
      const a = yield ctx.prompt.selection({
        message: 'Select object',
        single: true,
        editable: true,
      });
      if (a.kind !== 'selection' || a.ids.length === 0) return;
      const e = ctx.model.entity(a.ids[0]!)!;
      const s = style!;
      const runs = cloudRunsOf(e.geom, s.minArc / 1000);
      if (!runs) {
        ctx.message('Select a circle, ellipse, polyline or spline.');
        continue;
      }
      if (tooMany(ctx, runs.runs)) return;
      const back = yield* reverse(ctx);
      if (back === undefined) return;
      const points = cloudPoints(runs.runs, runs.closed, s, cloudRandom());
      add(ctx, points, runs.closed, back, e);
      ctx.message('Revision cloud finished.');
      return;
    }
  }

  async function* rectangular(ctx: CommandContext, first: Vec2): Sub<void> {
    const a = yield ctx.prompt.point({
      message: 'Specify opposite corner',
      rubberBand: { from: first, box: true },
    });
    if (a.kind !== 'point') return;
    if (a.point.x === first.x || a.point.y === first.y) {
      ctx.message('The corners must not be on one horizontal or vertical line.');
      return;
    }
    const runs = polygonRuns(rectangleCorners(first, a.point));
    if (tooMany(ctx, runs)) return;
    add(ctx, cloudPoints(runs, true, style!), true);
  }

  async function* polygonal(ctx: CommandContext, first: Vec2): Sub<void> {
    const corners: Vec2[] = [first];
    for (;;) {
      if (corners.length > 1) {
        const runs = polygonRuns(corners).slice(0, -1);
        ctx.preview(
          cloudArcCount(runs, style!) <= REVCLOUD_MAX_ARCS
            ? [cloudPolyline(cloudPoints(runs, false, style!), false, style!)]
            : [],
        );
      }
      const a = yield ctx.prompt.point({
        message: corners.length === 1 ? 'Specify next point' : 'Specify next point or',
        ...(corners.length > 1 && { options: ['Undo'] }),
        rubberBand: { from: corners.at(-1)! },
      });
      if (a.kind === 'point') corners.push(a.point);
      else if (a.kind === 'keyword') corners.pop();
      else if (a.kind === 'enter') {
        if (corners.length < 3) {
          ctx.message('A polygonal cloud needs three or more points.');
          if (corners.length === 1) return;
          continue;
        }
        const runs = polygonRuns(corners);
        if (tooMany(ctx, runs)) return;
        add(ctx, cloudPoints(runs, true, style!), true);
        return;
      } else return;
      if (corners.length === 0) return;
    }
  }

  async function* freehand(ctx: CommandContext, first: Vec2): Sub<void> {
    const points: Vec2[] = [first];
    const next = cloudRandom();
    const spacing = () => {
      const s = style!;
      return s.maxArc > s.minArc ? s.minArc + (s.maxArc - s.minArc) * next() : s.minArc;
    };
    let gap = spacing();
    for (;;) {
      if (points.length > 1) ctx.preview([cloudPolyline(points, false, style!)]);
      const a = yield ctx.prompt.point({
        message: 'Guide crosshairs along cloud path',
        trace: { from: points.at(-1)!, spacing: gap },
      });
      if (a.kind === 'point') {
        // Back at the start once the cloud has gone round: it closes there.
        if (points.length >= 4 && distance(a.point, first) < gap) {
          add(ctx, points, true);
          ctx.message('Revision cloud finished.');
          return;
        }
        if (distance(a.point, points.at(-1)!) > 0) points.push(a.point);
        if (points.length > REVCLOUD_MAX_ARCS) {
          ctx.message(`A revision cloud has at most ${REVCLOUD_MAX_ARCS} arcs.`);
          return;
        }
        gap = spacing();
      } else if (a.kind === 'enter') {
        if (points.length < 2) return;
        const back = yield* reverse(ctx);
        if (back === undefined) return;
        add(ctx, points, false, back);
        ctx.message('Revision cloud finished.');
        return;
      } else return;
    }
  }

  return {
    name: 'REVCLOUD',
    async *run(ctx) {
      style ??= await initialStyle(ctx);
      status(ctx, style);
      for (;;) {
        const a = yield ctx.prompt.point({
          message: `${FIRST_POINT[type]} or`,
          options: OPTIONS,
          defaultLabel: 'Object',
        });
        if (a.kind === 'point') {
          if (type === 'Rectangular') return yield* rectangular(ctx, a.point);
          if (type === 'Polygonal') return yield* polygonal(ctx, a.point);
          return yield* freehand(ctx, a.point);
        }
        if (a.kind === 'enter') return yield* object(ctx);
        if (a.kind !== 'keyword') return;
        switch (a.keyword) {
          case 'Arc length':
            yield* arcLength(ctx);
            break;
          case 'Object':
            return yield* object(ctx);
          case 'Style':
            yield* arcStyle(ctx);
            break;
          default:
            type = a.keyword as CloudType;
        }
        status(ctx, style);
      }
    },
  };
}
