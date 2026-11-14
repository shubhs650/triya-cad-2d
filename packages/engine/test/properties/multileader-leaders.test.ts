// M2-35 part 12: a multileader's Leaders rows in the Properties palette (AutoCAD 2024's
// "Properties Palette — Multileader": Leader type, Leader color, Leader linetype, Leader
// lineweight, Arrowhead, Arrowhead size, Horz landing and Landing distance). Each edit sets the
// MULTILEADER's own value and flags it in DXF 90 as overriding its MLEADERSTYLE (ezdxf's and the
// ODA specification's bits); the text and the leader lines stay where they are.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  multiLeaderParts,
  newMultiLeader,
  propertySheet,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type PropertyRow,
  type PropertySheet,
} from '../../src/index';
import { blockRecord, entityInit, linetype, sampleInit } from '../model/fixtures';

const STANDARD_TEXT = '30';
const STANDARD = '35';
const DASHED = '15';
const BYBLOCK_LT = '16';
const BYLAYER_LT = '17';
const DOT = '50';
const OPEN30 = '51';
const TITLE = '52';

const style: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(true, STANDARD_TEXT),
};

/** A text multileader from (0, 0) to a landing at (10, 10) running right to (18, 10). */
function textLeader(over: Partial<MultiLeaderGeometry> = {}): MultiLeaderGeometry {
  const g = newMultiLeader({
    style,
    settings: settingsOf(style),
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
  return { ...g, ...over };
}

function blockLeader(): MultiLeaderGeometry {
  const { text: _t, ...g } = textLeader();
  return {
    ...g,
    contentType: 1,
    block: {
      position: { x: 20, y: 10 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      color: { kind: 'byBlock' },
    },
  };
}

function setup(entities: NonNullable<DocumentInit['entities']>, styles = [style]) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      linetypes: [
        ...(base.tables?.linetypes ?? []),
        linetype(DASHED, 'DASHED'),
        linetype(BYBLOCK_LT, 'ByBlock'),
        linetype(BYLAYER_LT, 'ByLayer'),
      ],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        blockRecord(DOT, '_DOT'),
        blockRecord(OPEN30, '_Open30'),
        blockRecord(TITLE, 'TITLE'),
      ],
      textStyles: [
        {
          handle: STANDARD_TEXT,
          name: 'Standard',
          font: 'txt',
          height: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          lastHeight: 2.5,
          generation: 0,
          trueTypeFlags: 0,
        },
      ],
      mleaderStyles: styles,
    },
    blocks: [
      ...(base.blocks ?? []),
      { handle: DOT, name: '_DOT', basePoint: { x: 0, y: 0 } },
      { handle: OPEN30, name: '_Open30', basePoint: { x: 0, y: 0 } },
      { handle: TITLE, name: 'TITLE', basePoint: { x: 0, y: 0 } },
    ],
    entities,
  });
  const bus = new PromptBus({
    model,
    registry: builtinCommands(),
    view: { request: () => Promise.resolve({ ok: true }) },
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
  return { model, bus, log, ids, leader, set };
}

const rows = (sheet: PropertySheet): PropertyRow[] => sheet.sections.flatMap((s) => s.rows);
const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined =>
  rows(sheet).find((x) => x.label === label);
const bit = (g: MultiLeaderGeometry, n: number): boolean => (g.overrideFlags & (1 << n)) !== 0;

describe('a multileader’s Leaders rows (M2-35 part 12)', () => {
  it('shows the Leaders section before Text, for text and block content alike', () => {
    const s = setup([entityInit('60', textLeader()), entityInit('62', blockLeader())]);
    const one = propertySheet(s.model, s.ids('60'));
    expect(one.sections.map((x) => x.title)).toEqual(['General', 'Leaders', 'Text']);
    const leaders = one.sections.find((x) => x.title === 'Leaders')!;
    expect(leaders.rows.map((r) => r.label)).toEqual([
      'Leader type',
      'Leader color',
      'Leader linetype',
      'Leader lineweight',
      'Arrowhead',
      'Arrowhead size',
      'Horz landing',
      'Landing distance',
    ]);
    expect(rowOf(one, 'Leader type')).toMatchObject({ kind: 'choice', value: '1' });
    expect(rowOf(one, 'Leader type')?.options?.map((o) => o.label)).toEqual([
      'Straight',
      'Spline',
      'None',
    ]);
    expect(rowOf(one, 'Leader color')).toMatchObject({
      kind: 'choice',
      value: 'ByBlock',
      colorDialog: 'true',
    });
    // The style names no linetype: the leader draws ByBlock, the record that says so.
    expect(rowOf(one, 'Leader linetype')).toMatchObject({ kind: 'choice', value: BYBLOCK_LT });
    expect(rowOf(one, 'Leader linetype')?.options?.map((o) => o.label)).toEqual([
      'ByLayer',
      'ByBlock',
      'Continuous',
      'DASHED',
    ]);
    expect(rowOf(one, 'Leader lineweight')).toMatchObject({ kind: 'choice', value: 'ByBlock' });
    expect(rowOf(one, 'Arrowhead')).toMatchObject({ kind: 'choice', value: '' });
    // Closed filled, then the drawing's arrowhead blocks by AutoCAD's names; not other blocks.
    expect(rowOf(one, 'Arrowhead')?.options).toEqual([
      { value: '', label: 'Closed filled' },
      { value: DOT, label: 'Dot' },
      { value: OPEN30, label: 'Open 30' },
    ]);
    expect(rowOf(one, 'Arrowhead size')).toMatchObject({ kind: 'distance', value: 4 });
    expect(rowOf(one, 'Horz landing')).toMatchObject({ kind: 'choice', value: 'yes' });
    expect(rowOf(one, 'Landing distance')).toMatchObject({ kind: 'distance', value: 8 });
    const block = propertySheet(s.model, s.ids('62'));
    // M2-35 part 15: a block's own rows in Text's place.
    expect(block.sections.map((x) => x.title)).toEqual(['General', 'Leaders', 'Block']);
  });

  it('shows *VARIES* where multileaders differ', () => {
    const s = setup([
      entityInit('60', textLeader()),
      entityInit(
        '61',
        textLeader({ pathType: 2, arrowheadSize: 3, lineColor: { kind: 'aci', index: 1 } }),
      ),
    ]);
    const sheet = propertySheet(s.model, s.ids('60', '61'));
    for (const label of ['Leader type', 'Leader color', 'Arrowhead size'])
      expect(rowOf(sheet, label)?.varies, label).toBe(true);
    expect(rowOf(sheet, 'Landing distance')?.value).toBe(8);
  });

  it('sets the leader type, flagged as overriding the style, one undo step', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('leaderType', '2');
    expect(s.leader('60').pathType).toBe(2);
    expect(bit(s.leader('60'), 0)).toBe(true);
    await s.set('leaderType', '0');
    expect(s.leader('60').pathType).toBe(0);
    await s.bus.submit('U');
    expect(s.leader('60').pathType).toBe(2);
    await s.bus.submit('U');
    expect(s.leader('60')).toEqual(textLeader());
    await s.set('leaderType', '3');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('sets the leader colour, linetype and lineweight', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('leaderColor', 'aci:1');
    expect(s.leader('60').lineColor).toEqual({ kind: 'aci', index: 1 });
    expect(bit(s.leader('60'), 1)).toBe(true);
    await s.set('leaderColor', 'rgb:10,20,30');
    expect(s.leader('60').lineColor).toEqual({ kind: 'rgb', r: 10, g: 20, b: 30 });
    await s.set('leaderLinetype', DASHED);
    expect(s.leader('60').linetype).toBe(DASHED);
    expect(bit(s.leader('60'), 2)).toBe(true);
    await s.set('leaderLineweight', '50');
    expect(s.leader('60').lineweight).toBe(50);
    expect(bit(s.leader('60'), 3)).toBe(true);
    const before = s.leader('60');
    for (const [key, value] of [
      ['leaderColor', 'teal'],
      ['leaderLinetype', 'FF'],
      ['leaderLineweight', '7'],
    ] as const) {
      await s.set(key, value);
      expect(s.log.at(-1), key).toBe('Invalid input.');
    }
    expect(s.leader('60')).toEqual(before);
    // The line draws in them.
    const line = multiLeaderParts(s.leader('60'), s.model).find(
      (p) => p.geom.kind === 'LWPOLYLINE',
    );
    expect(line).toMatchObject({
      color: { kind: 'rgb', r: 10, g: 20, b: 30 },
      linetype: DASHED,
      lineweight: 50,
    });
  });

  it('sets the arrowhead to one of the drawing’s arrowhead blocks or closed filled', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('arrowhead', DOT);
    expect(s.leader('60').arrowhead).toBe(DOT);
    expect(bit(s.leader('60'), 8)).toBe(true);
    expect(rowOf(propertySheet(s.model, s.ids('60')), 'Arrowhead')?.value).toBe(DOT);
    await s.set('arrowhead', '');
    expect(s.leader('60').arrowhead).toBeUndefined();
    await s.set('arrowhead', TITLE);
    expect(s.log.at(-1)).toBe('Invalid input.');
    await s.set('arrowhead', 'FFFF');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('refuses closed filled where the style’s arrowhead would draw instead', async () => {
    const dotted: MLeaderStyleRecord = { ...style, arrowhead: DOT };
    const s = setup([entityInit('60', textLeader({ arrowhead: OPEN30 }))], [dotted]);
    await s.bus.selectAll();
    await s.set('arrowhead', '');
    expect(s.leader('60').arrowhead).toBe(OPEN30);
    expect(s.log.at(-1)).toMatch(/1 object was not changed: .*style’s arrowhead/);
  });

  it('sets the arrowhead size, drawn at the overall scale', async () => {
    const g = textLeader({ scale: 2, drawnArrowheadSize: 8 });
    const s = setup([entityInit('60', g)]);
    await s.bus.selectAll();
    await s.set('arrowheadSize', '5');
    expect(s.leader('60')).toMatchObject({ arrowheadSize: 5, drawnArrowheadSize: 10 });
    expect(bit(s.leader('60'), 9)).toBe(true);
    await s.set('arrowheadSize', '0');
    expect(s.leader('60')).toMatchObject({ arrowheadSize: 0, drawnArrowheadSize: 0 });
    await s.set('arrowheadSize', '-1');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('turns the horizontal landing off and on, the leader then running to the text', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('horzLanding', 'no');
    const g = s.leader('60');
    expect(g.dogleg).toBe(false);
    expect(bit(g, 6)).toBe(true);
    // The leader line goes straight to where the landing ended; no landing is drawn.
    const lines = multiLeaderParts(g, s.model).filter((p) => p.geom.kind === 'LWPOLYLINE');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.geom).toMatchObject({ vertices: [{}, { x: 18, y: 10 }] });
    await s.set('horzLanding', 'yes');
    expect(s.leader('60')).toMatchObject({ dogleg: true, landing: true });
    expect(bit(s.leader('60'), 4)).toBe(true);
  });

  it('sets the landing distance, the text and the landing’s end kept', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.set('landingDistance', '4');
    const g = s.leader('60');
    expect(g.doglegLength).toBe(4);
    expect(bit(g, 7)).toBe(true);
    expect(g.branches[0]).toMatchObject({ doglegLength: 4, connection: { x: 14, y: 10 } });
    expect(g.text?.position).toEqual({ x: 20, y: 12 });
    expect(g.contentBase).toEqual({ x: 18, y: 10 });
    expect(rowOf(propertySheet(s.model, s.ids('60')), 'Landing distance')?.value).toBe(4);
    await s.set('landingDistance', '-1');
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('refuses a size or landing distance on an annotative multileader, not its colour', async () => {
    const s = setup([entityInit('60', textLeader({ annotative: true }))]);
    await s.bus.selectAll();
    await s.set('landingDistance', '4');
    expect(s.leader('60').doglegLength).toBe(8);
    expect(s.log.at(-1)).toMatch(/annotative/);
    await s.set('arrowheadSize', '2');
    expect(s.leader('60').arrowheadSize).toBe(4);
    await s.set('leaderColor', 'aci:3');
    expect(s.leader('60').lineColor).toEqual({ kind: 'aci', index: 3 });
  });
});
