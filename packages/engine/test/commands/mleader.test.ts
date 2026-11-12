// M2-09: MLEADER, MLEADEREDIT, AIMLEADEREDITADD and AIMLEADEREDITREMOVE on the PromptBus, driven
// as the command line drives them, with AutoCAD 2024's prompts ("MLEADER (Command)",
// "MLEADEREDIT (Command)", AutoCAD 2024 Help). A new multileader takes the current MLEADERSTYLE
// and stores what AutoCAD stores (acadsharp's sample_AC1032 MLEADER): the leader line ends at the
// landing location picked, the landing runs on for the dogleg length towards the content, and
// the content base point is the landing's end.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  MLEADER_OVERRIDES,
  PromptBus,
  attachmentRow,
  builtinCommands,
  constrainSegment,
  doubleClickCommand,
  multiLeaderParts,
  newMultiLeader,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DialogPrompt,
  type DocumentInit,
  type Entity,
  type EntityId,
  type HeaderValue,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type TextStyleRecord,
  type Vec2,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import {
  LAYER_0,
  LAYER_WALLS,
  MODEL_SPACE,
  blockRecord,
  circleGeom,
  entityInit,
  sampleInit,
} from '../model/fixtures';

const STANDARD_TEXT = '30';
const STANDARD = '35';
const CALLOUT = '36';
const TAG = '37';
const ATTDEF = '38';
const PLAIN = '3F';

const attdef = (tag: string, prompt: string, value: string, flags = 0) => ({
  kind: 'ATTDEF' as const,
  tag,
  prompt,
  value,
  flags,
  style: STANDARD_TEXT,
  position: { x: 0, y: 0 },
  height: 0.5,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
});

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

interface Setup {
  styles?: MLeaderStyleRecord[];
  header?: [string, HeaderValue][];
  view?: ViewHost;
  textStyles?: TextStyleRecord[];
  keptStyleNames?: string[];
}

function setup(o: Setup = {}) {
  const base = sampleInit();
  const init: DocumentInit = {
    ...base,
    ...(o.keptStyleNames && {
      meta: { ...base.meta, keptEntryNames: { mleaderStyles: o.keptStyleNames } },
    }),
    header: new Map([...base.header!, ['$TEXTSTYLE', 'Standard'], ...(o.header ?? [])]),
    tables: {
      ...base.tables,
      textStyles: o.textStyles ?? [textStyle],
      mleaderStyles: o.styles ?? [standard],
      blockRecords: [
        ...base.tables!.blockRecords!,
        blockRecord(TAG, 'TAG'),
        blockRecord(PLAIN, 'PLAIN'),
      ],
    },
    blocks: [
      ...base.blocks!,
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      { handle: PLAIN, name: 'PLAIN', basePoint: { x: 1, y: 1 } },
    ],
    entities: [
      ...base.entities!,
      entityInit('39', circleGeom(0, 0, 1), { owner: TAG }),
      entityInit(ATTDEF, attdef('NO', 'Tag number', '1'), { owner: TAG }),
      // A constant attribute asks nothing; one without a prompt is asked by its tag.
      entityInit('3B', attdef('KIND', 'Kind', 'K', 2), { owner: TAG }),
      entityInit('3C', attdef('NAME', '', 'N'), { owner: TAG }),
      entityInit('3D', circleGeom(1, 1, 1), { owner: PLAIN }),
    ],
  };
  const model = DocumentModel.create(init);
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    ...(o.view && { view: o.view }),
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const before = new Set([...model.entities()].map((e) => e.id));
  const added = (): Entity[] => [...model.entities()].filter((e) => !before.has(e.id));
  const leaders = () =>
    added()
      .filter((e) => e.geom.kind === 'MULTILEADER')
      .map((e) => e.geom as MultiLeaderGeometry);
  return { model, bus, log, added, leaders };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2) => [r6(p.x), r6(p.y)];

/** A canvas that measures every text as `box` and picks `picked()`. */
function host(
  box: { minX: number; minY: number; maxX: number; maxY: number } | undefined,
  picked: () => EntityId[] = () => [],
): ViewHost {
  return {
    request: (r): Promise<ViewReply> => {
      if (r.op === 'textBox' && box) return Promise.resolve({ ok: true, box });
      if (r.op === 'pick') return Promise.resolve({ ok: true, ids: picked() });
      return Promise.resolve({ ok: false, message: 'no' });
    },
  };
}

