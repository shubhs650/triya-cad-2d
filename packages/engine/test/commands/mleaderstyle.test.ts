// M4-04 part 2: MLEADERSTYLE's Multileader Style Manager on the PromptBus (AutoCAD 2024 Help,
// "Multileader Style Manager", "Create New Multileader Style Dialog Box", "Modify Multileader
// Style Dialog Box"): Set Current, New..., Modify..., Rename and Delete, each made at once with
// the manager opened again, all one undo step. New and Modify take the Leader Format, Leader
// Structure and Content tabs' settings; an AutoCAD arrowhead or built-in block the drawing lacks
// is added with the style; Modify gives the style's multileaders its new values where they do
// not override them.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  MLEADERSTYLE_FIELDS,
  MLEADER_OVERRIDES,
  MLEADER_TEXT_OVERRIDES,
  PromptBus,
  builtinCommands,
  mleaderStyleProblem,
  mleaderStyleSettings,
  newMultiLeader,
  setMLeaderStyleField,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type HeaderValue,
  type MLeaderStyleAction,
  type MLeaderStyleRecord,
  type MLeaderStyleRequest,
  type MLeaderStyleSettings,
  type MTextGeometry,
  type MultiLeaderGeometry,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import {
  LAYER_0,
  blockRecord,
  circleGeom,
  entityInit,
  record,
  sampleInit,
} from '../model/fixtures';

const STANDARD_TEXT = 'A0';
const NARROW_TEXT = 'A1';
const STANDARD = 'A5';
const NOTES = 'A6';
const SPARE = 'A7';
const TAG = 'A8';
const PLAIN = 'A9';
const LEADER = 'B0';
const OVERRIDDEN = 'B1';
const CONTINUOUS = 'C0';
const DASHED = 'C1';

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
  ...standardMLeaderStyle(true, STANDARD_TEXT, CONTINUOUS),
};
const notes: MLeaderStyleRecord = {
  ...standard,
  handle: NOTES,
  name: 'Notes',
  blockScale: { x: 2, y: 3, z: 1 },
};
const spare: MLeaderStyleRecord = { ...standard, handle: SPARE, name: 'Spare' };

/** A Notes text multileader from (0, 0) to a landing at (10, 10) running right to (18, 10). */
function textLeader(overrideFlags = 0): MultiLeaderGeometry {
  const g = newMultiLeader({
    style: notes,
    settings: settingsOf(notes),
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
  return { ...g, overrideFlags };
}

interface Options {
  header?: [string, HeaderValue][];
  /** No multileader styles at all (a drawing from before R2007). */
  noStyles?: boolean;
  /** No text styles either (an R1 or R2.5 drawing). */
  noTextStyles?: boolean;
  /** Entries the drawing keeps and Triya does not map (M2-29). */
  kept?: string[];
  /** More multileaders. */
  more?: NonNullable<DocumentInit['entities']>;
}

function setup(o: Options = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    ...(o.kept && { meta: { ...base.meta, keptEntryNames: { mleaderStyles: o.kept } } }),
    header: new Map<string, HeaderValue>([
      ...(base.header ?? []),
      ['$TEXTSTYLE', 'Standard'],
      ...(o.header ?? [['CMLEADERSTYLE', 'Notes'] as [string, HeaderValue]]),
    ]),
    tables: {
      ...base.tables,
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        record(CONTINUOUS, 'Continuous'),
        record(DASHED, 'Dashed'),
      ] as never,
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        blockRecord(TAG, 'TAG'),
        blockRecord(PLAIN, 'PLAIN'),
      ],
      textStyles: o.noTextStyles
        ? []
        : [textStyle(STANDARD_TEXT, 'Standard'), textStyle(NARROW_TEXT, 'Narrow')],
      mleaderStyles: o.noStyles ? [] : [standard, notes, spare],
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
      { handle: PLAIN, name: 'PLAIN', basePoint: { x: 1, y: 1 } },
    ],
    entities: [
      entityInit('AA', circleGeom(0, 0, 1), { owner: TAG }),
      entityInit('AB', circleGeom(1, 1, 2), { owner: PLAIN }),
      ...(o.noStyles
        ? []
        : [
            entityInit(LEADER, textLeader()),
            // Its own line colour and text height (DXF 90's bits) stay through a Modify.
            entityInit(
              OVERRIDDEN,
              {
                ...textLeader(MLEADER_OVERRIDES.lineColor | MLEADER_TEXT_OVERRIDES.textHeight),
                lineColor: { kind: 'aci', index: 3 },
              },
              { layer: LAYER_0 },
            ),
            ...(o.more ?? []),
          ]),
    ],
  });
  const asked: ViewRequest[] = [];
  const widthOf = (t: MTextGeometry) => t.contents.length * 6 * (t.height / 4);
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    if (r.op === 'textWidths') return { ok: true, widths: r.texts.map(widthOf) };
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
  const request = () => {
    const p = bus.prompt;
    if (p?.kind !== 'dialog' || p.dialog.type !== 'mleaderstyle') throw new Error('no dialog');
    return p.dialog as MLeaderStyleRequest;
  };
  const act = (mleaderstyle: MLeaderStyleAction) =>
    bus.answer({ kind: 'dialog', action: 'apply', mleaderstyle });
  const styleNamed = (name: string) =>
    [...model.tables.mleaderStyles.values()].find((s) => s.name === name);
  const leader = (id: string) =>
    [...model.entities()].find((e) => e.handle === id)!.geom as MultiLeaderGeometry;
  const blockNamed = (name: string) => [...model.blocks.values()].find((b) => b.name === name);
  return { model, bus, log, asked, request, act, styleNamed, leader, blockNamed };
}

