// REVCLOUD (M2-08) with AutoCAD 2024's prompts (AutoCAD 2024 Help, "REVCLOUD (Command)",
// REVCLOUDCREATETYPE):
//   Minimum arc length: 0.5000   Maximum arc length: 0.5000   Style: Normal   Type: Rectangular
//   Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style] <Object>:
// Rectangular asks for the opposite corner; Polygonal for points until Enter; Freehand follows
// the crosshairs and closes when they come back to the start; Object turns a circle, ellipse,
// polyline or spline into a cloud in its place. The cloud is an LWPOLYLINE of arcs
// (edit/revcloud.ts).
//
// Modify (AutoCAD 2021+, M2-24) redraws part of a cloud: "Select polyline" (the vertex nearest
// the pick starts the new stretch), "Specify next point" until a click lands on a vertex of the
// cloud (within a quarter of its arc length: AutoCAD says "until you click an existing vertex"
// and Endpoint snaps there exactly), "Pick a side to erase" and "Reverse direction". The cloud
// keeps its handle and xdata; the new stretch takes the cloud's own arc length (its
// RevcloudProps 1040, else its mean chord). Any polyline whose every segment is an arc can be
// modified, as clouds drawn before AutoCAD 2021 have no xdata.
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
  cloudArcLength,
  isCloudShaped,
  modifyCloud,
  polygonRuns,
  rectangleCorners,
  type CloudStyle,
} from '../../edit/revcloud';
import type { Prompt, PromptAnswer } from '../prompt';
import { drawingUnits, formatDistance } from '../units';
import type { CommandContext, CommandDef } from '../command';
import { currentProps } from '../../properties/current';

type Sub<T> = AsyncGenerator<Prompt, T, PromptAnswer>;

// A prompt with a default or only options answers with its kind (Enter gives the default; the bus
// refuses any other kind), and Esc ends the command rather than answering.
const value = (a: PromptAnswer): number => (a as { value: number }).value;
const keyword = (a: PromptAnswer): string => (a as { keyword: string }).keyword;

export type CloudType = 'Rectangular' | 'Polygonal' | 'Freehand';