describe('MLEADER', () => {
  it('makes a text multileader with the current style, arrowhead first', async () => {
    const { bus, model, added, leaders } = setup();
    await bus.submit('MLD');
    expect(bus.command).toBe('MLEADER');
    expect(bus.promptText).toBe(
      'Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:',
    );
    await bus.submit('0,0');
    expect(bus.promptText).toBe('Specify leader landing location:');
    expect(bus.prompt).toMatchObject({ rubberBand: { from: { x: 0, y: 0 } } });
    await bus.submit('10,5');
    // The text opens at the landing's end, a gap beyond it, its top line's middle on the landing.
    expect(bus.prompt).toMatchObject({
      kind: 'string',
      message: 'Enter text',
      editor: { kind: 'mtext', height: 0.18, width: 0, attachment: 1, style: STANDARD_TEXT },
    });
    const editor = (bus.prompt as { editor: { position: Vec2 } }).editor;
    expect(pt(editor.position)).toEqual([10.45, 5.09]);
    await bus.answer({ kind: 'string', value: 'NOTE\\Psecond', editor: true });
    expect(bus.command).toBeUndefined();
    expect(added().map((e) => [e.type, e.owner, e.layer])).toEqual([
      ['MULTILEADER', MODEL_SPACE, LAYER_WALLS],
    ]);
    const [g] = leaders();
    expect(g).toMatchObject({
      style: STANDARD,
      overrideFlags: 0,
      pathType: 1,
      landing: true,
      dogleg: true,
      doglegLength: 0.36,
      arrowheadSize: 0.18,
      drawnArrowheadSize: 0.18,
      contentType: 2,
      scale: 1,
      annotative: false,
      landingGap: 0.09,
      textLeftAttachment: 1,
      textRightAttachment: 1,
    });
    expect(pt(g!.contentBase)).toEqual([10.36, 5]);
    expect(g!.branches).toHaveLength(1);
    const b = g!.branches[0]!;
    expect([pt(b.connection), pt(b.direction), b.doglegLength]).toEqual([[10, 5], [1, 0], 0.36]);
    expect(b.lines.map((l) => l.vertices.map(pt))).toEqual([[[0, 0]]]);
    expect(g!.text).toMatchObject({
      content: 'NOTE\\Psecond',
      style: STANDARD_TEXT,
      height: 0.18,
      width: 0,
      attachment: 1,
      rotation: 0,
      color: { kind: 'byBlock' },
    });
    expect(pt(g!.text!.position)).toEqual([10.45, 5.09]);
    // It draws: one leader line, the landing, the arrowhead and the text.
    const parts = multiLeaderParts(g!, model);
    expect(parts.map((p) => p.geom.kind)).toEqual(['SOLID', 'LWPOLYLINE', 'LWPOLYLINE', 'MTEXT']);
  });

  it('puts text on the left of a landing that comes from the right, aligned right', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', '20,0', '10,5', 'Left', '']);
    const [g] = leaders();
    expect(pt(g!.branches[0]!.direction)).toEqual([-1, 0]);
    expect(pt(g!.contentBase)).toEqual([9.64, 5]);
    expect(g!.text!.attachment).toBe(3);
    expect(pt(g!.text!.position)).toEqual([9.55, 5.09]);
    expect(g!.text!.content).toBe('Left');
  });

  it('places the text by each horizontal attachment of the style', () => {
    const h = 2;
    const gap = 0.5;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => attachmentRow(k, h, gap))).toEqual([
      { row: 0, dy: 0 },
      { row: 0, dy: 1 },
      { row: 1, dy: 0 },
      { row: 2, dy: -1 },
      { row: 2, dy: 0 },
      { row: 2, dy: 0.5 },
      { row: 0, dy: 2.5 },
      { row: 0, dy: 2 },
      { row: 2, dy: 0.5 },
      { row: 2, dy: 0 },
    ]);
  });

  it('asks for the landing first, and remembers the choice', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', 'L']);
    expect(bus.promptText).toBe(
      'Specify leader landing location or [leader arrowHead first/Content first/Options] <Options>:',
    );
    await bus.script(['10,5']);
    expect(bus.promptText).toBe('Specify leader arrowhead location:');
    await bus.script(['0,0', 'A', '']);
    const [g] = leaders();
    expect(pt(g!.branches[0]!.connection)).toEqual([10, 5]);
    expect(g!.branches[0]!.lines[0]!.vertices.map(pt)).toEqual([[0, 0]]);
    await bus.submit('MLEADER');
    expect(bus.promptText).toMatch(/^Specify leader landing location or/);
    await bus.script(['H']);
    expect(bus.promptText).toMatch(/^Specify leader arrowhead location or/);
  });

  it('takes the leader type and landing from Options, flagged as overrides', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', '', 'L', 'P', 'A', 'N', 'X']);
    expect(bus.promptText).toMatch(/^Specify leader arrowhead location/);
    await bus.script(['0,0', '10,5', 'Spline', '']);
    const [g] = leaders();
    expect(g).toMatchObject({ pathType: 2, landing: false, dogleg: false });
    expect(g!.overrideFlags).toBe(
      MLEADER_OVERRIDES.pathType | MLEADER_OVERRIDES.landing | MLEADER_OVERRIDES.dogleg,
    );
    // Without a landing the line ends at the point picked, where the landing would have ended.
    const b = g!.branches[0]!;
    expect(pt(b.connection)).toEqual([9.64, 5]);
    expect(pt(g!.contentBase)).toEqual([10, 5]);
    // The Options stay for the next multileader.
    await bus.script(['MLEADER', '0,0', '10,5', 'Again', '']);
    expect(leaders()[1]).toMatchObject({ pathType: 2, landing: false });
    // None draws no leader line.
    await bus.script(['MLEADER', 'O', 'L', 'N', 'X', '0,0', '10,5', 'Bare', '']);
    expect(leaders()[2]).toMatchObject({ pathType: 0 });
  });

  it('takes further points up to Maxpoints, Enter making the last the landing', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', 'O', 'M', '1']);
    expect(bus.history).toContain('Value must be 2 or greater.');
    await bus.script(['4', 'X', '0,0']);
    expect(bus.promptText).toBe('Specify next point:');
    await bus.script(['5,5', '8,5']);
    expect(bus.promptText).toBe('Specify leader landing location:');
    await bus.script(['12,5', 'Three', '']);
    expect(leaders()[0]!.branches[0]!.lines[0]!.vertices.map(pt)).toEqual([
      [0, 0],
      [5, 5],
      [8, 5],
    ]);
    // Enter at the first further point is not a landing yet; at the second it is.
    await bus.script(['MLEADER', '0,0', '']);
    expect(bus.promptText).toBe('Specify next point:');
    await bus.script(['5,5', '', 'Two', '']);
    const g = leaders()[1]!;
    expect(g.branches[0]!.lines[0]!.vertices.map(pt)).toEqual([[0, 0]]);
    expect(pt(g.branches[0]!.connection)).toEqual([5, 5]);
  });

  it('constrains the first and second segments to multiples of their angles', async () => {
    const { bus, leaders } = setup();
    await bus.script([
      'MLEADER',
      'O',
      'F',
      '45',
      'S',
      '90',
      'M',
      '3',
      'X',
      '0,0',
      '10,4',
      '10,9',
      'A',
      '',
    ]);
    const g = leaders()[0]!;
    expect(g.branches[0]!.lines[0]!.vertices.map(pt)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(pt(g.branches[0]!.connection)).toEqual([10, 9]);
    expect(pt(constrainSegment({ x: 0, y: 0 }, { x: 3, y: 3.2 }, Math.PI / 4))).toEqual([3.1, 3.1]);
    expect(constrainSegment({ x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toEqual({ x: 1, y: 1 });
  });

  it('makes a multileader without content', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'N', 'X', '0,0', '10,5']);
    expect(bus.command).toBeUndefined();
    const [g] = leaders();
    expect(g).toMatchObject({ contentType: 0 });
    expect(g!.text).toBeUndefined();
    expect(g!.overrideFlags).toBe(MLEADER_OVERRIDES.contentType);
    // Content first means arrowhead first for a multileader without content.
    await bus.script(['MLEADER', 'C']);
    expect(bus.promptText).toMatch(
      /^Specify leader arrowhead location or \[leader Landing first\/Content first/,
    );
  });

  it('makes block content with its attribute values, attached by its extents', async () => {
    const { bus, model, leaders, log } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'B', '?']);
    expect(log).toContain('  TAG');
    await bus.script(['NOPE']);
    expect(log).toContain('Block "NOPE" not found.');
    await bus.script(['tag', 'X', '0,0', '10,5']);
    expect(bus.promptText).toBe('Tag number <1>:');
    await bus.script(['A1']);
    expect(bus.promptText).toBe('NAME <N>:');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
    const [g] = leaders();
    expect(g).toMatchObject({ contentType: 1 });
    expect(g!.overrideFlags).toBe(MLEADER_OVERRIDES.contentType | MLEADER_OVERRIDES.blockContent);
    expect(g!.block).toMatchObject({
      block: TAG,
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      attributes: [
        { definition: ATTDEF, index: 0, width: 1, value: 'A1' },
        { definition: '3C', index: 1, width: 1, value: 'N' },
      ],
    });
    // The circle's left (extents −1…1) is at the landing's end: no gap for blocks.
    expect(pt(g!.block!.position)).toEqual([11.36, 5]);
    const parts = multiLeaderParts(g!, model);
    expect(parts.at(-1)!.geom).toMatchObject({ kind: 'INSERT', block: TAG });
  });

  it('places block content by its base point when the style connects there', async () => {
    const style: MLeaderStyleRecord = {
      ...standard,
      contentType: 1,
      block: TAG,
      blockConnection: 1,
      blockScale: { x: 2, y: 2, z: 2 },
    };
    const { bus, leaders } = setup({ styles: [style] });
    await bus.script(['MLEADER', '20,0', '10,5', '', '']);
    const [g] = leaders();
    expect(g!.overrideFlags).toBe(0);
    expect(pt(g!.block!.position)).toEqual([9.64, 5]);
    expect(g!.block!.scale).toEqual({ x: 2, y: 2, z: 2 });
    expect(g!.block!.attributes?.map((a) => a.value)).toEqual(['1', 'N']);
  });

  it('asks for a block when the style names one the drawing lacks', async () => {
    const { bus, leaders, log } = setup({ styles: [{ ...standard, contentType: 1, block: 'FF' }] });
    await bus.script(['MLEADER', '0,0', '10,5']);
    expect(log).toContain('The style’s block is not in the drawing.');
    await bus.script(['TAG', '', '']);
    expect(leaders()[0]!.block!.block).toBe(TAG);
  });

  it('places the text first in a box, then the leader on the side of the arrowhead', async () => {
    const { bus, leaders } = setup();
    await bus.script(['MLEADER', 'C']);
    expect(bus.promptText).toBe(
      'Specify first corner of text or [leader arrowHead first/leader Landing first/Options] <Options>:',
    );
    await bus.script(['20,10', '30,6']);
    expect(bus.prompt).toMatchObject({
      editor: { position: { x: 20, y: 10 }, width: 10, attachment: 1 },
    });
    await bus.script(['Boxed', '']);
    expect(bus.promptText).toBe('Specify leader arrowhead location:');
    await bus.submit('0,0');
    const [g] = leaders();
    // Middle of the top line: the landing ends a gap left of the box, half a height below its top.
    expect(g!.text).toMatchObject({ attachment: 1, width: 10 });
    expect(pt(g!.text!.position)).toEqual([20, 10]);
    expect(pt(g!.contentBase)).toEqual([19.91, 9.91]);
    expect(pt(g!.branches[0]!.connection)).toEqual([19.55, 9.91]);
    // From the right, the text is aligned right in the box.
    await bus.script(['MLEADER', '20,10', '30,6', 'R', '', '50,0']);
    const r = leaders()[1]!;
    expect(r.text!.attachment).toBe(3);
    expect(pt(r.text!.position)).toEqual([30, 10]);
    expect(pt(r.contentBase)).toEqual([30.09, 9.91]);
    expect(pt(r.branches[0]!.direction)).toEqual([-1, 0]);
  });

  it('places a block first, the landing reaching the side of its extents', async () => {
    const { bus, leaders } = setup({ styles: [{ ...standard, contentType: 1, block: TAG }] });
    await bus.script(['MLEADER', 'C']);
    expect(bus.promptText).toMatch(/^Specify location of block or/);
    await bus.script(['20,10', 'V', '', '30,0']);
    const [g] = leaders();
    expect(pt(g!.block!.position)).toEqual([20, 10]);
    expect(pt(g!.contentBase)).toEqual([21, 10]);
    expect(pt(g!.branches[0]!.connection)).toEqual([21.36, 10]);
  });

  it('attaches above or below the text with vertical attachment', async () => {
    const style = { ...standard, textAttachmentDirection: 1 };
    const { bus, leaders } = setup({ styles: [style] });
    await bus.script(['MLEADER', '0,0', '10,5', 'Up', '']);
    const [g] = leaders();
    expect(pt(g!.branches[0]!.direction)).toEqual([0, 1]);
    expect(pt(g!.contentBase)).toEqual([10, 5]);
    expect(g!.text!.attachment).toBe(8);
    expect(pt(g!.text!.position)).toEqual([10, 5.09]);
    await bus.script(['MLEADER', '0,10', '10,5', 'Down', '']);
    expect(leaders()[1]!.text!.attachment).toBe(2);
    expect(pt(leaders()[1]!.text!.position)).toEqual([10, 4.91]);
    await bus.script(['MLEADER', 'C', '20,10', '30,6', 'Boxed', '', '25,0']);
    const c = leaders()[2]!;
    expect([c.text!.attachment, ...pt(c.text!.position), ...pt(c.contentBase)]).toEqual([
      8, 25, 6, 25, 5.91,
    ]);
    await bus.script(['MLEADER', '20,10', '30,6', 'Boxed', '', '25,20']);
    expect(pt(leaders()[3]!.contentBase)).toEqual([25, 10.09]);
  });

  it('gives a drawing without multileader styles AutoCAD’s Standard', async () => {
    const { bus, model, leaders } = setup({ styles: [] });
    await bus.script(['MLEADER', '0,0', '10,5', 'Metric', '']);
    const styles = [...model.tables.mleaderStyles.values()];
    expect(styles.map((s) => [s.name, s.textHeight, s.landingGap, s.doglegLength])).toEqual([
      ['Standard', 4, 2, 8],
    ]);
    expect(styles[0]!.textStyle).toBe(STANDARD_TEXT);
    const [g] = leaders();
    expect(g!.style).toBe(styles[0]!.handle);
    expect(pt(g!.contentBase)).toEqual([18, 5]);
    expect(g!.text!.height).toBe(4);
  });

  it('names its Standard style anew where the drawing keeps one it does not map (M2-29)', async () => {
    // An R13/R14 DXF ezdxf wrote lists an R2007 STANDARD style that acad-ts keeps as a proxy
    // object: the save cannot replace it, so the new style takes the next free name.
    const { bus, model } = setup({ styles: [], keptStyleNames: ['STANDARD', 'Standard1'] });
    await bus.script(['MLEADER', '0,0', '10,5', 'Metric', '']);
    await bus.script(['MLEADER', '0,20', '10,25', 'Again', '']);
    expect([...model.tables.mleaderStyles.values()].map((s) => s.name)).toEqual(['Standard2']);
  });

  it('makes no Standard style, and no multileader, in a drawing without a text style', async () => {
    // AutoCAD's Standard multileader style names a text style; R1 and R2.5 drawings have none.
    const { bus, model, added, log } = setup({ styles: [], textStyles: [] });
    // It says so before asking for anything.
    await bus.submit('MLEADER');
    expect(bus.command).toBeUndefined();
    expect(log.filter((l) => l.startsWith('The drawing has no text style'))).toEqual([
      'The drawing has no text style, which a multileader style needs.',
    ]);
    expect(added().filter((e) => e.type === 'MULTILEADER')).toEqual([]);
    expect(model.tables.mleaderStyles.size).toBe(0);
  });

  it('takes CMLEADERSTYLE, its scale and the text style it names', async () => {
    const notes: TextStyleRecord = { ...textStyle, handle: '31', name: 'Notes' };
    const callout: MLeaderStyleRecord = {
      ...standard,
      handle: CALLOUT,
      name: 'Callout',
      scale: 2,
      textStyle: '31',
      textAlignAlwaysLeft: true,
      annotative: true,
    };
    const { bus, leaders, log } = setup({
      styles: [standard, callout],
      textStyles: [textStyle, notes],
      header: [['CMLEADERSTYLE', 'callout']],
      view: host({ minX: 0, minY: 0, maxX: 3, maxY: 1 }),
    });
    await bus.script(['MLEADER', '20,0', '10,5', 'Scaled', '']);
    expect(log.some((l) => l.startsWith('Annotative multileaders are not made yet'))).toBe(true);
    const [g] = leaders();
    expect(g).toMatchObject({
      style: CALLOUT,
      scale: 2,
      doglegLength: 0.36,
      drawnArrowheadSize: 0.36,
    });
    expect(g!.overrideFlags).toBe(0);
    expect(g!.branches[0]!.doglegLength).toBe(0.72);
    expect(g!.text).toMatchObject({ style: '31', height: 0.36 });
    // Always left justified: moved left by its measured width, attached by its left.
    expect(g!.text!.attachment).toBe(1);
    expect(pt(g!.text!.position)).toEqual([10 - 0.72 - 0.18 - 3, 5.18]);
  });

  it('stops without a text style, and on Esc or an empty text', async () => {
    const empty = setup({ textStyles: [] });
    await empty.bus.script(['MLEADER', '0,0', '10,5']);
    expect(empty.log).toContain('The drawing has no text style.');
    expect(empty.bus.command).toBeUndefined();
    await empty.bus.script(['MLEADER', 'C', '0,0']);
    expect(empty.log.filter((l) => l === 'The drawing has no text style.')).toHaveLength(2);

    const { bus, added } = setup();
    await bus.script(['MLEADER', '0,0', '10,5', '']);
    expect(bus.command).toBeUndefined();
    for (const keys of [
      ['MLEADER', '0,0'],
      ['MLEADER', 'L', '10,5'],
      ['MLEADER', 'C', '0,0'],
      ['MLEADER', 'C', '0,0', '5,5', 'x', ''],
      ['MLEADER', 'C', '0,0', '5,5'],
      ['MLEADER', 'O', 'M', '3', 'X', '0,0'],
      ['MLEADER', 'O', 'L'],
      ['MLEADER', 'O', 'A'],
      ['MLEADER', 'O', 'C'],
      ['MLEADER', 'O', 'C', 'B'],
      ['MLEADER', 'O', 'M'],
      ['MLEADER', 'O', 'F'],
      ['MLEADER', 'O'],
      ['MLEADER'],
    ]) {
      await bus.script(keys);
      await bus.cancel();
    }
    // A command-line text of two lines; Esc after the first drops the multileader, as MTEXT.
    await bus.script(['MLEADER', '0,0', '10,5', 'one', 'two', '']);
    await bus.script(['MLEADER', '0,0', '10,5', 'kept']);
    await bus.cancel();
    const texts = added().map((e) => (e.geom as MultiLeaderGeometry).text?.content);
    expect(texts).toEqual(['one\\Ptwo']);
  });

  it('stops on Esc in a block content’s prompts', async () => {
    const { bus, added } = setup({ styles: [{ ...standard, contentType: 1, block: 'FF' }] });
    for (const keys of [
      ['MLEADER', '0,0', '10,5'],
      ['MLEADER', '0,0', '10,5', 'TAG'],
      ['MLEADER', 'C', '0,0'],
      ['MLEADER', 'C', '0,0', 'TAG'],
      ['MLEADER', 'C', '0,0', 'TAG', '', ''],
      ['MLEADER', '0,0', '10,5', ''],
      ['MLEADER', 'C', '0,0', ''],
    ]) {
      await bus.script(keys);
      await bus.cancel();
    }
    expect(added()).toHaveLength(0);
  });

  it('ends on Enter where a point or a block name has no default', async () => {
    for (const keys of [
      ['MLEADER', '0,0', ''],
      ['MLEADER', 'L', '10,5', ''],
      ['MLEADER', 'C', '0,0', ''],
      ['MLEADER', 'C', '0,0', '5,5', ''],
      ['MLEADER', 'C', '0,0', '5,5', 'x', '', ''],
      ['MLEADER', 'O', 'C', 'B', ''],
    ]) {
      const { bus, added } = setup();
      await bus.script(keys);
      expect(bus.command, keys.join(' ')).toBeUndefined();
      expect(added()).toHaveLength(0);
    }
  });

  it('ends on Enter at a missing block\u2019s name, or at the arrowhead after a block', async () => {
    const missing = setup({ styles: [{ ...standard, contentType: 1, block: 'FF' }] });
    await missing.bus.script(['MLEADER', '0,0', '10,5', '']);
    expect(missing.bus.command).toBeUndefined();
    const first = setup({ styles: [{ ...standard, contentType: 1, block: PLAIN }] });
    await first.bus.script(['MLEADER', 'C', '0,0', '']);
    expect(first.bus.command).toBeUndefined();
    expect([...missing.added(), ...first.added()]).toHaveLength(0);
  });

  it('offers the landing setting as it stands', async () => {
    const { bus } = setup();
    await bus.script(['MLEADER', 'O', 'A', 'N', 'A']);
    expect(bus.promptText).toBe('Use landing [Yes/No] <No>:');
  });

  it('offers the current block as the default, and asks nothing of a block without attributes', async () => {
    const { bus, leaders, log } = setup({ styles: [{ ...standard, block: PLAIN }] });
    await bus.script(['MLEADER', 'O', 'C', 'B']);
    expect(bus.promptText).toBe('Enter block name or [?] <PLAIN>:');
    await bus.script(['', 'X', '0,0', '10,5']);
    expect(bus.command).toBeUndefined();
    expect(log).not.toContain('Enter attribute values');
    const [g] = leaders();
    expect(g!.block!.attributes).toBeUndefined();
    // Extents (0…2 about base point 1,1) put the circle's left on the landing's end.
    expect(pt(g!.block!.position)).toEqual([11.36, 5]);
  });

  it('takes the current text style when the style names none, and a scale of 1 for none', async () => {
    const plain: MLeaderStyleRecord = {
      handle: STANDARD,
      ...standardMLeaderStyle(false, undefined),
      scale: 0,
      textAlignAlwaysLeft: true,
    };
    const { bus, leaders } = setup({ styles: [plain] });
    await bus.script(['MLEADER', '20,0', '10,5', 'x', '']);
    const [g] = leaders();
    expect(g).toMatchObject({ scale: 1, text: { style: STANDARD_TEXT } });
    // Always left justified, but nothing measures the text here: it stays aligned right.
    expect(g!.text!.attachment).toBe(3);
  });

  it('places text first by the middle or bottom row its attachments name', async () => {
    const style = { ...standard, textLeftAttachment: 2, textRightAttachment: 4 };
    const { bus, leaders } = setup({ styles: [style] });
    await bus.script(['MLEADER', 'C', '20,10', '30,6', 'm', '', '0,0']);
    await bus.script(['MLEADER', '20,10', '30,6', 'b', '', '40,0']);
    const [m, b] = leaders();
    expect([m!.text!.attachment, ...pt(m!.text!.position), ...pt(m!.contentBase)]).toEqual([
      4, 20, 8, 19.91, 8,
    ]);
    expect([b!.text!.attachment, ...pt(b!.text!.position), ...pt(b!.contentBase)]).toEqual([
      9, 30, 6, 30.09, 6,
    ]);
  });

  it('places a block first by its base point, or above and below its extents', async () => {
    const base = { ...standard, contentType: 1, block: PLAIN };
    const one = setup({ styles: [{ ...base, blockConnection: 1 }] });
    await one.bus.script(['MLEADER', 'C', '20,10', '0,0']);
    expect(pt(one.leaders()[0]!.contentBase)).toEqual([20, 10]);
    const up = setup({ styles: [{ ...base, textAttachmentDirection: 1 }] });
    await up.bus.script(['MLEADER', 'C', '20,10', '20,0']);
    await up.bus.script(['MLEADER', '20,10', '20,30']);
    // PLAIN's circle spans 0…2 about base point 1,1: placed at 20,10 it spans 19…21, 9…11.
    expect(up.leaders().map((g) => [pt(g.contentBase), pt(g.branches[0]!.direction)])).toEqual([
      [
        [20, 9],
        [0, 1],
      ],
      [
        [20, 11],
        [0, -1],
      ],
    ]);
    const left = setup({ styles: [base] });
    await left.bus.script(['MLEADER', 'C', '20,10', '0,0']);
    expect(pt(left.leaders()[0]!.contentBase)).toEqual([19, 10]);
  });

  it('builds the same multileader from the same inputs (newMultiLeader)', () => {
    const settings = settingsOf(standard);
    const g = newMultiLeader({
      style: { ...standard, scale: 3 },
      settings,
      scale: 1,
      vertices: [{ x: 0, y: 0 }],
      landing: { connection: { x: 5, y: 5 }, direction: { x: 1, y: 0 }, end: { x: 5.36, y: 5 } },
    });
    expect(g.overrideFlags).toBe(MLEADER_OVERRIDES.scale);
    expect(settingsOf({ ...standard, contentType: 3, maxLeaderPoints: 0 })).toMatchObject({
      contentType: 0,
      maxPoints: 2,
    });
  });
});