/** Standard's settings with `extra`. */
const settings = (extra: Partial<MLeaderStyleSettings> = {}): MLeaderStyleSettings => ({
  ...mleaderStyleSettings(standard),
  ...extra,
});

describe('MLEADERSTYLE: the Multileader Style Manager', () => {
  it('lists the styles with their settings, the current one and what is used', async () => {
    const s = setup();
    await s.bus.submit('MLS');
    expect(s.bus.command).toBe('MLEADERSTYLE');
    const r = s.request();
    expect(r.styles.map((x) => [x.name, x.used])).toEqual([
      ['Notes', true],
      ['Spare', false],
      ['Standard', false],
    ]);
    expect(r.current).toBe('Notes');
    expect(r.selected).toBe('Notes');
    expect(r.styles[2]!.settings).toMatchObject({
      leaderType: '1',
      lineColor: 'ByBlock',
      linetype: CONTINUOUS,
      lineweight: 'ByBlock',
      arrowhead: '',
      arrowheadSize: 4,
      breakSize: 3.75,
      maxPoints: 2,
      firstAngleOn: false,
      landing: true,
      landingDistance: 8,
      scaleToLayout: false,
      scale: 1,
      contentType: '2',
      textStyle: STANDARD_TEXT,
      textAngle: '1',
      textHeight: 4,
      attachment: '0',
      leftAttachment: '1',
      rightAttachment: '1',
      landingGap: 2,
      blockConnection: '0',
      blockScale: 1,
    });
    // ByBlock and ByLayer first, then by name; the drawing's blocks, then the built-ins.
    expect(r.lists.linetypes.map((l) => l.label).slice(-2)).toEqual(['Continuous', 'Dashed']);
    expect(r.lists.textStyles.map((l) => l.label)).toEqual(['Narrow', 'Standard']);
    expect(r.lists.arrowheads[0]).toEqual({ value: '', label: 'Closed filled' });
    expect(r.lists.arrowheads).toContainEqual({ value: '_DOT', label: 'Dot' });
    expect(r.lists.blocks).toEqual([
      { value: PLAIN, label: 'PLAIN' },
      { value: TAG, label: 'TAG' },
      { value: '_DetailCallout', label: 'Detail Callout' },
      { value: '_TagCircle', label: 'Circle' },
      { value: '_TagBox', label: 'Box' },
      { value: '_TagSlot', label: 'Slot' },
      { value: '_TagHexagon', label: 'Hexagon' },
      { value: '_TagTriangle', label: 'Triangle' },
    ]);
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.command).toBeUndefined();
  });

  it('makes a new style from every tab, adding the arrowhead and built-in block it names', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    const made = settings({
      leaderType: '2',
      lineColor: 'aci:1',
      linetype: DASHED,
      lineweight: '35',
      arrowhead: '_DOT',
      arrowheadSize: 2.5,
      breakSize: 1.5,
      maxPoints: 3,
      firstAngleOn: true,
      firstAngle: 45,
      secondAngleOn: true,
      secondAngle: 90,
      landing: false,
      landingDistance: 5,
      scaleToLayout: false,
      scale: 2,
      contentType: '1',
      defaultText: 'NOTE',
      textStyle: NARROW_TEXT,
      textAngle: '2',
      textColor: 'rgb:10,20,30',
      textHeight: 3,
      alwaysLeft: true,
      frame: true,
      attachment: '1',
      leftAttachment: '8',
      rightAttachment: '5',
      landingGap: 1,
      topAttachment: '10',
      bottomAttachment: '10',
      block: '_TagCircle',
      blockConnection: '1',
      blockColor: 'aci:5',
      blockScale: 1.5,
    });
    await s.act({ op: 'new', name: 'Tags', from: 'Standard', settings: made });
    expect(s.request().note).toBeUndefined();
    expect(s.request().selected).toBe('Tags');
    const tags = s.styleNamed('Tags')!;
    const dot = s.blockNamed('_DOT')!;
    const circle = s.blockNamed('_TagCircle')!;
    expect(dot).toBeDefined();
    expect(circle).toBeDefined();
    expect(tags).toMatchObject({
      pathType: 2,
      lineColor: { kind: 'aci', index: 1 },
      linetype: DASHED,
      lineweight: 35,
      arrowhead: dot.handle,
      arrowheadSize: 2.5,
      breakGap: 1.5,
      maxLeaderPoints: 3,
      landing: false,
      dogleg: false,
      doglegLength: 5,
      scale: 2,
      contentType: 1,
      defaultText: 'NOTE',
      textStyle: NARROW_TEXT,
      textAngleType: 2,
      textColor: { kind: 'rgb', r: 10, g: 20, b: 30 },
      textHeight: 3,
      textAlignAlwaysLeft: true,
      textFrame: true,
      textAttachmentDirection: 1,
      textLeftAttachment: 8,
      textRightAttachment: 5,
      landingGap: 1,
      textTopAttachment: 10,
      textBottomAttachment: 10,
      block: circle.handle,
      blockConnection: 1,
      blockColor: { kind: 'aci', index: 5 },
      blockScale: { x: 1.5, y: 1.5, z: 1.5 },
      blockScaleOn: true,
      annotative: false,
    });
    expect(tags.firstSegmentAngle).toBeCloseTo(Math.PI / 4, 12);
    expect(tags.secondSegmentAngle).toBeCloseTo(Math.PI / 2, 12);
    // The manager reads it back as it was set; the new style is not made current.
    expect(s.request().styles.find((x) => x.name === 'Tags')!.settings).toEqual({
      ...made,
      arrowhead: dot.handle,
      block: circle.handle,
    });
    expect(s.request().current).toBe('Notes');
    // The Source block list now has the drawing's _TagCircle and offers no second one.
    expect(s.request().lists.blocks.filter((b) => b.label === 'Circle')).toEqual([]);
    expect(s.request().lists.blocks).toContainEqual({ value: circle.handle, label: '_TagCircle' });
  });

  it('refuses a new style with a name taken or invalid, or settings out of range', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'new', name: 'standard', settings: settings() });
    expect(s.request().note).toBe('A multileader style with this name already exists.');
    await s.act({ op: 'new', name: 'A<B', settings: settings() });
    expect(s.request().note).toBe('Invalid multileader style name.');
    await s.act({ op: 'new', name: 'Thin', settings: settings({ textHeight: 0 }) });
    expect(s.request().note).toBe('Text height must be greater than 0.');
    await s.act({ op: 'new', name: 'Thin', settings: settings({ contentType: '1', block: '' }) });
    expect(s.request().note).toBe('Choose a source block.');
    await s.act({ op: 'new', name: 'Thin', settings: settings({ linetype: 'FFFF' }) });
    expect(s.request().note).toBe('Linetype: not in the drawing.');
    expect(s.styleNamed('Thin')).toBeUndefined();
    expect(s.model.tables.mleaderStyles.size).toBe(3);
  });

  it('modifies only what changed and restyles its multileaders where they do not override', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    const was = s.request().styles.find((x) => x.name === 'Notes')!.settings;
    // A non-uniform block scale shows its X; left alone, it stays as it was.
    expect(was.blockScale).toBe(2);
    await s.act({
      op: 'modify',
      name: 'Notes',
      settings: { ...was, lineColor: 'aci:1', textHeight: 6, arrowhead: '_DOT' },
    });
    expect(s.request().note).toBeUndefined();
    const notesNow = s.styleNamed('Notes')!;
    expect(notesNow).toMatchObject({
      lineColor: { kind: 'aci', index: 1 },
      textHeight: 6,
      arrowhead: s.blockNamed('_DOT')!.handle,
      blockScale: { x: 2, y: 3, z: 1 },
    });
    // The plain multileader takes the new colour, arrowhead and text height (its left side stays
    // on the landing, so no measuring is needed).
    expect(s.leader(LEADER)).toMatchObject({
      lineColor: { kind: 'aci', index: 1 },
      arrowhead: s.blockNamed('_DOT')!.handle,
      text: { height: 6 },
    });
    expect(s.asked.some((r) => r.op === 'textWidths')).toBe(false);
    // The one with its own colour and text height keeps them.
    expect(s.leader(OVERRIDDEN)).toMatchObject({
      lineColor: { kind: 'aci', index: 3 },
      text: { height: 4 },
      arrowhead: s.blockNamed('_DOT')!.handle,
    });
    // Modify with nothing changed changes nothing.
    const before = s.model.tables.mleaderStyles.get(NOTES);
    await s.act({ op: 'modify', name: 'Notes', settings: s.request().styles[0]!.settings });
    expect(s.model.tables.mleaderStyles.get(NOTES)).toBe(before);
  });

  it('makes a style current through CMLEADERSTYLE, and says so where the drawing keeps none', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'current', name: 'spare' });
    expect(s.model.header.get('CMLEADERSTYLE')).toBe('Spare');
    expect(s.request().current).toBe('Spare');

    const t = setup({ header: [] });
    await t.bus.submit('MLEADERSTYLE');
    // Without the variable, Standard is current, by name.
    expect(t.request().current).toBe('Standard');
    await t.act({ op: 'current', name: 'Spare' });
    expect(t.request().note).toBe(
      'This drawing keeps no CMLEADERSTYLE variable, so another style cannot be made current.',
    );
    expect(t.model.header.get('CMLEADERSTYLE')).toBeUndefined();
  });

  it('renames a style, CMLEADERSTYLE following, but not Standard or to a taken name', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'rename', name: 'Notes', to: 'Callouts' });
    expect(s.styleNamed('Callouts')?.handle).toBe(NOTES);
    expect(s.model.header.get('CMLEADERSTYLE')).toBe('Callouts');
    expect(s.request().selected).toBe('Callouts');
    await s.act({ op: 'rename', name: 'Standard', to: 'Plain' });
    expect(s.request().note).toBe('Standard cannot be renamed.');
    await s.act({ op: 'rename', name: 'Spare', to: 'CALLOUTS' });
    expect(s.request().note).toBe('A multileader style with this name already exists.');
    expect(s.styleNamed('Spare')).toBeDefined();
  });

  it('deletes a spare style, but not Standard, the current one or one in use', async () => {
    const s = setup({ header: [['CMLEADERSTYLE', 'Spare']] });
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'delete', name: 'Standard' });
    expect(s.request().note).toBe('Standard cannot be deleted.');
    await s.act({ op: 'delete', name: 'Spare' });
    expect(s.request().note).toBe('The current multileader style cannot be deleted.');
    await s.act({ op: 'delete', name: 'Notes' });
    expect(s.request().note).toBe('Style in use, can’t be deleted.');
    await s.act({ op: 'current', name: 'Standard' });
    await s.act({ op: 'delete', name: 'Spare' });
    expect(s.request().note).toBeUndefined();
    expect(s.styleNamed('Spare')).toBeUndefined();
    expect(s.request().selected).toBe('Standard');
  });

  it('is one undo step for everything it did', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'new', name: 'Tags', settings: settings({ arrowhead: '_DOT' }) });
    await s.act({ op: 'current', name: 'Spare' });
    await s.act({ op: 'modify', name: 'Notes', settings: settings({ textHeight: 7 }) });
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.styleNamed('Tags')).toBeUndefined();
    expect(s.blockNamed('_DOT')).toBeUndefined();
    expect(s.model.header.get('CMLEADERSTYLE')).toBe('Notes');
    expect(s.styleNamed('Notes')!.textHeight).toBe(4);
    expect(s.leader(LEADER).text!.height).toBe(4);
  });

  it('lists AutoCAD’s Standard in a drawing without styles, added when first used', async () => {
    const s = setup({ noStyles: true, header: [] });
    await s.bus.submit('MLEADERSTYLE');
    const r = s.request();
    expect(r.styles.map((x) => [x.name, x.unsaved])).toEqual([['Standard', true]]);
    expect(r.current).toBe('Standard');
    expect(s.model.tables.mleaderStyles.size).toBe(0);
    await s.act({
      op: 'modify',
      name: 'Standard',
      settings: { ...r.styles[0]!.settings, textHeight: 5 },
    });
    expect([...s.model.tables.mleaderStyles.values()].map((x) => [x.name, x.textHeight])).toEqual([
      ['Standard', 5],
    ]);
    expect(s.request().styles[0]!.unsaved).toBeUndefined();

    const t = setup({ noStyles: true, header: [] });
    await t.bus.submit('MLEADERSTYLE');
    await t.act({ op: 'new', name: 'Tags', from: 'Standard', settings: settings() });
    expect([...t.model.tables.mleaderStyles.values()].map((x) => x.name).sort()).toEqual([
      'Standard',
      'Tags',
    ]);
  });
});

