// The drawing and canvas M3-02 part 5's command tests (PEDIT, MATCHPROP, CHPROP, CHANGE) run
// on: picks take the objects within 0.25 of the pick, windows what they hold or cross.
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  closestPoint,
  flatten,
  offsetCurveOf,
  toleranceForSize,
  type BusEvent,
  type DocumentMeta,
  type Entity,
  type NonGraphicalObject,
  type EntityGeometry,
  type EntityId,
  type ImageGeometry,
  type ViewHost,
  type Vec2,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  layer,
  lineGeom,
  linetype,
  record,
  sampleInit,
} from '../model/fixtures';

export const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** An image's frame as a closed polyline: its corners from DXF 10, 11, 12 and 13. */
function imageFrameGeom(g: ImageGeometry): EntityGeometry {
  const { position: p, u, v, size } = g;
  const at = (i: number, j: number) => ({
    x: p.x + u.x * i + v.x * j,
    y: p.y + u.y * i + v.y * j,
    bulge: 0,
  });
  return {
    kind: 'LWPOLYLINE',
    closed: true,
    vertices: [at(0, 0), at(size.x, 0), at(size.x, size.y), at(0, size.y)],
  } as EntityGeometry;
}
const BLOCK = '50';

/** STANDARD (16, no fixed height) and NOTES (17, 3.5 high) are the drawing's text styles. */
const textStyle = (handle: string, name: string, height: number) => ({
  handle,
  name,
  font: 'txt',
  height,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

/**
 * A canvas whose picks take the objects within 0.25 of the pick, nearest first; with
 * `variables`, an app keeping those system variables (M3-12).
 */
export function host(model: () => DocumentModel, variables?: Map<string, number>): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'sysvar' && variables?.has(r.name)) {
        if (typeof r.value === 'number') variables.set(r.name, r.value);
        return Promise.resolve({ ok: true, value: variables.get(r.name)! });
      }
      if (r.op === 'pick') {
        const hits: [number, EntityId][] = [];
        for (const e of model().entities()) {
          if (e.owner !== MODEL_SPACE) continue;
          // An image is picked by its frame (M5-04 part 4), as AutoCAD's are.
          const c = offsetCurveOf(e.geom.kind === 'IMAGE' ? imageFrameGeom(e.geom) : e.geom);
          const d = c ? closestPoint(c, r.point, toleranceForSize(100)).distance : Infinity;
          if (d < 0.25) hits.push([d, e.id]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        return Promise.resolve({ ok: true, ids: hits.map(([, id]) => id) });
      }
      if (r.op === 'select') {
        // A window holds an object with all its points inside, a crossing one with any.
        const inside = (p: Vec2) =>
          p.x >= Math.min(r.a.x, r.b.x) &&
          p.x <= Math.max(r.a.x, r.b.x) &&
          p.y >= Math.min(r.a.y, r.b.y) &&
          p.y <= Math.max(r.a.y, r.b.y);
        const ids = model()
          .blockEntities(MODEL_SPACE)
          .filter((id) => {
            const g = model().entity(id)!.geom;
            const c = offsetCurveOf(g);
            const bounded = c && c.kind !== 'RAY' && c.kind !== 'XLINE' ? c : undefined;
            const pts = bounded
              ? flatten(bounded, 0.01).points
              : 'position' in g
                ? [g.position as Vec2]
                : [];
            const n = pts.filter(inside).length;
            return r.crossing ? n > 0 : n === pts.length && n > 0;
          });
        return Promise.resolve({ ok: true, ids });
      }
      // No drawing file is found by name (-INSERT, M5-01 part 4).
      if (r.op === 'drawingFile') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

/**
 * A drawing of its own: line 30 (0,0)-(10,0), circle 31 at (50,0) r 5, and whatever `extra`
 * adds (handles from 40 on, on WALLS). Block "B" (record 50) holds a line (0,0)-(1,0) on layer 0
 * coloured ByBlock and a circle at (1,0) r 0.5. Material GLOBAL is record 70, plot styles
 * NORMAL and HEAVY records 80 and 81, used when `namedPlotStyles`.
 */
export function setup(
  extra: (EntityGeometry | [EntityGeometry, Partial<Entity>])[] = [],
  o: {
    namedPlotStyles?: boolean;
    /** Objects beside the sample's, and drawing facts (M3-08's ACAD_GROUP dictionary). */
    objects?: NonGraphicalObject[];
    meta?: Partial<DocumentMeta>;
    /** The system variables the app keeps, which commands read and set (M3-12). */
    variables?: Map<string, number>;
  } = {},
) {
  const init = sampleInit();
  const model = DocumentModel.create({
    ...init,
    meta: { ...init.meta!, ...o.meta },
    objects: [...(init.objects ?? []), ...(o.objects ?? [])],
    header: new Map([...(init.header ?? []), ['$PSTYLEMODE', o.namedPlotStyles ? 0 : 1]]),
    tables: {
      ...init.tables,
      materials: [record('70', 'GLOBAL')],
      plotStyles: [record('80', 'NORMAL'), record('81', 'HEAVY')],
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      linetypes: [...(init.tables?.linetypes ?? []), linetype('15', 'DASHED')],
      textStyles: [textStyle('16', 'Standard', 0), textStyle('17', 'NOTES', 3.5)],
      blockRecords: [...(init.tables?.blockRecords ?? []), blockRecord(BLOCK, 'B')],
    },
    blocks: [...(init.blocks ?? []), { handle: BLOCK, name: 'B', basePoint: { x: 0, y: 0 } }],
    entities: [
      entityInit('30', lineGeom(0, 0, 10, 0)),
      entityInit('31', { kind: 'CIRCLE', center: { x: 50, y: 0 }, radius: 5 }),
      entityInit('51', lineGeom(0, 0, 1, 0), { owner: BLOCK, color: { kind: 'byBlock' } }),
      entityInit('52', { kind: 'CIRCLE', center: { x: 1, y: 0 }, radius: 0.5 }, { owner: BLOCK }),
      ...extra.map((x, i) => {
        const [g, props] = Array.isArray(x) ? x : [x, {}];
        return entityInit((0x40 + i).toString(16).toUpperCase(), g, {
          layer: LAYER_WALLS,
          ...props,
        } as never);
      }),
    ],
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: host(() => model, o.variables),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity | undefined => {
    const id = model.ids.idOf(h);
    return id === undefined ? undefined : model.entity(id);
  };
  const space = () => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  const kinds = () => space().map((e) => e.geom.kind);
  const ends = (e: Entity) => {
    const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
    return [g.start.x, g.start.y, g.end.x, g.end.y].map(r6);
  };
  return { model, bus, log, byHandle, space, kinds, ends };
}