/** A drawing with one text multileader made by MLEADER (arrowhead at 0,0, landing at 10,5). */
async function withLeader(o: Setup = {}) {
  const s = setup(o);
  await s.bus.script(['MLEADER', '0,0', '10,5', 'NOTE', '']);
  const id = s.added()[0]!.id;
  const geom = () => s.model.entity(id)!.geom as MultiLeaderGeometry;
  return { ...s, id, geom };
}

describe('MLEADEREDIT', () => {
  it('adds leaders to the landing on their side of the text', async () => {
    const { bus, geom } = await withLeader();
    await bus.submit('MLE');
    expect(bus.command).toBe('MLEADEREDIT');
    expect(bus.promptText).toBe('Select a multileader:');
    await bus.submit('L');
    expect(bus.promptText).toBe('Specify leader arrowhead location or [Remove leaders]:');
    await bus.script(['0,10', '2,-3', '']);
    expect(bus.command).toBeUndefined();
    const b = geom().branches;
    expect(b).toHaveLength(1);
    expect(b[0]!.lines.map((l) => [l.index, l.vertices.map(pt)])).toEqual([
      [0, [[0, 0]]],
      [1, [[0, 10]]],
      [2, [[2, -3]]],
    ]);
  });

  it('gives a leader on the other side of the text a landing of its own', async () => {
    const box = { minX: 10.45, minY: 4.6, maxX: 14.45, maxY: 5.18 };
    const { bus, geom } = await withLeader({ view: host(box) });
    await bus.script(['AIMLEADEREDITADD', 'L', '30,0', '31,2', '']);
    const b = geom().branches;
    expect(b).toHaveLength(2);
    // Middle of the top line on the right: half a text height below the text's top.
    expect([b[1]!.index, pt(b[1]!.direction), pt(b[1]!.connection), b[1]!.doglegLength]).toEqual([
      1,
      [-1, 0],
      [r6(14.45 + 0.09 + 0.36), 5.09],
      0.36,
    ]);
    expect(b[1]!.lines.map((l) => l.vertices.map(pt))).toEqual([[[30, 0]], [[31, 2]]]);
  });

  it('cannot place a leader on the far side of text it cannot measure', async () => {
    const { bus, geom, log } = await withLeader();
    await bus.script(['MLEADEREDIT', 'L', '30,0', '']);
    expect(log.some((l) => l.startsWith('The size of the content is not known here'))).toBe(true);
    expect(geom().branches).toHaveLength(1);
  });

  it('adds a block content’s other landing at the middle of its extents’ side', async () => {
    const style = { ...standard, contentType: 1, block: TAG };
    const { bus, geom } = await (async () => {
      const s = setup({ styles: [style] });
      await s.bus.script(['MLEADER', '0,0', '10,5', '', '']);
      const id = s.added()[0]!.id;
      return { ...s, geom: () => s.model.entity(id)!.geom as MultiLeaderGeometry };
    })();
    await bus.script(['MLEADEREDIT', 'L', '30,0', '']);
    const b = geom().branches[1]!;
    expect([pt(b.connection), pt(b.direction)]).toEqual([
      [r6(12.36 + 0.36), 5],
      [-1, 0],
    ]);
  });

  it('removes the leaders nearest the points given, never the last', async () => {
    const { bus, geom, log } = await withLeader({
      view: host({ minX: 10.45, minY: 4.6, maxX: 14.45, maxY: 5.18 }),
    });
    await bus.script(['MLEADEREDIT', 'L', '0,10', '30,0', 'R']);
    expect(bus.promptText).toBe('Specify leaders to remove:');
    await bus.script(['1,9.5', '29,0']);
    // The branch whose only line went goes with it.
    expect(geom().branches.map((b) => b.lines.map((l) => l.vertices.map(pt)))).toEqual([
      [[[0, 0]]],
    ]);
    await bus.script(['0,0']);
    expect(log).toContain('A multileader keeps at least one leader line.');
    await bus.script(['']);
    expect(bus.command).toBeUndefined();
    await bus.script(['AIMLEADEREDITADD', 'L', '0,10', '']);
    await bus.script(['AIMLEADEREDITREMOVE', 'L', '5,2.5', '']);
    expect(geom().branches[0]!.lines.map((l) => l.vertices.map(pt))).toEqual([[[0, 10]]]);
  });

  it('asks again for a multileader when something else is picked', async () => {
    const line = [...setup().model.entities()][0]!;
    let pick: EntityId[] = [line.id];
    const { bus, log, id, geom } = await withLeader({ view: host(undefined, () => pick) });
    await bus.script(['MLEADEREDIT', '1,0']);
    expect(log).toContain('The object is not a multileader.');
    expect(bus.promptText).toBe('Select a multileader:');
    pick = [id];
    await bus.script(['10,5', '0,9', '']);
    expect(geom().branches[0]!.lines).toHaveLength(2);
    // Enter at "Select a multileader" ends the command.
    await bus.script(['MLEADEREDIT', '']);
    expect(bus.command).toBeUndefined();
    await bus.script(['AIMLEADEREDITREMOVE', '']);
    expect(bus.command).toBeUndefined();
  });

  it('adds to the nearest landing of a multileader without content', async () => {
    const s = setup();
    await s.bus.script(['MLEADER', 'O', 'C', 'N', 'X', '0,0', '10,5']);
    const id = s.added()[0]!.id;
    await s.bus.script(['MLEADEREDIT', 'L', '30,0', '']);
    const g = s.model.entity(id)!.geom as MultiLeaderGeometry;
    expect(g.branches).toHaveLength(1);
    expect(g.branches[0]!.lines).toHaveLength(2);
    expect(LAYER_0).toBe('10');
  });
});

