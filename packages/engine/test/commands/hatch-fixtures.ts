// The drawing and app side HATCH's tests (M4-07) run against: a few objects in model space,
// a view of (−50,−50)–(150,150), and a pattern library that knows every name but NOPE.
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  blockDrawOrder,
  builtinCommands,
  sortTableOf,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityId,
  type EntityGeometry,
  type HatchGeometry,
  type HeaderValue,
  type PatternPlacement,
  type ViewHost,
  type ViewReply,
  type ViewRequest,
  type Vec2,
} from '../../src/index';
import { MODEL_SPACE, entityInit, layer, sampleInit } from '../model/fixtures';

export const line = (x1: number, y1: number, x2: number, y2: number): EntityGeometry => ({
  kind: 'LINE',
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
});
export const square = (x: number, y: number, s: number): EntityGeometry[] => [
  line(x, y, x + s, y),
  line(x + s, y, x + s, y + s),
  line(x + s, y + s, x, y + s),
  line(x, y + s, x, y),
];
export const text = (x: number, y: number): EntityGeometry => ({
  kind: 'TEXT',
  value: 'T',
  style: 'STANDARD',
  position: { x, y },
  height: 2,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});
export const circle = (x: number, y: number, r: number): EntityGeometry => ({
  kind: 'CIRCLE',
  center: { x, y },
  radius: r,
});

/** The app's side: a view of (−50,−50)–(150,150), a library that knows every name but NOPE. */
export function host(
  requests: ViewRequest[],
  pickAt: (p: Vec2) => EntityId[] = () => [],
): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      requests.push(r);
      // A pick takes the lines and circles within 0.5 of the point (M4-07 part 4).
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: pickAt(r.point) });
      if (r.op === 'get') {
        return Promise.resolve({
          ok: true,
          view: { center: { x: 50, y: 50 }, width: 200, height: 200, paper: false },
        });
      }
      if (r.op === 'hatchPattern') {
        if (r.name.toUpperCase() === 'EMPTY') return Promise.resolve({ ok: true });
        if (r.name.toUpperCase() === 'NOPE') {
          return Promise.resolve({
            ok: false,
            message: 'Pattern "NOPE" is not in the pattern library.',
          });
        }
        const lines = (p: PatternPlacement) => [
          {
            angle: Math.PI / 4 + p.angle,
            base: p.origin,
            offset: { x: -3 * p.scale * Math.SQRT1_2, y: 3 * p.scale * Math.SQRT1_2 },
            dashes: [],
          },
        ];
        return Promise.resolve({
          ok: true,
          pattern: {
            name: r.name.toUpperCase(),
            custom: r.name.toUpperCase() === 'MINE',
            lines: r.placements.map(lines),
          },
        });
      }
      if (r.op === 'hatchPatternList') {
        return Promise.resolve({
          ok: true,
          patterns: [
            { name: 'TRIYA_LINES45', description: '45 degree lines' },
            { name: 'TRIYA_GRID', description: '' },
            { name: 'MINE', description: 'My own' },
          ],
        });
      }
      if (r.op === 'textOutlines') {
        // Every text 4 wide and 2 high from its position.
        return Promise.resolve({
          ok: true,
          outlines: r.texts.map((t) => {
            const p = t.position;
            return {
              corners: [
                p,
                { x: p.x + 4, y: p.y },
                { x: p.x + 4, y: p.y + 2 },
                { x: p.x, y: p.y + 2 },
              ],
              width: 4,
              below: 0,
            };
          }),
        });
      }
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

export interface SetupOptions {
  readonly header?: readonly [string, HeaderValue][];
  /** No canvas or pattern library (scripts). */
  readonly noView?: boolean;
  /** Entities by index that are made invisible. */
  readonly invisible?: readonly number[];
}

export function setup(geoms: (EntityGeometry | [EntityGeometry, string])[], o: SetupOptions = {}) {
  const base = sampleInit();
  const init: DocumentInit = {
    ...base,
    header: new Map([...(base.header ?? []), ...(o.header ?? [])]),
    tables: {
      ...base.tables,
      layers: [...(base.tables?.layers ?? []), { ...layer('12', 'OFF'), on: false }],
    },
    entities: geoms.map((g, i) => {
      const [geom, onLayer] = Array.isArray(g) ? g : [g, undefined];
      return entityInit((0x100 + i).toString(16).toUpperCase(), geom, {
        ...(onLayer && { layer: onLayer }),
        ...(o.invisible?.includes(i) && { visible: false }),
      });
    }),
  };
  const model = DocumentModel.create(init);
  const requests: ViewRequest[] = [];
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    ...(!o.noView && { view: host(requests, (p) => near(model, p)) }),
  });
  const log: string[] = [];
  const previews: (readonly EntityGeometry[])[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
    if (e.type === 'preview') previews.push(e.geometry);
  });
  const hatches = (): (Entity & { geom: HatchGeometry })[] =>
    [...model.entities()].filter(
      (e): e is Entity & { geom: HatchGeometry } => e.geom.kind === 'HATCH',
    );
  const idOf = (handle: string) => model.ids.idOf(handle)!;
  /** Model space's objects by handle, in the order they are drawn. */
  const order = (): string[] => {
    const b = new ChangeSetBuilder(model);
    return blockDrawOrder(model, MODEL_SPACE, sortTableOf(b, model, MODEL_SPACE)).map((e) =>
      model.ids.handleOf(e.id)!,
    );
  };
  const handleOf = (e: Entity): string => model.ids.handleOf(e.id)!;
  return { model, bus, log, previews, requests, hatches, idOf, order, handleOf };
}

export const placements = (requests: ViewRequest[]) =>
  requests.flatMap((r) => (r.op === 'hatchPattern' ? [r] : []));

/** The lines and circles of model space within 0.5 of `p`. */
function near(model: DocumentModel, p: Vec2): EntityId[] {
  return [...model.entities()].flatMap((e) => {
    const g = e.geom;
    let d = Infinity;
    if (g.kind === 'LINE') {
      const dx = g.end.x - g.start.x;
      const dy = g.end.y - g.start.y;
      const f = Math.max(
        0,
        Math.min(1, ((p.x - g.start.x) * dx + (p.y - g.start.y) * dy) / (dx * dx + dy * dy)),
      );
      d = Math.hypot(p.x - g.start.x - f * dx, p.y - g.start.y - f * dy);
    } else if (g.kind === 'CIRCLE') {
      d = Math.abs(Math.hypot(p.x - g.center.x, p.y - g.center.y) - g.radius);
    }
    return d <= 0.5 ? [e.id] : [];
  });
}