describe('Modify Multileader Style fields', () => {
  it('has AutoCAD’s three tabs with their groups', () => {
    const groups = (tab: string) => [
      ...new Set(MLEADERSTYLE_FIELDS.filter((f) => f.tab === tab).map((f) => f.group)),
    ];
    expect(groups('format')).toEqual(['General', 'Arrowhead', 'Leader break']);
    expect(groups('structure')).toEqual(['Constraints', 'Landing settings', 'Scale']);
    expect(groups('content')).toEqual([
      'Multileader type',
      'Text options',
      'Leader connection',
      'Block options',
    ]);
  });

  it('sets typed numbers it takes, and keeps the value for those it refuses', () => {
    const s = settings();
    expect(setMLeaderStyleField(s, 'textHeight', '2.5').textHeight).toBe(2.5);
    expect(setMLeaderStyleField(s, 'textHeight', '0')).toBe(s);
    expect(setMLeaderStyleField(s, 'maxPoints', '1')).toBe(s);
    expect(setMLeaderStyleField(s, 'maxPoints', '4').maxPoints).toBe(4);
    expect(setMLeaderStyleField(s, 'scaleToLayout', 'true').scaleToLayout).toBe(true);
    expect(setMLeaderStyleField(s, 'frame', true).frame).toBe(true);
    expect(setMLeaderStyleField(s, 'leaderType', '2').leaderType).toBe('2');
    expect(mleaderStyleProblem(settings({ scaleToLayout: true, scale: 1 }))).toBeUndefined();
  });

  it('reads a style scaled to its layout as scale 0', () => {
    expect(mleaderStyleSettings({ ...standard, scale: 0 })).toMatchObject({
      scaleToLayout: true,
      scale: 1,
    });
  });
});

