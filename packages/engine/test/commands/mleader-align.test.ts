// M4-04 part 3: MLEADERALIGN (MLA) and MLEADERCOLLECT (MLC) on the PromptBus, driven as the
// command line drives them, with AutoCAD 2024's prompts ("MLEADERALIGN (Command)",
// "MLEADERCOLLECT (Command)", AutoCAD 2024 Help). Content moves with its landings; leader lines
// keep their arrowheads. The readings taken where the help is silent are in
// edit/mleader-align.ts.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  alignMultiLeaders,
  builtinCommands,
  collectMultiLeaders,
  distributeMultiLeaders,
  multiLeaderParts,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityId,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type TextStyleRecord,
  type Vec2,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { blockRecord, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const STANDARD_TEXT = '30';
const STANDARD = '35';
const TAG = '37';

const textStyle: TextStyleRecord = {
  handle: STANDARD_TEXT,
  name: 'Standard',
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

/** AutoCAD's imperial Standard style (arrowhead 0.18, gap 0.09, landing 0.36, text 0.18). */
const standard: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(false, STANDARD_TEXT),
};

/** A canvas that measures text as 0.6 of its height per character on one line. */
const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op !== 'textBox') return Promise.resolve({ ok: false, message: 'no view' });
    const t = r.text;
    const w = t.contents.length * t.height * 0.6;
    const col = (t.attachment - 1) % 3;
    const row = Math.floor((t.attachment - 1) / 3);
    const minX = t.position.x - (col === 0 ? 0 : col === 1 ? w / 2 : w);
    const maxY = t.position.y + (row === 0 ? 0 : row === 1 ? t.height / 2 : t.height);
    return Promise.resolve({
      ok: true,
      box: { minX, maxX: minX + w, minY: maxY - t.height, maxY },
    });
  },
};

function setup() {
  const base = sampleInit();
  const init: DocumentInit = {
    ...base,
    header: new Map([...base.header!, ['$TEXTSTYLE', 'Standard']]),
    tables: {
      ...base.tables,
      textStyles: [textStyle],
      mleaderStyles: [standard],
      blockRecords: [...base.tables!.blockRecords!, blockRecord(TAG, 'TAG')],
    },
    blocks: [...base.blocks!, { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } }],
    entities: [...base.entities!, entityInit('39', circleGeom(0, 0, 1), { owner: TAG })],
  };
  const model = DocumentModel.create(init);
  const bus = new PromptBus({ model, registry: builtinCommands(), view: canvas });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const ids = (): EntityId[] =>
    added()
      .filter((e) => e.geom.kind === 'MULTILEADER')
      .map((e) => e.id);
  const geom = (id: EntityId) => model.entity(id)!.geom as MultiLeaderGeometry;
  /** A text multileader from `arrow` to the landing location `at`. */
  const text = async (arrow: string, at: string, contents = 'AB') => {
    await bus.script(['MLEADER', arrow, at, contents, '']);
    return ids().at(-1)!;
  };
  /** A TAG block multileader (its attributes left alone). */
  const tag = async (arrow: string, at: string) => {
    await bus.script(['MLEADER', 'O', 'C', 'B', 'TAG', 'X', arrow, at]);
    while (bus.command === 'MLEADER') await bus.submit('');
    return ids().at(-1)!;
  };
  return { model, bus, log, ids, geom, text, tag };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];
const lines = (g: MultiLeaderGeometry) =>
  g.branches.map((b) => [pt(b.connection), b.lines.map((l) => l.vertices.map(pt))]);

