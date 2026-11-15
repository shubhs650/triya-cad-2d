// M2-35 part 28: a multileader's Multileader style row (ActiveX AcadMLeader.StyleName) chosen in
// the Properties palette. The new style's values are re-applied wherever the multileader does not
// override them (DXF 90's bits keep the multileader's own), drawn at its overall scale, and the
// content stays where it is: the text's side facing the landing, the block's facing side, each
// landing keeping its place against the content.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  MLEADER_OVERRIDES,
  PromptBus,
  builtinCommands,
  newMultiLeader,
  propertySheet,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type MLeaderStyleRecord,
  type MTextGeometry,
  type MultiLeaderGeometry,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { blockRecord, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const STANDARD_TEXT = '30';
const NARROW_TEXT = '31';
const STANDARD = '35';
const NOTES = '36';
const TAG = '37';
const PLAIN = '3F';
const SCALED = '42';
const BLOCKS = '43';

const textStyle = (handle: string, name: string): TextStyleRecord => ({
  handle,
  name,
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

/** AutoCAD's metric Standard style: gap 2, landing 8, arrowhead 4, text 4. */
const standard: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(true, STANDARD_TEXT),
};

/** A style differing in every value a text multileader takes from it. */
const notes: MLeaderStyleRecord = {
  ...standard,
  handle: NOTES,
  name: 'Notes',
  pathType: 2,
  lineColor: { kind: 'aci', index: 5 },
  lineweight: 35,
  arrowheadSize: 3,
  landingGap: 1,
  doglegLength: 6,
  textStyle: NARROW_TEXT,
  textColor: { kind: 'aci', index: 1 },
  textHeight: 5,
  textFrame: true,
  textAngleType: 2,
};

/** Standard drawn at twice the size. */
const scaledStyle: MLeaderStyleRecord = { ...standard, handle: SCALED, name: 'Scaled', scale: 2 };

/** A block style: PLAIN, red, at 2. */
const blocks: MLeaderStyleRecord = {
  ...standard,
  handle: BLOCKS,
  name: 'Blocks',
  contentType: 1,
  block: PLAIN,
  blockColor: { kind: 'aci', index: 1 },
  blockScale: { x: 2, y: 2, z: 2 },
};

/**
 * A Standard text multileader from (0, 0) to a landing at (10, 10) running right to (18, 10);
 * the text starts a gap beyond it, at (20, 12) by its top left (its top line's middle on the
 * landing).
 */
function textLeader(over: Partial<MultiLeaderGeometry['text'] & object> = {}): MultiLeaderGeometry {
  const g = newMultiLeader({
    style: standard,
    settings: settingsOf(standard),
    vertices: [{ x: 0, y: 0 }],
    landing: { connection: { x: 10, y: 10 }, direction: { x: 1, y: 0 }, end: { x: 18, y: 10 } },
    scale: 1,
    text: {
      content: 'VALVE',
      style: STANDARD_TEXT,
      position: { x: 20, y: 12 },
      attachment: 1,
      width: 0,
    },
  });
  return { ...g, text: { ...g.text!, ...over } };
}

/** A TAG multileader on the same landing, its circle of radius 1 touching the landing's end. */
function blockLeader(): MultiLeaderGeometry {
  const g = newMultiLeader({
    style: { ...standard, contentType: 1, block: TAG },
    settings: settingsOf({ ...standard, contentType: 1, block: TAG }),
    vertices: [{ x: 0, y: 0 }],
    landing: { connection: { x: 10, y: 10 }, direction: { x: 1, y: 0 }, end: { x: 18, y: 10 } },
    scale: 1,
    block: { block: TAG, position: { x: 19, y: 10 }, attributes: [] },
  });
  return { ...g, style: STANDARD, overrideFlags: 0 };
}

interface Options {
  /** The canvas cannot measure text. */
  unmeasured?: boolean;
  /** More multileader styles. */
  styles?: readonly MLeaderStyleRecord[];
}

function setup(entities: NonNullable<DocumentInit['entities']>, o: Options = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        blockRecord(TAG, 'TAG'),
        blockRecord(PLAIN, 'PLAIN'),
      ],
      textStyles: [textStyle(STANDARD_TEXT, 'Standard'), textStyle(NARROW_TEXT, 'Narrow')],
      mleaderStyles: [standard, notes, scaledStyle, blocks, ...(o.styles ?? [])],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      { handle: PLAIN, name: 'PLAIN', basePoint: { x: 1, y: 1 } },
    ],
    entities: [
      entityInit('39', circleGeom(0, 0, 1), { owner: TAG }),
      // Radius 2 about the base point (1, 1): extents −2…2 from it.
      entityInit('3D', circleGeom(1, 1, 2), { owner: PLAIN }),
      ...entities,
    ],
  });
  const asked: ViewRequest[] = [];
  // 6 per character at height 4, half that in Narrow.
  const widthOf = (t: MTextGeometry) =>
    t.contents.length * 6 * (t.height / 4) * (t.style === NARROW_TEXT ? 0.5 : 1);
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    if (r.op === 'textWidths') {
      return { ok: true, widths: r.texts.map((t) => (o.unmeasured ? null : widthOf(t))) };
    }
    return { ok: true };
  };
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: (r) => Promise.resolve(answer(r)) },
  });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const leader = (h: string) => byHandle(h).geom as MultiLeaderGeometry;
  const set = async (key: string, value: string) => {
    await bus.setProperty({ key, value }, 'MULTILEADER');
  };
  return { model, bus, log, asked, ids, leader, set };
}