describe('MLEADERSTYLE: what the manager refuses or leaves alone', () => {
  it('ends on any answer but an action, and ignores an action it does not know', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'explode' } as never);
    expect(s.request().note).toBeUndefined();
    await s.bus.answer({ kind: 'dialog', action: 'apply' });
    expect(s.bus.command).toBeUndefined();
  });

  it('does nothing for a style it does not have', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    for (const a of [
      { op: 'current', name: 'Nope' },
      { op: 'modify', name: 'Nope', settings: settings() },
      { op: 'rename', name: 'Nope', to: 'Yes' },
      { op: 'delete', name: 'Nope' },
      { op: 'current', name: 7 },
    ] as MLeaderStyleAction[]) {
      await s.act(a);
      expect(s.request().note).toBeUndefined();
    }
    expect(s.model.tables.mleaderStyles.size).toBe(3);
    expect(s.bus.undo.state.undoable).toBe(0);
  });

  it('refuses settings it cannot take, and records the drawing lacks', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({
      op: 'modify',
      name: 'Notes',
      settings: { ...settings(), frame: 'yes' } as never,
    });
    expect(s.request().note).toBe('Frame text: invalid value.');
    await s.act({ op: 'new', name: 'X', settings: null as never });
    expect(s.request().note).toBe('Invalid input.');
    await s.act({ op: 'modify', name: 'Notes', settings: settings({ textStyle: 'FFFF' }) });
    expect(s.request().note).toBe('Text style: not in the drawing.');
    await s.act({ op: 'modify', name: 'Notes', settings: settings({ arrowhead: '_NOPE' }) });
    expect(s.request().note).toBe('Symbol: not an arrowhead.');
    await s.act({
      op: 'modify',
      name: 'Notes',
      settings: settings({ contentType: '1', block: '_TagStar' }),
    });
    expect(s.request().note).toBe('Source block: not a block the drawing has.');
    await s.act({ op: 'modify', name: 'Notes', settings: settings({ leaderType: '4' }) });
    expect(s.request().note).toBe('Type: invalid value.');
    expect(s.bus.undo.state.undoable).toBe(0);
  });

  it('names a block, an arrowhead and a linetype the drawing has by handle, none as the default', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({
      op: 'new',
      name: 'Plain',
      settings: settings({ contentType: '1', block: PLAIN, arrowhead: PLAIN, linetype: '' }),
    });
    expect(s.styleNamed('Plain')).toMatchObject({ block: PLAIN, arrowhead: PLAIN });
    // No linetype is the one MLEADER gives a new style (ByBlock, else ByLayer, else Continuous).
    expect(s.styleNamed('Plain')!.linetype).toBeDefined();
    // An AutoCAD arrowhead the drawing already has is not added again.
    await s.act({ op: 'new', name: 'Dots', settings: settings({ arrowhead: '_DOT' }) });
    const dot = s.blockNamed('_DOT')!.handle;
    await s.act({ op: 'new', name: 'Dots 2', settings: settings({ arrowhead: '_dot' }) });
    expect(s.styleNamed('Dots 2')!.arrowhead).toBe(dot);
    expect([...s.model.blocks.values()].filter((b) => b.name === '_DOT')).toHaveLength(1);
    // Closed filled: no arrowhead block.
    await s.act({
      op: 'modify',
      name: 'Dots',
      settings: { ...s.request().styles.find((x) => x.name === 'Dots')!.settings, arrowhead: '' },
    });
    expect(s.styleNamed('Dots')!.arrowhead).toBeUndefined();
  });

  it('refuses a name an unmapped entry keeps, and a rename to the same name does nothing', async () => {
    const s = setup({ kept: ['Legacy'] });
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'new', name: 'legacy', settings: settings() });
    expect(s.request().note).toBe('A multileader style with this name already exists.');
    await s.act({ op: 'rename', name: 'Spare', to: 'Spare' });
    expect(s.request().note).toBeUndefined();
    await s.act({ op: 'rename', name: 'Spare', to: 'A|B' });
    expect(s.request().note).toBe('Invalid multileader style name.');
    // A style that is not current keeps CMLEADERSTYLE as it was.
    await s.act({ op: 'rename', name: 'Spare', to: 'Extra' });
    expect(s.model.header.get('CMLEADERSTYLE')).toBe('Notes');
    expect(s.bus.undo.state.undoable).toBe(0);
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.undo.state.undoable).toBe(1);
  });

  it('makes the current style current again without an edit', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'current', name: 'Notes' });
    const t = setup({ header: [] });
    await t.bus.submit('MLEADERSTYLE');
    await t.act({ op: 'current', name: 'Standard' });
    expect(t.request().note).toBeUndefined();
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    await t.bus.answer({ kind: 'dialog', action: 'ok' });
    expect(s.bus.undo.state.undoable).toBe(0);
    expect(t.bus.undo.state.undoable).toBe(0);
  });

  it('adds the unsaved Standard when it is made current, and neither renames nor deletes it', async () => {
    const s = setup({ noStyles: true, header: [] });
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'rename', name: 'Standard', to: 'Other' });
    expect(s.request().note).toBe('Standard cannot be renamed.');
    await s.act({ op: 'delete', name: 'Standard' });
    expect(s.request().note).toBe('Standard cannot be deleted.');
    expect(s.model.tables.mleaderStyles.size).toBe(0);
    await s.act({ op: 'current', name: 'Standard' });
    expect([...s.model.tables.mleaderStyles.values()].map((x) => x.name)).toEqual(['Standard']);
    expect(s.request().styles[0]!.unsaved).toBeUndefined();
  });

  it('lists nothing in a drawing without text styles, and makes no style there', async () => {
    const s = setup({ noStyles: true, noTextStyles: true, header: [] });
    await s.bus.submit('MLEADERSTYLE');
    expect(s.request().styles).toEqual([]);
    expect(s.request().current).toBe('');
    expect(s.request().selected).toBe('');
    await s.act({ op: 'new', name: 'Tags', settings: settings({ textStyle: '' }) });
    expect(s.request().note).toBe(
      'The drawing has no text style, which a multileader style needs.',
    );
    expect(s.model.tables.mleaderStyles.size).toBe(0);
  });

  it('measures text that must move, and says which multileaders keep their look', async () => {
    // Text on the left of its landing, right-aligned on it: a new height moves its left side.
    const left = {
      ...textLeader(),
      branches: textLeader().branches.map((b) => ({ ...b, direction: { x: -1, y: 0 } })),
      text: { ...textLeader().text!, attachment: 3, position: { x: 0, y: 12 } },
    };
    const s = setup({
      more: [entityInit('B2', left), entityInit('B3', { ...textLeader(), annotative: true })],
    });
    await s.bus.submit('MLEADERSTYLE');
    await s.act({ op: 'modify', name: 'Notes', settings: settings({ textHeight: 8 }) });
    expect(s.asked.some((r) => r.op === 'textWidths')).toBe(true);
    expect(s.leader('B2').text!.height).toBe(8);
    expect(s.log).toContain(
      '1 multileader kept its look: annotative, or its text could not be measured.',
    );
  });
});