describe('MLEADERALIGN', () => {
  it('lines content up from the multileader aligned to, keeping the current spacing', async () => {
    const s = setup();
    const a = await s.text('0,0', '10,5');
    const b = await s.text('2,0', '13,9');
    const c = await s.text('4,0', '15,1');
    await s.bus.submit('MLA');
    expect(s.bus.command).toBe('MLEADERALIGN');
    expect(s.bus.promptText).toBe('Select multileaders:');
    await s.bus.answer({ kind: 'selection', ids: [a, b, c] });
    expect(s.log).toContain('Current mode: Use current spacing');
    expect(s.bus.promptText).toBe('Select multileader to align to or [Options]:');
    await s.bus.answer({ kind: 'selection', ids: [a] });
    expect(s.bus.promptText).toBe('Specify direction:');
    expect(s.bus.prompt).toMatchObject({ rubberBand: { from: { x: 10.36, y: 5 } } });
    await s.bus.submit('10.36,20');
    expect(s.bus.command).toBeUndefined();
    // Straight up from A's content: each keeps its height, its content and landing moved over.
    expect([a, b, c].map((id) => pt(s.geom(id).contentBase))).toEqual([
      [10.36, 5],
      [10.36, 9],
      [10.36, 1],
    ]);
    expect(lines(s.geom(b))).toEqual([[[10, 9], [[[2, 0]]]]]);
    expect(pt(s.geom(c).text!.position)).toEqual([10.45, 1.09]);
    // One change set: one undo puts them all back.
    await s.bus.submit('U');
    expect(pt(s.geom(b).contentBase)).toEqual([13.36, 9]);
    expect(pt(s.geom(c).contentBase)).toEqual([15.36, 1]);
  });

  it('spaces content a given distance apart between extents, keeping their order', async () => {
    const s = setup();
    const a = await s.text('0,0', '10,5');
    const b = await s.text('2,0', '13,1');
    const c = await s.text('4,0', '15,9');
    await s.bus.script(['MLEADERALIGN']);
    await s.bus.answer({ kind: 'selection', ids: [a, b, c] });
    await s.bus.submit('O');
    expect(s.bus.promptText).toBe(
      'Enter an option [Distribute/make leader segments Parallel/specify Spacing/Use current spacing] <Use current spacing>:',
    );
    await s.bus.submit('S');
    expect(s.bus.promptText).toBe('Specify spacing <0.0000>:');
    await s.bus.submit('0.5');
    expect(s.log).toContain('Current mode: Specify spacing (0.5)');
    await s.bus.answer({ kind: 'selection', ids: [a] });
    // Downwards from A: B (below A) goes under it, C (above A) over it, each text 0.18 high and
    // 0.5 apart.
    await s.bus.submit('10.36,0');
    const ys = [a, b, c].map((id) => s.geom(id).text!.position.y);
    expect(ys.map(r6)).toEqual([5.09, r6(5.09 - 0.68), r6(5.09 + 0.68)]);
    // The mode stays for the next MLEADERALIGN.
    await s.bus.submit('MLEADERALIGN');
    await s.bus.answer({ kind: 'selection', ids: [a] });
    expect(s.log.filter((l) => l === 'Current mode: Specify spacing (0.5)')).toHaveLength(2);
    await s.bus.submit('O');
    expect(s.bus.promptText).toContain('<specify Spacing>:');
    await s.bus.submit('S');
    expect(s.bus.promptText).toBe('Specify spacing <0.5000>:');
  });

  it('makes the last leader segments parallel to the reference one', async () => {
    const s = setup();
    const a = await s.text('0,0', '10,5');
    const b = await s.text('0,-4', '3,2');
    await s.bus.script(['MLA']);
    await s.bus.answer({ kind: 'selection', ids: [a, b] });
    await s.bus.script(['O', 'P']);
    await s.bus.answer({ kind: 'selection', ids: [a] });
    await s.bus.submit('10.36,0');
    const g = s.geom(b);
    const conn = g.branches[0]!.connection;
    // On A's vertical line, and the leader from (0,-4) runs at A's slope (1/2).
    expect(r6(g.contentBase.x)).toBe(10.36);
    expect(r6((conn.y + 4) / conn.x)).toBe(0.5);
  });

  it('distributes content evenly between two points', async () => {
    const s = setup();
    const a = await s.text('0,0', '10,5');
    const b = await s.text('0,1', '13,9');
    const c = await s.text('0,2', '15,1');
    await s.bus.script(['MLA']);
    await s.bus.answer({ kind: 'selection', ids: [a, b, c] });
    await s.bus.script(['O', 'D']);
    expect(s.bus.promptText).toBe('Specify first point or [Options]:');
    await s.bus.submit('20,0');
    expect(s.bus.promptText).toBe('Specify second point:');
    await s.bus.submit('20,10');
    expect(s.bus.command).toBeUndefined();
    // In the order they lie along the line: C lowest, then A, then B.
    expect([c, a, b].map((id) => pt(s.geom(id).contentBase))).toEqual([
      [20, 0],
      [20, 5],
      [20, 10],
    ]);
  });

  it('ignores other objects and asks again for a multileader to align to', async () => {
    const s = setup();
    const a = await s.text('0,0', '10,5');
    const line = [...s.model.entities()].find((e) => e.geom.kind === 'LINE')!.id;
    await s.bus.submit('MLA');
    await s.bus.answer({ kind: 'selection', ids: [line] });
    expect(s.log).toContain('1 object was not a multileader.');
    expect(s.bus.command).toBeUndefined();
    await s.bus.submit('MLA');
    await s.bus.answer({ kind: 'selection', ids: [a, line] });
    await s.bus.answer({ kind: 'selection', ids: [line] });
    expect(s.log).toContain('The object is not a multileader.');
    expect(s.bus.promptText).toBe('Select multileader to align to or [Options]:');
    await s.bus.submit('');
    expect(s.bus.command).toBeUndefined();
  });
});