// M2-25: AutoCAD's built-in content blocks, authored when a drafter names one the drawing lacks
// ("_DetailCallout", "_TagCircle", "_TagBox", "_TagSlot", "_TagHexagon", "_TagTriangle": the
// Source block list of the Multileader Style Manager's Content tab, AutoCAD 2024 Help).
describe('MLEADER built-in content blocks', () => {
  const named = (model: DocumentModel, name: string) =>
    [...model.blocks.values()].filter((b) => b.name === name);
  const parts = (model: DocumentModel, name: string) =>
    model.blockEntities(named(model, name)[0]!.handle).map((id) => model.entity(id)!);

  it('authors _TagCircle when the drawing lacks it, its tag asked for', async () => {
    const { bus, model, leaders } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'B', '_tagcircle', 'X', '0,0', '10,5']);
    expect(bus.promptText).toBe('Enter tag number <TAGNUMBER>:');
    await bus.script(['7']);
    expect(bus.command).toBeUndefined();
    const [def] = named(model, '_TagCircle');
    expect(def).toBeDefined();
    expect(def!.basePoint).toEqual({ x: 0, y: 0 });
    // A circle round the tag number, both ByBlock on layer 0, the text the style's height.
    const ents = parts(model, '_TagCircle');
    expect(ents.map((e) => [e.geom.kind, e.layer, e.color])).toEqual([
      ['CIRCLE', LAYER_0, { kind: 'byBlock' }],
      ['ATTDEF', LAYER_0, { kind: 'byBlock' }],
    ]);
    expect(ents[0]!.geom).toMatchObject({ center: { x: 0, y: 0 }, radius: r6(0.18 * 1.5) });
    expect(ents[1]!.geom).toMatchObject({
      tag: 'TAGNUMBER',
      prompt: 'Enter tag number',
      value: 'TAGNUMBER',
      style: STANDARD_TEXT,
      height: 0.18,
      halign: 1,
      valign: 2,
      position: { x: 0, y: 0 },
      alignmentPoint: { x: 0, y: 0 },
    });
    const [g] = leaders();
    expect(g!.block).toMatchObject({
      block: def!.handle,
      attributes: [{ definition: ents[1]!.handle, index: 0, width: 1, value: '7' }],
    });
    // The circle's left (radius 0.27) is at the landing's end.
    expect(pt(g!.block!.position)).toEqual([r6(10.36 + 0.27), 5]);
    expect(multiLeaderParts(g!, model).at(-1)!.geom).toMatchObject({ kind: 'INSERT' });
    // The next multileader takes the block now in the drawing.
    await bus.script(['MLEADER', '0,0', '-10,5', '8']);
    expect(named(model, '_TagCircle')).toHaveLength(1);
    expect(leaders()[1]!.block!.block).toBe(def!.handle);
  });

  it('authors each shape AutoCAD lists, with what it draws', async () => {
    const shapes: [string, string[]][] = [
      ['_DetailCallout', ['CIRCLE', 'LINE', 'ATTDEF', 'ATTDEF']],
      ['_TagBox', ['LWPOLYLINE', 'ATTDEF']],
      ['_TagSlot', ['LWPOLYLINE', 'ATTDEF']],
      ['_TagHexagon', ['LWPOLYLINE', 'ATTDEF']],
      ['_TagTriangle', ['LWPOLYLINE', 'ATTDEF']],
    ];
    for (const [name, kinds] of shapes) {
      const { bus, model, leaders } = setup();
      await bus.script(['MLEADER', 'O', 'C', 'B', name.toUpperCase(), 'X', '0,0', '10,5']);
      while (bus.command === 'MLEADER') await bus.submit('');
      expect(
        parts(model, name).map((e) => e.geom.kind),
        name,
      ).toEqual(kinds);
      expect(leaders()[0]!.block!.block).toBe(named(model, name)[0]!.handle);
    }
  });

  it('asks the detail callout for its view and sheet numbers', async () => {
    const { bus, model, leaders } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'B', '_DetailCallout', 'X', '0,0', '10,5']);
    expect(bus.promptText).toBe('Enter view number <VIEWNUMBER>:');
    await bus.script(['3']);
    expect(bus.promptText).toBe('Enter sheet number <SHEETNUMBER>:');
    await bus.script(['A-501']);
    const defs = parts(model, '_DetailCallout').filter((e) => e.geom.kind === 'ATTDEF');
    expect(defs.map((e) => (e.geom as { tag: string }).tag)).toEqual(['VIEWNUMBER', 'SHEETNUMBER']);
    expect(leaders()[0]!.block!.attributes!.map((a) => a.value)).toEqual(['3', 'A-501']);
  });

  it('offers a built-in block for a style’s block the drawing lacks', async () => {
    const { bus, model, leaders, log } = setup({
      styles: [{ ...standard, contentType: 1, block: 'FF' }],
    });
    await bus.script(['MLEADER', '0,0', '10,5']);
    expect(log).toContain('The style’s block is not in the drawing.');
    await bus.script(['_TagHexagon', '12']);
    expect(bus.command).toBeUndefined();
    expect(leaders()[0]!.block!.block).toBe(named(model, '_TagHexagon')[0]!.handle);
  });

  it('lists the built-in blocks after the drawing’s at ?', async () => {
    const { bus, log } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'B', '?']);
    expect(log).toContain('Built-in blocks:');
    expect(log).toContain('  _TagCircle');
  });

  it('authors no block when the command ends at the content prompts', async () => {
    const { bus, model } = setup();
    await bus.script(['MLEADER', 'O', 'C', 'B', '_TagBox']);
    await bus.cancel();
    expect(named(model, '_TagBox')).toHaveLength(0);
  });
});