const bit = (g: MultiLeaderGeometry, n: number): boolean => (g.overrideFlags & (1 << n)) !== 0;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: { x: number; y: number }) => [r6(p.x), r6(p.y)];

describe('a multileader’s Multileader style row (M2-35 part 28)', () => {
  it('is a choice of the drawing’s styles', () => {
    const s = setup([entityInit('60', textLeader())]);
    const misc = propertySheet(s.model, s.ids('60')).sections.find((x) => x.title === 'Misc')!;
    const row = misc.rows.find((r) => r.key === 'mleaderStyle')!;
    expect(row.readOnly).toBeUndefined();
    expect(row.value).toBe(STANDARD);
    expect(row.options!.map((x) => x.label)).toEqual(['Blocks', 'Notes', 'Scaled', 'Standard']);
  });

  it('gives a text multileader every value of the new style, the text kept on its landing', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    const was = s.leader('60');
    await s.set('mleaderStyle', NOTES);
    const g = s.leader('60');
    expect(g.style).toBe(NOTES);
    // Nothing overrides the new style.
    expect(g.overrideFlags).toBe(0);
    expect(g).toMatchObject({
      pathType: 2,
      lineColor: { kind: 'aci', index: 5 },
      lineweight: 35,
      arrowheadSize: 3,
      drawnArrowheadSize: 3,
      doglegLength: 6,
      landingGap: 1,
      textFrame: true,
      textAngleType: 2,
    });
    expect(g.text).toMatchObject({
      style: NARROW_TEXT,
      color: { kind: 'aci', index: 1 },
      height: 5,
    });
    // The text's left edge stays at 20; the middle of its top line stays on the landing, so a
    // height of 5 puts its top 2.5 above it.
    expect(pt(g.text!.position)).toEqual([20, 12.5]);
    // The landing ends a gap of 1 from the text, at (19, 10), and is 6 long: from (13, 10).
    expect(g.branches[0]!.doglegLength).toBe(6);
    expect(pt(g.branches[0]!.connection)).toEqual([13, 10]);
    expect(g.branches[0]!.lines).toEqual(was.branches[0]!.lines);
    // The text's left edge is its insertion point: nothing to measure.
    expect(s.asked.filter((r) => r.op === 'textWidths')).toHaveLength(0);
    await s.bus.submit('U');
    expect(s.leader('60')).toEqual(was);
  });

  it('keeps what the multileader overrides, and its flags', async () => {
    const green = { kind: 'aci', index: 3 } as const;
    const own = textLeader({ height: 7 });
    const s = setup([
      entityInit('60', {
        ...own,
        lineColor: green,
        overrideFlags: MLEADER_OVERRIDES.lineColor | (1 << 16),
      }),
    ]);
    await s.bus.selectAll();
    await s.set('mleaderStyle', NOTES);
    const g = s.leader('60');
    expect(g.style).toBe(NOTES);
    expect(g.lineColor).toEqual(green);
    expect(g.text!.height).toBe(7);
    expect(g.overrideFlags).toBe(MLEADER_OVERRIDES.lineColor | (1 << 16));
    // What it does not override is the new style's.
    expect(g.lineweight).toBe(35);
    expect(g.text!.style).toBe(NARROW_TEXT);
  });

  it('draws the style at its overall scale, as the Overall scale row grows it', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('mleaderStyle', SCALED);
    const t = setup([entityInit('60', textLeader())]);
    await t.bus.selectAll();
    await t.set('overallScale', '2');
    const restyled = s.leader('60');
    const rescaled = t.leader('60');
    expect(restyled.scale).toBe(2);
    expect(bit(restyled, 24)).toBe(false);
    expect(bit(rescaled, 24)).toBe(true);
    expect({ ...restyled, style: STANDARD, overrideFlags: 0 }).toEqual({
      ...rescaled,
      overrideFlags: 0,
    });
    expect(restyled.text!.height).toBe(8);
  });

  it('measures a text whose insertion point is off its facing side', async () => {
    // Top center: the text's middle is 15 right of its left edge at 20.
    const s = setup([
      entityInit('60', {
        ...textLeader({ attachment: 2, position: { x: 35, y: 12 } }),
        textAlignment: 1,
      }),
    ]);
    await s.bus.selectAll();
    await s.set('mleaderStyle', NOTES);
    // Notes aligns text left: the text's left edge stays at 20 and becomes its insertion point.
    let g = s.leader('60');
    expect(g.text!.attachment).toBe(1);
    expect(g.textAlignment).toBe(0);
    expect(pt(g.text!.position)).toEqual([20, 12.5]);
    expect(s.asked.filter((r) => r.op === 'textWidths')).toHaveLength(1);
    // The alignment overridden keeps the middle; Narrow at 5 is 18.75 wide, so it moves to 29.375.
    const t = setup([
      entityInit('60', {
        ...textLeader({ attachment: 2, position: { x: 35, y: 12 } }),
        textAlignment: 1,
        overrideFlags: 1 << 14,
      }),
    ]);
    await t.bus.selectAll();
    await t.set('mleaderStyle', NOTES);
    g = t.leader('60');
    expect(g.text!.attachment).toBe(2);
    expect(pt(g.text!.position)).toEqual([29.375, 12.5]);
  });

  it('refuses a text it cannot measure, and an annotative multileader', async () => {
    const s = setup(
      [entityInit('60', { ...textLeader({ attachment: 2 }), overrideFlags: 1 << 14 })],
      { unmeasured: true },
    );
    await s.bus.selectAll();
    const was = s.leader('60');
    await s.set('mleaderStyle', NOTES);
    expect(s.log.at(-1)).toMatch(/1 object was not changed: its text cannot be measured/);
    expect(s.leader('60')).toEqual(was);
    const a = setup([entityInit('60', { ...textLeader(), annotative: true })]);
    await a.bus.selectAll();
    await a.set('mleaderStyle', NOTES);
    expect(a.log.at(-1)).toMatch(/1 object was not changed: annotative/);
    expect(a.leader('60').style).toBe(STANDARD);
  });

  it('keeps and flags what it cannot re-apply in place', async () => {
    // A text multileader stays text in a block style.
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('mleaderStyle', BLOCKS);
    let g = s.leader('60');
    expect(g.style).toBe(BLOCKS);
    expect(g.contentType).toBe(2);
    expect(g.text?.content).toBe('VALVE');
    expect(g.overrideFlags).toBe(MLEADER_OVERRIDES.contentType);
    // Vertical attachment stays horizontal, and an attachment by another row of the text's
    // lines (middle of text) keeps the middle of the top line.
    const vertical: MLeaderStyleRecord = {
      ...notes,
      handle: '44',
      name: 'Vertical',
      textAttachmentDirection: 1,
      textLeftAttachment: 2,
      textRightAttachment: 2,
    };
    const v = setup([entityInit('60', textLeader())], { styles: [vertical] });
    await v.bus.selectAll();
    await v.set('mleaderStyle', '44');
    g = v.leader('60');
    expect(g.style).toBe('44');
    expect(g).toMatchObject({
      textAttachmentDirection: 0,
      textLeftAttachment: 1,
      textRightAttachment: 1,
    });
    expect(g.overrideFlags).toBe((1 << 12) | (1 << 25) | (1 << 27));
    expect(pt(g.text!.position)).toEqual([20, 12.5]);
  });

  it('gives block content the style’s block, colour and scale, its facing side kept', async () => {
    const s = setup([entityInit('60', blockLeader())]);
    await s.bus.selectAll();
    await s.set('mleaderStyle', BLOCKS);
    const g = s.leader('60');
    expect(g.style).toBe(BLOCKS);
    expect(g.overrideFlags).toBe(0);
    expect(g.block).toMatchObject({
      block: PLAIN,
      color: { kind: 'aci', index: 1 },
      scale: { x: 2, y: 2, z: 2 },
    });
    // PLAIN at 2 reaches 4 left of its base point: the left edge stays at 18, the middle at 10.
    expect(pt(g.block!.position)).toEqual([22, 10]);
    expect(g.branches[0]!.connection).toEqual(blockLeader().branches[0]!.connection);
  });

  it('changes nothing for the style it has, and refuses one the drawing lacks', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    const was = s.leader('60');
    await s.set('mleaderStyle', STANDARD);
    expect(s.leader('60')).toEqual(was);
    await s.set('mleaderStyle', 'FF');
    expect(s.log.at(-1)).toBe('Invalid input.');
    expect(s.leader('60')).toEqual(was);
  });
});