const OPTIONS = ['Arc length', 'Object', 'Rectangular', 'Polygonal', 'Freehand', 'Style', 'Modify'];

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
    const n = (v: number) => formatDistance(v, drawingUnits(ctx.model.header));
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
        id = b.addEntity({ owner: ctx.space, ...currentProps(ctx.model), geom, xdata }).id;
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
      if (value(a) > 0) min = value(a);
      else ctx.message('Requires a positive value.');
    }
    for (;;) {
      const a = yield ctx.prompt.distance({
        message: 'Specify maximum length of arc',
        default: { kind: 'distance', value: Math.min(Math.max(s.maxArc, min), MAX_OVER_MIN * min) },
      });
      const max = value(a);
      if (max < min) ctx.message('Maximum arc length cannot be less than minimum arc length.');
      else if (max > MAX_OVER_MIN * min) {
        ctx.message('Maximum arc length cannot exceed 3 times the minimum arc length.');
      } else {
        style = { ...s, minArc: min, maxArc: max };
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
    style = { ...style!, calligraphy: keyword(a) === 'Calligraphy' };
    ctx.message(`Arc style = ${keyword(a)}`);
  }

  /** "Reverse direction [Yes/No] <No>:". */
  async function* reverse(ctx: CommandContext): Sub<boolean> {
    const a = yield ctx.prompt.keyword({
      message: 'Reverse direction',
      options: ['Yes', 'No'],
      default: { kind: 'keyword', keyword: 'No' },
    });
    return keyword(a) === 'Yes';
  }

  async function* object(ctx: CommandContext): Sub<void> {
    for (;;) {
      const a = yield ctx.prompt.selection({
        message: 'Select object',
        single: true,
        editable: true,
      });
      const picked = (a as { ids: readonly EntityId[] }).ids;
      if (picked.length === 0) return;
      const e = ctx.model.entity(picked[0]!)!;
      const s = style!;
      const runs = cloudRunsOf(e.geom, s.minArc / 1000);
      if (!runs) {
        ctx.message('Select a circle, ellipse, polyline or spline.');
        continue;
      }
      if (tooMany(ctx, runs.runs)) return;
      const back = yield* reverse(ctx);
      const points = cloudPoints(runs.runs, runs.closed, s, cloudRandom());
      add(ctx, points, runs.closed, back, e);
      ctx.message('Revision cloud finished.');
      return;
    }
  }

  async function* modify(ctx: CommandContext): Sub<void> {
    let picked: { e: Entity & { geom: LwPolylineGeometry }; at: Vec2 } | undefined;
    while (!picked) {
      const a = yield ctx.prompt.selection({
        message: 'Select polyline',
        single: true,
        editable: true,
      });
      const sel = a as { ids: readonly EntityId[]; pick?: Vec2 };
      if (sel.ids.length === 0) return;
      const e = ctx.model.entity(sel.ids[0]!)!;
      if (!isCloudShaped(e.geom)) {
        ctx.message('Select a revision cloud.');
        continue;
      }
      picked = {
        e: e as Entity & { geom: LwPolylineGeometry },
        at: sel.pick ?? e.geom.vertices[0]!,
      };
    }
    const { e, at } = picked;
    const g = e.geom;
    const arc = cloudArcLength(ctx.model, e);
    const nearest = (p: Vec2): number => {
      let best = 0;
      g.vertices.forEach((v, i) => {
        if (distance(v, p) < distance(g.vertices[best]!, p)) best = i;
      });
      return best;
    };
    const start = nearest(at);
    const points: Vec2[] = [];
    const uniform: CloudStyle = { minArc: arc, maxArc: arc, calligraphy: false };
    let end: number | undefined;
    while (end === undefined) {
      const from = points.at(-1) ?? g.vertices[start]!;
      if (points.length > 0) {
        const runs = polygonRuns([g.vertices[start]!, ...points]).slice(0, -1);
        ctx.preview(
          cloudArcCount(runs, uniform) <= REVCLOUD_MAX_ARCS
            ? [cloudPolyline(cloudPoints(runs, false, uniform), false, uniform)]
            : [],
        );
      }
      const a = yield ctx.prompt.point({
        message: points.length === 0 ? 'Specify next point' : 'Specify next point or',
        ...(points.length > 0 && { options: ['Undo'] }),
        rubberBand: { from },
      });
      if (a.kind === 'keyword') {
        points.pop();
        continue;
      }
      if (a.kind !== 'point') {
        ctx.message('Click a vertex of the revision cloud to end the new stretch.');
        continue;
      }
      const i = nearest(a.point);
      if (distance(g.vertices[i]!, a.point) <= arc / 4 && i !== start) end = i;
      else if (distance(a.point, from) > 0) points.push(a.point);
    }
    const path = [g.vertices[start]!, ...points, g.vertices[end]!];
    const runs = polygonRuns(path).slice(0, -1);
    if (tooMany(ctx, runs)) return;
    // The new stretch shown while a side is picked.
    ctx.preview([cloudPolyline(cloudPoints(runs, false, uniform), false, uniform)]);
    const side = yield ctx.prompt.point({ message: 'Pick a side to erase' });
    if (side.kind !== 'point') return;
    let geom = modifyCloud(g, start, points, end, side.point, arc);
    ctx.preview([geom]);
    if (yield* reverse(ctx)) {
      geom = { ...geom, vertices: geom.vertices.map((v) => ({ ...v, bulge: -v.bulge })) };
    }
    ctx.edit((b) => b.updateEntity(e.id, { geom }));
    ctx.message('Revision cloud finished.');
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
      else {
        // Enter.
        if (corners.length < 3) {
          ctx.message('A polygonal cloud needs three or more points.');
          if (corners.length === 1) return;
          continue;
        }
        const runs = polygonRuns(corners);
        if (tooMany(ctx, runs)) return;
        add(ctx, cloudPoints(runs, true, style!), true);
        return;
      }
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
        gap = spacing();
        continue;
      }
      // Enter: the cloud ends open, where the crosshairs got to.
      if (points.length < 2) return;
      const back = yield* reverse(ctx);
      add(ctx, points, false, back);
      ctx.message('Revision cloud finished.');
      return;
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
        switch (keyword(a)) {
          case 'Arc length':
            yield* arcLength(ctx);
            break;
          case 'Object':
            return yield* object(ctx);
          case 'Style':
            yield* arcStyle(ctx);
            break;
          case 'Modify':
            return yield* modify(ctx);
          default:
            type = keyword(a) as CloudType;
        }
        status(ctx, style);
      }
    },
  };
}