// M2-25: a multileader's text edited in place (AutoCAD 2024: double-clicking a multileader's
// text, or TEXTEDIT on it, opens the In-Place Text Editor).
describe('TEXTEDIT on a multileader', () => {
  it('opens its text in the MTEXT editor and keeps everything else', async () => {
    const { bus, id, geom } = await withLeader();
    const before = geom();
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    expect(bus.prompt).toMatchObject({
      kind: 'string',
      editor: {
        kind: 'mtext',
        value: 'NOTE',
        height: 0.18,
        width: 0,
        attachment: 1,
        style: STANDARD_TEXT,
      },
    });
    expect(pt((bus.prompt as { editor: { position: Vec2 } }).editor.position)).toEqual([
      10.45, 5.09,
    ]);
    await bus.answer({ kind: 'string', value: 'NOTE\\PSee detail 3', editor: true });
    expect(geom()).toEqual({ ...before, text: { ...before.text, content: 'NOTE\\PSee detail 3' } });
    // Multiple mode asks for the next object; Undo takes the edit back.
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.submit('U');
    expect(geom()).toEqual(before);
  });

  it('runs on a double click on a text multileader, not on a block one', async () => {
    const picked: EntityId[] = [];
    const { bus, model, id } = await withLeader({ view: host(undefined, () => picked) });
    picked.push(id);
    expect(doubleClickCommand(model.entity(id))).toBe('TEXTEDIT');
    await bus.doubleClick({ x: 10.5, y: 5 });
    expect(bus.command).toBe('TEXTEDIT');
    expect(bus.prompt).toMatchObject({ editor: { kind: 'mtext', value: 'NOTE' } });
    await bus.cancel();
    // A block multileader without attribute values to edit opens nothing (M2-44).
    const s = setup({ styles: [{ ...standard, contentType: 1, block: PLAIN }] });
    await s.bus.script(['MLEADER', '0,0', '10,5']);
    expect(doubleClickCommand(s.added()[0]!)).toBeUndefined();
  });

  it('keeps the text unchanged when it comes back the same or empty', async () => {
    const { bus, id, geom, log } = await withLeader();
    const before = geom();
    await bus.script(['TEXTEDIT', 'M', 'S']);
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'string', value: 'NOTE', editor: true });
    expect(bus.command).toBeUndefined();
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'string', value: '', editor: true });
    expect(log).toContain('A multileader’s text cannot be empty: ERASE removes the multileader.');
    expect(geom()).toEqual(before);
  });

  it('moves text the style always left-justifies by the change in its width', async () => {
    // 0.6 of the height per character, on one line.
    const view: ViewHost = {
      request: (r): Promise<ViewReply> => {
        if (r.op !== 'textBox') return Promise.resolve({ ok: false, message: 'no' });
        const w = r.text.contents.length * r.text.height * 0.6;
        const { x, y } = r.text.position;
        return Promise.resolve({
          ok: true,
          box: { minX: x, maxX: x + w, minY: y - r.text.height, maxY: y },
        });
      },
    };
    const style = { ...standard, textAlignAlwaysLeft: true };
    const s = setup({ styles: [style], view });
    await s.bus.script(['MLEADER', '20,0', '10,5', 'Left', '']);
    const id = s.added()[0]!.id;
    const g = () => s.model.entity(id)!.geom as MultiLeaderGeometry;
    const x0 = g().text!.position.x;
    expect(g().text!.attachment).toBe(1);
    await s.bus.script(['TEXTEDIT', 'M', 'S']);
    await s.bus.answer({ kind: 'selection', ids: [id] });
    await s.bus.answer({ kind: 'string', value: 'Leftmost', editor: true });
    // Four more characters: the text's left moves 4 × 0.6 × 0.18 left; its right stays.
    expect(r6(g().text!.position.x)).toBe(r6(x0 - 4 * 0.6 * 0.18));
  });

  it('says what it edits when something else is picked', async () => {
    const { bus, log } = await withLeader();
    const line = [...setup().model.entities()][0]!;
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [line.id] });
    expect(log).toContain(
      'The object selected is not text, multiline text, a multileader or a dimension.',
    );
  });
});

