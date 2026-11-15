// M2-35 part 27: the Direction row of an MTEXT's and a multileader's Text, which AutoCAD 2024's
// palette lists after Justify: Left to right, Top to bottom or By style (ActiveX
// AcDrawingDirection's acLeftToRight, acTopToBottom and acByStyle; MTEXT DXF 72 and the
// multileader context data's MTEXT DXF 172, 1, 3 and 5). The text is drawn down its columns only
// in a font with vertical glyphs (M1-110), as AutoCAD offers vertical text for no other font.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  newMultiLeader,
  propertySheet,
  settingsOf,
  standardMLeaderStyle,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type PropertyRow,
  type PropertySheet,
  type TextStyleRecord,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

type MText = Extract<EntityGeometry, { kind: 'MTEXT' }>;

const STANDARD_TEXT = '30';
const STANDARD = '35';

const textStyle: TextStyleRecord = {
  handle: STANDARD_TEXT,
  name: 'Standard',
  font: 'txt',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const style: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(true, STANDARD_TEXT),
};

const mtext = (over: Partial<MText> = {}): MText => ({
  kind: 'MTEXT',
  contents: 'GENERAL NOTES',
  style: STANDARD_TEXT,
  position: { x: 2, y: 8 },
  height: 2.5,
  width: 40,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...over,
});

function leader(flow = 1): MultiLeaderGeometry {
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
  return { ...g, text: { ...g.text!, flow } };
}

function setup(entities: NonNullable<DocumentInit['entities']>) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    tables: { ...base.tables, textStyles: [textStyle], mleaderStyles: [style] },
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
  return { model, bus, log, byHandle, ids };
}

const textRows = (sheet: PropertySheet): readonly PropertyRow[] =>
  sheet.sections.find((s) => s.title === 'Text')?.rows ?? [];
const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined =>
  textRows(sheet).find((r) => r.label === label);

const DIRECTIONS = [
  { value: '1', label: 'Left to right' },
  { value: '3', label: 'Top to bottom' },
  { value: '5', label: 'By style' },
];

describe('an MTEXT’s Direction (M2-35 part 27)', () => {
  it('follows Justify, a choice of AutoCAD’s three directions', () => {
    const s = setup([entityInit('60', mtext({ direction: 5 }))]);
    const sheet = propertySheet(s.model, s.ids('60'));
    const labels = textRows(sheet).map((r) => r.label);
    expect(labels.slice(labels.indexOf('Justify'), labels.indexOf('Justify') + 2)).toEqual([
      'Justify',
      'Direction',
    ]);
    expect(rowOf(sheet, 'Direction')).toMatchObject({ kind: 'choice', value: '5' });
    expect(rowOf(sheet, 'Direction')?.options).toEqual(DIRECTIONS);
  });

  it('reads a direction AutoCAD does not write (0, 2, 4) as Left to right', () => {
    const s = setup([entityInit('60', mtext({ direction: 0 })), entityInit('61', mtext())]);
    expect(rowOf(propertySheet(s.model, s.ids('60', '61')), 'Direction')?.value).toBe('1');
  });

  it('shows *VARIES* where MTEXTs differ', () => {
    const s = setup([entityInit('60', mtext()), entityInit('61', mtext({ direction: 3 }))]);
    expect(rowOf(propertySheet(s.model, s.ids('60', '61')), 'Direction')?.varies).toBe(true);
  });

  it('sets the direction, its insertion point kept, one undo step', async () => {
    const s = setup([entityInit('60', mtext()), entityInit('61', mtext({ direction: 5 }))]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'direction', value: '3' }, 'MTEXT');
    expect(s.byHandle('60').geom).toMatchObject({ direction: 3, position: { x: 2, y: 8 } });
    expect(s.byHandle('61').geom).toMatchObject({ direction: 3 });
    await s.bus.submit('U');
    expect((s.byHandle('60').geom as MText).direction).toBe(1);
    expect((s.byHandle('61').geom as MText).direction).toBe(5);
  });

  it('refuses a direction that is not one of the three', async () => {
    const s = setup([entityInit('60', mtext())]);
    await s.bus.selectAll();
    for (const value of ['2', '4', 'down', '']) {
      await s.bus.setProperty({ key: 'direction', value }, 'MTEXT');
      expect((s.byHandle('60').geom as MText).direction, value).toBe(1);
      expect(s.log.at(-1), value).toBe('Invalid input.');
    }
  });

  it('sets an annotative MTEXT’s direction, which its scales do not keep', async () => {
    // The direction is the entity's (MTEXT 72), not its context data's.
    const s = setup([
      entityInit('60', mtext(), { annotative: { representations: [{ handle: '31' }] } }),
    ]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'direction', value: '3' }, 'MTEXT');
    expect((s.byHandle('60').geom as MText).direction).toBe(3);
  });
});

describe('a multileader’s Direction (M2-35 part 27)', () => {
  it('follows Justify in the Text rows', () => {
    const s = setup([entityInit('60', leader())]);
    const sheet = propertySheet(s.model, s.ids('60'));
    expect(textRows(sheet).map((r) => r.label)).toEqual([
      'Contents',
      'Text style',
      'Justify',
      'Direction',
      'Text height',
      'Text rotation',
      'Line space factor',
      'Line space distance',
      'Line space style',
      'Background mask',
      'Text frame',
    ]);
    expect(rowOf(sheet, 'Direction')).toMatchObject({ kind: 'choice', value: '1' });
    expect(rowOf(sheet, 'Direction')?.options).toEqual(DIRECTIONS);
  });

  it('shows *VARIES* where multileaders differ', () => {
    const s = setup([entityInit('60', leader()), entityInit('61', leader(3))]);
    expect(rowOf(propertySheet(s.model, s.ids('60', '61')), 'Direction')?.varies).toBe(true);
  });

  it('sets the text’s flow, the text kept where it is, one undo step', async () => {
    const s = setup([entityInit('60', leader()), entityInit('61', leader(5))]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'direction', value: '3' }, 'MULTILEADER');
    const g = () => s.byHandle('60').geom as MultiLeaderGeometry;
    expect(g().text).toMatchObject({ flow: 3, position: { x: 20, y: 12 } });
    expect((s.byHandle('61').geom as MultiLeaderGeometry).text?.flow).toBe(3);
    // MLEADERSTYLE has no direction, so no override bit is set.
    expect(g().overrideFlags).toBe(leader().overrideFlags);
    await s.bus.submit('U');
    expect(g().text?.flow).toBe(1);
    expect((s.byHandle('61').geom as MultiLeaderGeometry).text?.flow).toBe(5);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'direction', value: '4' }, 'MULTILEADER');
    expect(g().text?.flow).toBe(1);
    expect(s.log.at(-1)).toBe('Invalid input.');
  });

  it('refuses an annotative multileader’s, which each scale keeps', async () => {
    const s = setup([entityInit('60', { ...leader(), annotative: true })]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'direction', value: '3' }, 'MULTILEADER');
    expect((s.byHandle('60').geom as MultiLeaderGeometry).text?.flow).toBe(1);
    expect(s.log.at(-1)).toMatch(/annotative/);
  });
});
