// M2-10 part 3: STRETCH and SCALE regenerate the dimensions they change (DEC-011: a dimension
// draws its stored `*D` block until touched). The dimension engine sits above the engine
// (`@triya/dims`), so these tests give the bus a stand-in that draws a dimension as one line
// between its extension origins, its measurement as an MTEXT and its origins as defpoints, and
// a canvas that measures each character of a text one unit wide.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  UNDO_COMMANDS,
  builtinCommands,
  inBox,
  writeDimensionBlock,
  type BusEvent,
  type DimensionGeometry,
  type DimensionRegenerator,
  type DocumentInit,
  type Entity,
  type MTextGeometry,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  MODEL_SPACE,
  blockRecord,
  entityInit,
  lineGeom,
  sampleInit,
  snapshot,
} from '../model/fixtures';

const DIM = '30';
const BLOCK = '50';

const dimension = (extra: Partial<DimensionGeometry> = {}): DimensionGeometry =>
  ({
    kind: 'DIMENSION',
    dimType: 'linear',
    style: '27',
    block: BLOCK,
    first: { x: 0, y: 0 },
    second: { x: 10, y: 0 },
    definitionPoint: { x: 10, y: 5 },
    textPosition: { x: 5, y: 5 },
    textUserPositioned: false,
    text: '',
    textRotation: 0,
    horizontalDirection: 0,
    attachment: 5,
    lineSpacingStyle: 1,
    lineSpacing: 1,
    rotation: 0,
    ...extra,
  }) as DimensionGeometry;

function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [...(base.tables?.blockRecords ?? []), blockRecord(BLOCK, '*D1')],
    },
    blocks: [...(base.blocks ?? []), { handle: BLOCK, name: '*D1', basePoint: { x: 0, y: 0 } }],
    entities: [
      entityInit(DIM, dimension()),
      // The stored graphics: the dimension line as AutoCAD drew it.
      entityInit('51', lineGeom(0, 5, 10, 5), { owner: BLOCK }),
    ],
  };
}

const text = (contents: string, at: { x: number; y: number }): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: '',
  position: at,
  height: 1,
  width: 0,
  rotation: 0,
  attachment: 5,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
});

/** The stand-in dimension engine: text centred over the line, DXF 10 kept. */
const regenerate: DimensionRegenerator = (e, _model, measure) => {
  const g = e.geom;
  if (g.kind !== 'DIMENSION' || g.dimType !== 'linear') return undefined;
  const y = g.definitionPoint.y;
  const label = String(Math.abs(g.second.x - g.first.x));
  const at = { x: (g.first.x + g.second.x) / 2, y: y + 1 };
  const width = measure(text(label, at));
  if (width === undefined) return undefined;
  return {
    parts: [
      { geom: lineGeom(g.first.x, y, g.second.x, y) },
      { geom: text(label, at), color: { kind: 'aci', index: 2 } },
      { geom: { kind: 'POINT', position: g.first }, defpoint: true },
      { geom: { kind: 'POINT', position: g.second }, defpoint: true },
    ],
    geom: { ...g, textPosition: at },
  };
};

/**
 * A canvas that measures texts (each character one unit) and selects model-space objects by
 * their points (a dimension by its definition points, as drawn).
 */
function canvas(model: () => DocumentModel, measures = true) {
  const asked: string[][] = [];
  const view: ViewHost = {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'select') {
        const m = model();
        const inside = inBox({
          minX: Math.min(r.a.x, r.b.x),
          minY: Math.min(r.a.y, r.b.y),
          maxX: Math.max(r.a.x, r.b.x),
          maxY: Math.max(r.a.y, r.b.y),
        });
        const ids = m.blockEntities(MODEL_SPACE).filter((id) => {
          const g = m.entity(id)!.geom;
          const pts =
            g.kind === 'DIMENSION' && g.dimType === 'linear'
              ? [g.first, g.second, g.definitionPoint, g.textPosition]
              : g.kind === 'LINE'
                ? [g.start, g.end]
                : [];
          const n = pts.filter(inside).length;
          return r.crossing ? n > 0 : n > 0 && n === pts.length;
        });
        return Promise.resolve({ ok: true, ids });
      }
      if (r.op !== 'textWidths') return Promise.resolve({ ok: false, message: 'no canvas' });
      asked.push(r.texts.map((t) => t.contents));
      return Promise.resolve({
        ok: true,
        widths: r.texts.map((t) => (measures ? t.contents.length : null)),
      });
    },
  };
  return { view, asked };
}