describe('MLEADERCOLLECT', () => {
  it('collects block multileaders in a row under the first one’s leader', async () => {
    const s = setup();
    const a = await s.tag('0,0', '10,5');
    const b = await s.tag('0,10', '20,12');
    const c = await s.tag('5,-5', '30,0');
    expect(pt(s.geom(a).block!.position)).toEqual([11.36, 5]);
    await s.bus.submit('MLC');
    expect(s.bus.command).toBe('MLEADERCOLLECT');
    await s.bus.answer({ kind: 'selection', ids: [a, b, c] });
    expect(s.bus.promptText).toBe(
      'Specify collected multileader location or [Vertical/Horizontal/Wrap] <Horizontal>:',
    );
    await s.bus.submit('40,20');
    expect(s.bus.command).toBeUndefined();
    // Each TAG is 2 wide; the landing gap (0.09) between them; the corner is the upper left.
    expect([a, b, c].map((id) => pt(s.geom(id).block!.position))).toEqual([
      [41, 19],
      [43.09, 19],
      [45.18, 19],
    ]);
    // A keeps its leader line, its landing moved with the block; the others have none.
    expect(lines(s.geom(a))).toEqual([[[39.64, 19], [[[0, 0]]]]]);
    expect(s.geom(b).branches).toEqual([]);
    expect(s.geom(c).branches).toEqual([]);
    // What has no leader draws its block alone.
    expect(multiLeaderParts(s.geom(b), s.model).map((p) => p.geom.kind)).toEqual(['INSERT']);
  });

  it('collects in a column, or wrapped by width or by count', async () => {
    const s = setup();
    const ms = [
      await s.tag('0,0', '10,5'),
      await s.tag('0,10', '20,12'),
      await s.tag('0,9', '25,0'),
    ];
    await s.bus.script(['MLC']);
    await s.bus.answer({ kind: 'selection', ids: ms });
    await s.bus.script(['V', '0,0']);
    expect(ms.map((id) => pt(s.geom(id).block!.position))).toEqual([
      [1, -1],
      [1, -3.09],
      [1, -5.18],
    ]);
    // Vertical stays the default.
    await s.bus.submit('MLC');
    await s.bus.answer({ kind: 'selection', ids: ms });
    expect(s.bus.promptText).toContain('<Vertical>:');
    await s.bus.script(['W']);
    expect(s.bus.promptText).toBe('Specify wrap width or [Number]:');
    await s.bus.script(['4.5', '0,0']);
    expect(ms.map((id) => pt(s.geom(id).block!.position))).toEqual([
      [1, -1],
      [3.09, -1],
      [1, -3.09],
    ]);
    await s.bus.submit('MLC');
    await s.bus.answer({ kind: 'selection', ids: ms });
    await s.bus.script(['W', 'N']);
    expect(s.bus.promptText).toBe('Enter the maximum number of blocks per row:');
    await s.bus.script(['1', '0,0']);
    expect(ms.map((id) => pt(s.geom(id).block!.position))).toEqual([
      [1, -1],
      [1, -3.09],
      [1, -5.18],
    ]);
  });

  it('needs two multileaders with blocks', async () => {
    const s = setup();
    const t = await s.text('0,0', '10,5');
    const b = await s.tag('0,10', '20,12');
    await s.bus.submit('MLC');
    await s.bus.answer({ kind: 'selection', ids: [t, b] });
    expect(s.log).toContain('Only multileaders with block content are collected.');
    expect(s.log).toContain('Select two or more multileaders with block content.');
    expect(s.bus.command).toBeUndefined();
  });
});