// M2-44: a block multileader's attribute values in AutoCAD's Edit Attributes dialog (AutoCAD
// 2024: double-clicking a multileader with block content opens Edit Attributes), and the MTEXT
// editor showing a multileader's text frame and background mask as the text draws them.
describe('TEXTEDIT on a block multileader', () => {
  async function withTag(o: Setup = {}) {
    const s = setup({ styles: [{ ...standard, contentType: 1, block: TAG }], ...o });
    // NO is asked first (default 1), then NAME by its tag; KIND is constant and asked nothing.
    await s.bus.script(['MLEADER', '0,0', '10,5', '7', 'Pump']);
    const id = s.added()[0]!.id;
    const geom = () => s.model.entity(id)!.geom as MultiLeaderGeometry;
    return { ...s, id, geom };
  }

  it('opens the Edit Attributes dialog on its values and writes them back', async () => {
    const { bus, id, geom } = await withTag();
    const before = geom();
    expect(before.block!.attributes!.map((a) => a.value)).toEqual(['7', 'Pump']);
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    expect(bus.prompt).toMatchObject({
      kind: 'dialog',
      message: 'Edit Attributes',
      dialog: {
        type: 'attedit',
        block: 'TAG',
        attributes: [
          { handle: ATTDEF, tag: 'NO', prompt: 'Tag number', value: '7', multiline: false },
          // An ATTDEF without a prompt is shown by its tag, as ATTEDIT shows it.
          { handle: '3C', tag: 'NAME', prompt: 'NAME', value: 'Pump', multiline: false },
        ],
      },
    });
    await bus.answer({
      kind: 'dialog',
      action: 'ok',
      attributes: [{ handle: '3C', value: 'Fan' }],
    });
    expect(geom()).toEqual({
      ...before,
      block: {
        ...before.block,
        attributes: [
          before.block!.attributes![0],
          { ...before.block!.attributes![1], value: 'Fan' },
        ],
      },
    });
    // Multiple mode asks for the next object; Undo takes the edit back.
    expect(bus.promptText).toBe('Select an annotation object or [Undo/Mode]:');
    await bus.submit('U');
    expect(geom()).toEqual(before);
  });

  it('runs on a double click, and Cancel changes nothing', async () => {
    const picked: EntityId[] = [];
    const { bus, model, id, geom } = await withTag({ view: host(undefined, () => picked) });
    picked.push(id);
    const before = geom();
    expect(doubleClickCommand(model.entity(id))).toBe('TEXTEDIT');
    await bus.doubleClick({ x: 10.5, y: 5 });
    expect(bus.command).toBe('TEXTEDIT');
    expect(bus.prompt).toMatchObject({ kind: 'dialog', dialog: { type: 'attedit' } });
    await bus.cancel();
    expect(bus.command).toBeUndefined();
    expect(geom()).toEqual(before);
  });

  it('keeps a value OK leaves unchanged, and an empty value', async () => {
    const { bus, id, geom } = await withTag();
    const before = geom();
    await bus.script(['TEXTEDIT', 'M', 'S']);
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'dialog', action: 'ok', attributes: [] });
    expect(bus.command).toBeUndefined();
    expect(geom()).toEqual(before);
    // An attribute may be empty, as an ATTRIB's value may.
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    await bus.answer({ kind: 'dialog', action: 'ok', attributes: [{ handle: ATTDEF, value: '' }] });
    expect(geom().block!.attributes!.map((a) => a.value)).toEqual(['', 'Pump']);
  });

  it('leaves out values whose attribute definition is gone or constant', async () => {
    const { bus, id, model, geom } = await withTag();
    const g = geom();
    const attributes = [
      ...g.block!.attributes!,
      // A constant ATTDEF's value and one naming no ATTDEF are not the drafter's to edit.
      { definition: '3B', index: 2, width: 1, value: 'K' },
      { index: 3, width: 1, value: 'orphan' },
    ];
    const edited = { ...g, block: { ...g.block!, attributes } };
    model.apply({
      entities: {
        updated: [{ before: model.entity(id)!, after: { ...model.entity(id)!, geom: edited } }],
      },
    });
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    const { dialog } = bus.prompt as DialogPrompt;
    const shown = dialog.type === 'attedit' ? dialog.attributes : [];
    expect(shown.map((a) => a.tag)).toEqual(['NO', 'NAME']);
  });
});