function setup(o: { dimensions?: boolean; measures?: boolean } = {}) {
  const model = DocumentModel.create(init());
  const registry = builtinCommands();
  for (const def of UNDO_COMMANDS) registry.register(def);
  const c = canvas(() => model, o.measures ?? true);
  const bus = new PromptBus({
    model,
    registry,
    view: c.view,
    ...(o.dimensions !== false && { dimensions: regenerate }),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const dim = () =>
    model.entityByHandle(DIM)!.geom as Extract<
      DimensionGeometry,
      { dimType: 'linear' | 'aligned' }
    >;
  const contents = (): Entity[] => model.blockEntities(dim().block!).map((id) => model.entity(id)!);
  return { model, bus, log, dim, contents, asked: c.asked };
}

describe('STRETCH regenerates a dimension (M2-10 part 3)', () => {
  it('moves the definition points inside the window and rewrites the block', async () => {
    const s = setup();
    // The window holds the second extension origin (10,0) only.
    await s.bus.script(['STRETCH', 'C', '9,-1', '11,1', '', '0,0', '5,0']);
    expect(s.bus.command).toBeUndefined();
    expect(s.dim().second).toEqual({ x: 15, y: 0 });
    expect(s.dim().first).toEqual({ x: 0, y: 0 });
    expect(s.dim().block).toBe(BLOCK);
    expect(s.dim().textPosition).toEqual({ x: 7.5, y: 6 });
    expect(s.asked).toEqual([['15']]);
    const inside = s.contents();
    expect(inside.map((e) => e.geom.kind)).toEqual(['LINE', 'MTEXT', 'POINT', 'POINT']);
    // The stored line went; the new parts have new handles above the seed.
    expect(s.model.entityByHandle('51')).toBeUndefined();
    expect(inside.every((e) => parseInt(e.handle, 16) >= 0x40)).toBe(true);
    // Layer 0 in ByBlock unless a part names its own; defpoints on a new DEFPOINTS layer.
    const [line, mtext, point] = inside;
    expect(line).toMatchObject({
      layer: LAYER_0,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
    });
    expect(mtext!.color).toEqual({ kind: 'aci', index: 2 });
    const defpoints = s.model.tables.layers.get(point!.layer)!;
    expect(defpoints).toMatchObject({ name: 'Defpoints', plot: false });
  });

  it('is one undo step with its regeneration', async () => {
    const s = setup();
    const before = snapshot(s.model);
    await s.bus.script(['STRETCH', 'C', '9,-1', '11,1', '', '0,0', '5,0']);
    await s.bus.script(['U']);
    expect(snapshot(s.model)).toEqual(before);
  });

  it('moves a dimension wholly inside the window with its block, unregenerated', async () => {
    const s = setup();
    await s.bus.script(['STRETCH', 'C', '-1,-1', '11,6', '', '0,0', '0,3']);
    expect(s.dim().first).toEqual({ x: 0, y: 3 });
    expect(s.asked).toEqual([]);
    expect(s.contents().map((e) => e.handle)).toEqual(['51']);
  });

  it('leaves the dimension whole without a dimension engine, as before', async () => {
    const s = setup({ dimensions: false });
    await s.bus.script(['STRETCH', 'C', '9,-1', '11,1', '', '0,0', '5,0']);
    expect(s.dim().second).toEqual({ x: 10, y: 0 });
    expect(s.log.join('\n')).toMatch(/a dimension is only moved, with all of it in the window/);
  });

  it('says so when the text cannot be measured, keeping the carried block', async () => {
    const s = setup({ measures: false });
    await s.bus.script(['STRETCH', 'C', '9,-1', '11,1', '', '0,0', '5,0']);
    expect(s.dim().second).toEqual({ x: 15, y: 0 });
    expect(s.contents().map((e) => e.handle)).toEqual(['51']);
    expect(s.log).toContain('1 dimension was not regenerated (its text cannot be measured).');
  });
});

describe('SCALE regenerates a dimension (M2-10 part 3)', () => {
  it('measures the scaled distance', async () => {
    const s = setup();
    await s.bus.script(['SCALE', 'ALL', '', '0,0', '2']);
    expect(s.dim().second).toEqual({ x: 20, y: 0 });
    expect(s.asked).toEqual([['20']]);
    const mtext = s.contents().find((e) => e.geom.kind === 'MTEXT')!.geom as MTextGeometry;
    // The text keeps its height: the block is drawn afresh, not scaled.
    expect(mtext).toMatchObject({ contents: '20', height: 1 });
  });

  it('does not regenerate a dimension moved or turned', async () => {
    const s = setup();
    await s.bus.script(['MOVE', 'ALL', '', '0,0', '1,1']);
    await s.bus.script(['ROTATE', 'ALL', '', '0,0', '90']);
    expect(s.asked).toEqual([]);
    expect(s.contents().map((e) => e.handle)).toEqual(['51']);
  });
});

describe('writeDimensionBlock', () => {
  it('gives a dimension without a block a new anonymous *D block', () => {
    const { block: _block, ...blockless } = dimension();
    const model = DocumentModel.create({
      ...init(),
      entities: [entityInit(DIM, blockless as DimensionGeometry)],
    });
    const e = model.entityByHandle(DIM)!;
    const drawn = regenerate(e, model, (t) => t.contents.length)!;
    const b = new ChangeSetBuilder(model);
    expect(writeDimensionBlock(b, model, e.id, drawn)).toBe(true);
    model.apply(b.build());
    const g = model.entityByHandle(DIM)!.geom as DimensionGeometry;
    expect(model.blocks.get(g.block!)?.name).toBe('*D2');
    expect(model.tables.blockRecords.get(g.block!)).toMatchObject({ name: '*D2', flags: 1 });
    expect(model.blockEntities(g.block!)).toHaveLength(4);
  });

  it('keeps an existing DEFPOINTS layer', () => {
    const base = init();
    const model = DocumentModel.create({
      ...base,
      tables: {
        ...base.tables,
        layers: [
          ...(base.tables?.layers ?? []),
          { ...base.tables!.layers![0]!, handle: '3B', name: 'DEFPOINTS' },
        ],
      },
    });
    const e = model.entityByHandle(DIM)!;
    const b = new ChangeSetBuilder(model);
    writeDimensionBlock(
      b,
      model,
      e.id,
      regenerate(e, model, () => 1)!,
    );
    model.apply(b.build());
    const points = model
      .blockEntities(BLOCK)
      .map((id) => model.entity(id)!)
      .filter((p) => p.geom.kind === 'POINT');
    expect(points.map((p) => p.layer)).toEqual(['3B', '3B']);
    expect(model.tables.layers.size).toBe(3);
  });
});