describe('multileader align and collect geometry', () => {
  const at = (x: number, y: number, d = 1): MultiLeaderGeometry =>
    ({
      contentBase: { x, y },
      landingGap: 0.5,
      contentType: 0,
      branches: [
        {
          index: 0,
          connection: { x: x - d, y },
          direction: { x: d, y: 0 },
          doglegLength: 1,
          lines: [{ index: 0, vertices: [{ x: x - 5 * d, y: y - 3 }] }],
        },
      ],
    }) as unknown as MultiLeaderGeometry;

  it('leaves everything where it is for a direction of no length', () => {
    expect(
      alignMultiLeaders(
        [{ geom: at(0, 0) }, { geom: at(3, 3) }],
        0,
        { x: 0, y: 0 },
        { kind: 'current' },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('falls back to the current spacing where no parallel place exists', () => {
    // Direction along the reference's last segment: no intersection.
    const moves = alignMultiLeaders(
      [{ geom: at(0, 0) }, { geom: at(4, 7) }],
      0,
      { x: 4, y: 3 },
      { kind: 'parallel' },
    );
    const t = (4 * 4 + 7 * 3) / 25;
    expect(pt(moves[1]!)).toEqual([r6(4 * t - 4), r6(3 * t - 7)]);
  });

  it('spaces content behind the reference too', () => {
    const items = [
      { geom: at(0, 0), box: { minX: 0, minY: -1, maxX: 2, maxY: 1 } },
      { geom: at(-5, 0), box: { minX: -5, minY: -1, maxX: -3, maxY: 1 } },
    ];
    const moves = alignMultiLeaders(items, 0, { x: 1, y: 0 }, { kind: 'spacing', spacing: 1 });
    // B ends 1 before A's start: its box spans [-3, -1], so its base moves 2 right.
    expect(pt(moves[1]!)).toEqual([2, 0]);
  });

  it('distributes one multileader to the first point', () => {
    expect(
      pt(distributeMultiLeaders([{ geom: at(3, 3) }], { x: 1, y: 1 }, { x: 1, y: 1 })[0]!),
    ).toEqual([-2, -2]);
  });

  it('puts the kept block last when its leader comes from the right', () => {
    const items = [
      { geom: at(10, 0, -1), box: { minX: 8, minY: -1, maxX: 10, maxY: 1 } },
      { geom: at(20, 0), box: { minX: 20, minY: -1, maxX: 22, maxY: 1 } },
    ];
    const out = collectMultiLeaders(items, { x: 0, y: 0 }, { kind: 'horizontal' });
    // B first at the corner, then A 0.5 on, with A's leader.
    expect(pt(out[1]!.contentBase)).toEqual([0, -1]);
    expect(pt(out[0]!.contentBase)).toEqual([4.5, -1]);
    expect(out[0]!.branches).toHaveLength(1);
    expect(out[1]!.branches).toHaveLength(0);
  });
});