describe('the MTEXT editor on a multileader shows its frame and mask', () => {
  it('passes the text frame a landing gap out and the mask with its colour and border', async () => {
    const { bus, id, model, geom } = await withLeader();
    const g = geom();
    const framed: MultiLeaderGeometry = {
      ...g,
      textFrame: true,
      text: { ...g.text!, mask: { color: { kind: 'aci', index: 2 }, scale: 2 } },
    };
    const e = model.entity(id)!;
    model.apply({ entities: { updated: [{ before: e, after: { ...e, geom: framed } }] } });
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    const editor = (bus.prompt as { editor: { background?: unknown } }).editor;
    // The frame is the landing gap (0.09) out, the mask (2 − 1) × 0.18 out.
    expect(editor.background).toEqual({
      mask: { color: { kind: 'aci', index: 2 }, pad: 0.18 },
      frame: { pad: 0.09 },
    });
  });

  it('passes a mask in the drawing window colour without a colour, and nothing without either', async () => {
    const { bus, id, model, geom } = await withLeader();
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    expect((bus.prompt as { editor: { background?: unknown } }).editor.background).toBeUndefined();
    await bus.cancel();
    const g = geom();
    const masked: MultiLeaderGeometry = { ...g, text: { ...g.text!, mask: { scale: 1.5 } } };
    const e = model.entity(id)!;
    model.apply({ entities: { updated: [{ before: e, after: { ...e, geom: masked } }] } });
    await bus.submit('TEXTEDIT');
    await bus.answer({ kind: 'selection', ids: [id] });
    expect((bus.prompt as { editor: { background?: unknown } }).editor.background).toEqual({
      mask: { pad: 0.09 },
    });
  });
});
