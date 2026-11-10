// M2-26 part 2: a columned MTEXT's column grips in the STRETCH grip mode on the PromptBus. A
// column grip reshapes the columns; dynamic columns then take as many columns as the text needs,
// which the canvas counts (the `columnCounts` view request, the engine having no fonts), in the
// same undo step.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  type MTextGeometry,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { LAYER_0, MODEL_SPACE, sampleInit } from '../model/fixtures';

/** Dynamic columns 30 wide, gutter 5, 40 high, two of them, inserted top left at (100,100). */
const mtext = (cols: Partial<NonNullable<MTextGeometry['columns']>> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents: 'one\\Ptwo\\Pthree',
  style: '30',
  position: { x: 100, y: 100 },
  height: 2.5,
  width: 30,
  definedHeight: 40,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  columns: {
    type: 2,
    count: 2,
    flowReversed: false,
    autoHeight: true,
    width: 30,
    gutter: 5,
    heights: [],
    ...cols,
  },
});

function setup(geom: MTextGeometry, counts: (t: MTextGeometry) => number | null) {
  const model = DocumentModel.create(sampleInit());
  const b = new ChangeSetBuilder(model);
  const { id } = b.addEntity({ owner: MODEL_SPACE, layer: LAYER_0, geom });
  model.apply(b.build());
  const asked: ViewRequest[] = [];
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    if (r.op !== 'columnCounts') return { ok: false, message: 'not drawn' };
    return { ok: true, counts: r.texts.map(counts) };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  const now = () => model.entity(id)!.geom as MTextGeometry;
  return { bus, asked, now };
}

describe('MTEXT column grips', () => {
  it('the height grip sets the height, and the canvas recounts dynamic columns', async () => {
    // Shorter columns need more of them: 3 at 20 high.
    const s = setup(mtext(), (t) => (t.definedHeight! < 30 ? 3 : 2));
    await s.bus.selectAll();
    // The height grip: the middle of the first column's bottom edge, (115, 60).
    await s.bus.pick({ x: 115.1, y: 60 }, { grip: 0.5 });
    expect(s.bus.promptText).toBe('Specify stretch point or [Base point/Copy/Undo/eXit]:');
    await s.bus.submit('115,80');
    expect(s.now().definedHeight).toBe(20);
    expect(s.now().columns).toMatchObject({ count: 3, autoHeight: true });
    expect(s.asked.filter((r) => r.op === 'columnCounts')).toHaveLength(1);
    // One undo step takes back both.
    await s.bus.script(['U']);
    expect(s.now().definedHeight).toBe(40);
    expect(s.now().columns?.count).toBe(2);
  });

  it('a manual height dragged lower: the canvas count drops a column, and its height', async () => {
    const g = mtext({ autoHeight: false, count: 3, heights: [40, 20, 30] });
    const s = setup(g, (t) => (t.columns!.heights[1]! > 30 ? 2 : 3));
    await s.bus.selectAll();
    // The second column's height grip, (150, 80).
    await s.bus.pick({ x: 150, y: 80 }, { grip: 0.5 });
    await s.bus.submit('150,50');
    expect(s.now().columns).toMatchObject({ count: 2, heights: [40, 50] });
    expect(s.now().definedHeight).toBe(50);
  });

  it('the column width grip widens every column; static columns are not recounted', async () => {
    const s = setup(mtext({ type: 1, autoHeight: false }), () => 9);
    await s.bus.selectAll();
    await s.bus.pick({ x: 130, y: 100 }, { grip: 0.5 });
    await s.bus.submit('140,100');
    expect(s.now().width).toBe(40);
    expect(s.now().columns).toMatchObject({ count: 2, width: 40, gutter: 5 });
    expect(s.asked.filter((r) => r.op === 'columnCounts')).toHaveLength(0);
  });

  it('without a canvas to count, the columns keep their count', async () => {
    const s = setup(mtext(), () => null);
    await s.bus.selectAll();
    // The gutter grip, the second column's top left corner (135, 100).
    await s.bus.pick({ x: 135, y: 100 }, { grip: 0.5 });
    await s.bus.submit('137,100');
    expect(s.now().columns).toMatchObject({ count: 2, gutter: 7 });
  });
});