// M4-14: the Leader Structure tab's Maximum leader points check box (unchecked is DXF 90 = 0, no
// limit: ODA's OdDbMLeaderStyle::setMaxLeaderSegmentsPoints, "a value of 0 ... indicates no
// limit") and the Content tab's Extend leader to text (the style's DXF 298 and the multileader's
// DXF 295, both added in R2013).
describe('MLEADERSTYLE: Maximum leader points unchecked and Extend leader to text (M4-14)', () => {
  it('shows a style without a point limit unchecked, and Extend leader to text', () => {
    expect(mleaderStyleSettings({ ...standard, maxLeaderPoints: 0 })).toMatchObject({
      maxPointsOn: false,
      maxPoints: 2,
      extendToText: false,
    });
    expect(
      mleaderStyleSettings({ ...standard, maxLeaderPoints: 5, extendLeaderToText: true }),
    ).toMatchObject({ maxPointsOn: true, maxPoints: 5, extendToText: true });
    const box = MLEADERSTYLE_FIELDS.find((f) => f.key === 'maxPointsOn')!;
    expect(box).toMatchObject({ tab: 'structure', kind: 'check', label: 'Maximum leader points' });
    const points = MLEADERSTYLE_FIELDS.find((f) => f.key === 'maxPoints')!;
    expect(points.checkedBy).toBe('maxPointsOn');
    expect(points.enabled!(settings({ maxPointsOn: false }))).toBe(false);
    expect(points.enabled!(settings({ maxPointsOn: true }))).toBe(true);
    const extend = MLEADERSTYLE_FIELDS.find((f) => f.key === 'extendToText')!;
    expect(extend).toMatchObject({
      tab: 'content',
      group: 'Leader connection',
      kind: 'check',
      label: 'Extend leader to text',
    });
    // Horizontal attachment only, as AutoCAD's dialog shows it.
    expect(extend.shown!(settings({ contentType: '2', attachment: '0' }))).toBe(true);
    expect(extend.shown!(settings({ contentType: '2', attachment: '1' }))).toBe(false);
    expect(extend.shown!(settings({ contentType: '1' }))).toBe(false);
    // The fields sit after the landing gap in the Leader connection group.
    const order = MLEADERSTYLE_FIELDS.filter((f) => f.group === 'Leader connection').map(
      (f) => f.key,
    );
    expect(order.indexOf('extendToText')).toBe(order.indexOf('landingGap') + 1);
    expect(mleaderStyleProblem(settings({ maxPointsOn: false, extendToText: true }))).toBe(
      undefined,
    );
  });

  it('saves the style with no point limit and extending its leaders, and MLEADER follows it', async () => {
    const s = setup();
    await s.bus.submit('MLEADERSTYLE');
    const was = s.request().styles.find((x) => x.name === 'Notes')!.settings;
    expect(was).toMatchObject({ maxPointsOn: true, extendToText: false });
    await s.act({
      op: 'modify',
      name: 'Notes',
      settings: { ...was, maxPointsOn: false, extendToText: true },
    });
    expect(s.request().note).toBeUndefined();
    expect(s.styleNamed('Notes')).toMatchObject({ maxLeaderPoints: 0, extendLeaderToText: true });
    // The style's multileaders take it, but not one whose own value DXF 90's bit 30 keeps.
    expect(s.leader(LEADER).extendLeaderToText).toBe(true);
    await s.act({ op: 'new', name: 'Limited', from: 'Notes', settings: { ...was, maxPoints: 4 } });
    expect(s.styleNamed('Limited')).toMatchObject({
      maxLeaderPoints: 4,
      extendLeaderToText: false,
    });
    await s.bus.answer({ kind: 'dialog', action: 'ok' });
    // MLEADER with Notes current asks for points until Enter, past the old limit of two.
    await s.bus.submit('MLEADER');
    for (const p of [
      { x: 100, y: 0 },
      { x: 110, y: 5 },
      { x: 120, y: 0 },
      { x: 130, y: 5 },
      { x: 140, y: 5 },
    ]) {
      expect(s.bus.prompt?.kind).toBe('point');
      await s.bus.answer({ kind: 'point', point: p });
    }
    expect(s.bus.prompt?.kind).toBe('point');
    await s.bus.submit('');
    expect(s.bus.prompt?.kind).not.toBe('point');
  });

  it('keeps a multileader’s own Extend leader to text when its override bit is set', async () => {
    const own: MultiLeaderGeometry = {
      ...textLeader(MLEADER_OVERRIDES.extendLeaderToText),
    };
    const s = setup({ more: [entityInit('B2', own)] });
    await s.bus.submit('MLEADERSTYLE');
    const was = s.request().styles.find((x) => x.name === 'Notes')!.settings;
    await s.act({ op: 'modify', name: 'Notes', settings: { ...was, extendToText: true } });
    expect(s.leader(LEADER).extendLeaderToText).toBe(true);
    expect(s.leader('B2').extendLeaderToText).toBeUndefined();
    await s.act({ op: 'modify', name: 'Notes', settings: { ...was, extendToText: false } });
    expect(s.leader(LEADER).extendLeaderToText).toBeUndefined();
  });

  it('gives a new multileader its style’s Extend leader to text', () => {
    const g = newMultiLeader({
      style: { ...notes, extendLeaderToText: true },
      settings: settingsOf({ ...notes, maxLeaderPoints: 0 }),
      vertices: [{ x: 0, y: 0 }],
      landing: { connection: { x: 10, y: 10 }, direction: { x: 1, y: 0 }, end: { x: 18, y: 10 } },
      scale: 1,
      text: {
        content: 'A',
        style: STANDARD_TEXT,
        position: { x: 20, y: 12 },
        attachment: 1,
        width: 0,
      },
    });
    expect(g.extendLeaderToText).toBe(true);
    expect(g.overrideFlags & MLEADER_OVERRIDES.extendLeaderToText).toBe(0);
    expect(textLeader().extendLeaderToText).toBeUndefined();
    expect(settingsOf({ ...notes, maxLeaderPoints: 0 }).maxPoints).toBe(0);
    expect(settingsOf({ ...notes, maxLeaderPoints: 1 }).maxPoints).toBe(2);
  });
});
