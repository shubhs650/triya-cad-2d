// M2-35 part 11: a multileader's Text rows in the Properties palette (AutoCAD 2024's
// "Properties Palette — Multileader": Contents with its `...` button, Text style, Justify and Text
// height). The text stays on its landing: the side of its box facing the landing is kept, so a
// Justify or a style that changes the box's width moves the insertion point by the width the
// canvas measures (`textWidths`), and a height that moves the attachment level moves it up or
// down by that much.
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
  type MLeaderStyleRecord,
  type MTextGeometry,
  type MultiLeaderGeometry,
  type PropertyRow,
  type PropertySheet,
  type StringPrompt,
  type TextStyleRecord,
  type ViewReply,
  type ViewRequest,
} from '../../src/index';
import { entityInit, sampleInit } from '../model/fixtures';

const STANDARD_TEXT = '30';
const NARROW_TEXT = '31';
const FIXED_TEXT = '32';
const STANDARD = '35';

const textStyle = (handle: string, name: string, height = 0): TextStyleRecord => ({
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

/** AutoCAD's metric Standard style: gap 2, landing 8, text 4, "middle of top line" (1). */
const style: MLeaderStyleRecord = {
  handle: STANDARD,
  ...standardMLeaderStyle(true, STANDARD_TEXT),
};

/**
 * A text multileader from (0, 0) to a landing at (10, 10) running right to (18, 10); the text
 * starts a gap beyond it, at (20, 12) by its top left (a height of 4: its top line's middle on
 * the landing).
 */
function textLeader(over: Partial<MultiLeaderGeometry['text'] & object> = {}): MultiLeaderGeometry {
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
  return { ...g, text: { ...g.text!, ...over } };
}

/** The same leader mirrored: the landing runs left to (-18, 10) and the text ends at (-20, 12). */
function leftLeader(): MultiLeaderGeometry {
  const g = textLeader({ position: { x: -20, y: 12 }, attachment: 3 });
  return {
    ...g,
    contentBase: { x: -18, y: 10 },
    branches: g.branches.map((b) => ({
      ...b,
      connection: { x: -10, y: 10 },
      direction: { x: -1, y: 0 },
    })),
  };
}

const blockLeader = (): MultiLeaderGeometry => {
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
};

interface Options {
  /** The width the canvas measures a text at: 6 per character, times the height over 4. */
  measure?: boolean;
  /** The canvas cannot answer at all. */
  noCanvas?: boolean;
}

function setup(entities: NonNullable<DocumentInit['entities']>, o: Options = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      textStyles: [
        textStyle(STANDARD_TEXT, 'Standard'),
        textStyle(NARROW_TEXT, 'Narrow'),
        textStyle(FIXED_TEXT, 'Fixed', 3.5),
      ],
      mleaderStyles: [style],
    },
    entities,
  });
  const asked: ViewRequest[] = [];
  const widthOf = (t: MTextGeometry) =>
    t.contents.length * 6 * (t.height / 4) * (t.style === NARROW_TEXT ? 0.5 : 1);
  const answer = (r: ViewRequest): ViewReply => {
    asked.push(r);
    if (o.noCanvas) return { ok: false, message: 'There is no view.' };
    if (r.op === 'textWidths')
      return o.measure === false
        ? { ok: true, widths: r.texts.map(() => null) }
        : { ok: true, widths: r.texts.map(widthOf) };
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
  return { model, bus, log, asked, byHandle, ids, leader };
}

const rows = (sheet: PropertySheet): PropertyRow[] => sheet.sections.flatMap((s) => s.rows);
const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined =>
  rows(sheet).find((x) => x.label === label);

describe('a multileader’s Text rows (M2-35 part 11)', () => {
  it('shows Contents, Text style, Justify and Text height under Text', () => {
    const s = setup([entityInit('60', textLeader()), entityInit('61', textLeader())]);
    const one = propertySheet(s.model, s.ids('60'));
    const text = one.sections.find((x) => x.title === 'Text');
    expect(text?.rows.map((r) => r.label)).toEqual([
      'Contents',
      'Text style',
      'Justify',
      'Text height',
    ]);
    expect(rowOf(one, 'Contents')).toMatchObject({ value: 'VALVE', readOnly: true, editor: true });
    expect(rowOf(one, 'Text style')).toMatchObject({ kind: 'choice', value: STANDARD_TEXT });
    expect(rowOf(one, 'Text style')?.options?.map((o) => o.label)).toEqual([
      'Standard',
      'Narrow',
      'Fixed',
    ]);
    expect(rowOf(one, 'Justify')).toMatchObject({ kind: 'choice', value: 'Left' });
    expect(rowOf(one, 'Justify')?.options?.map((o) => o.label)).toEqual([
      'Left',
      'Center',
      'Right',
    ]);
    expect(rowOf(one, 'Text height')).toMatchObject({ kind: 'distance', value: 4 });
    // The editor edits one object: several multileaders show their contents without it.
    const two = propertySheet(s.model, s.ids('60', '61'));
    expect(rowOf(two, 'Contents')?.editor).toBeUndefined();
    expect(rowOf(two, 'Contents')?.value).toBe('VALVE');
  });

  it('shows no Text rows for block content', () => {
    const s = setup([entityInit('60', textLeader()), entityInit('62', blockLeader())]);
    expect(rowOf(propertySheet(s.model, s.ids('62')), 'Contents')).toBeUndefined();
    // Text and block multileaders together share no text.
    expect(rowOf(propertySheet(s.model, s.ids('60', '62')), 'Text style')).toBeUndefined();
  });

  it('right-justifies text right of its landing, its left edge kept', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Right' }, 'MULTILEADER');
    const g = s.leader('60');
    // VALVE measures 30: its right edge, now its attachment point, 30 to the right.
    expect(g.text).toMatchObject({ attachment: 3, position: { x: 50, y: 12 } });
    expect(g.textAlignment).toBe(2);
    expect(g.overrideFlags & (1 << 14)).toBeTruthy();
    expect(s.asked.filter((r) => r.op === 'textWidths')).toHaveLength(1);
    expect(rowOf(propertySheet(s.model, s.ids('60')), 'Justify')?.value).toBe('Right');
    await s.bus.setProperty({ key: 'justify', value: 'Center' }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ attachment: 2, position: { x: 35, y: 12 } });
    // One undo step each.
    await s.bus.submit('U');
    expect(s.leader('60').text).toMatchObject({ attachment: 3, position: { x: 50, y: 12 } });
    await s.bus.submit('U');
    expect(s.leader('60').text).toMatchObject({ attachment: 1, position: { x: 20, y: 12 } });
  });

  it('keeps the right edge of text left of its landing', async () => {
    const s = setup([entityInit('60', leftLeader())]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Left' }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ attachment: 1, position: { x: -50, y: 12 } });
    expect(s.leader('60').textAlignment).toBe(0);
  });

  it('keeps the middle of text above or below its leader (vertical attachment)', async () => {
    const g = textLeader({ position: { x: 18, y: 12 }, attachment: 8 });
    const s = setup([entityInit('60', { ...g, textAttachmentDirection: 1 })]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Left' }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ attachment: 7, position: { x: 3, y: 12 } });
  });

  it('places wrapped text by its defined width without measuring', async () => {
    const s = setup([entityInit('60', textLeader({ width: 25 }))], { measure: false });
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Right' }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ attachment: 3, position: { x: 45, y: 12 } });
    expect(s.asked.filter((r) => r.op === 'textWidths')).toHaveLength(0);
  });

  it('refuses a Justify the canvas cannot measure, and one on an annotative multileader', async () => {
    const s = setup([entityInit('60', textLeader())], { measure: false });
    await s.bus.selectAll();
    const before = s.leader('60');
    await s.bus.setProperty({ key: 'justify', value: 'Right' }, 'MULTILEADER');
    expect(s.leader('60')).toEqual(before);
    expect(s.log.at(-1)).toBe('1 object was not changed: its text cannot be measured.');
    const a = setup([entityInit('60', { ...textLeader(), annotative: true })]);
    await a.bus.selectAll();
    await a.bus.setProperty({ key: 'justify', value: 'Right' }, 'MULTILEADER');
    expect(a.leader('60').text?.attachment).toBe(1);
    expect(a.log.at(-1)).toMatch(/annotative/);
    await a.bus.setProperty({ key: 'justify', value: 'Middle' }, 'MULTILEADER');
    expect(a.log.at(-1)).toBe('Invalid input.');
  });

  it('refuses a Justify with no canvas to measure it', async () => {
    const s = setup([entityInit('60', textLeader())], { noCanvas: true });
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Center' }, 'MULTILEADER');
    expect(s.leader('60').text?.attachment).toBe(1);
    expect(s.log.at(-1)).toBe('1 object was not changed: its text cannot be measured.');
  });

  it('keeps the middle of text between landings on both sides', async () => {
    const g = textLeader({ position: { x: 35, y: 12 }, attachment: 2 });
    const both = {
      ...g,
      branches: [
        ...g.branches,
        { ...g.branches[0]!, index: 1, direction: { x: -1, y: 0 }, connection: { x: 60, y: 10 } },
      ],
    };
    const s = setup([entityInit('60', both)]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Left' }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ attachment: 1, position: { x: 20, y: 12 } });
  });

  it('moves turned and upside-down text along its own axes', async () => {
    const turned = textLeader({ rotation: Math.PI / 2 });
    const s = setup([entityInit('60', turned)]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'justify', value: 'Right' }, 'MULTILEADER');
    const p = s.leader('60').text!.position;
    expect(p.x).toBeCloseTo(20, 9);
    expect(p.y).toBeCloseTo(42, 9);
    const down = setup([entityInit('60', textLeader({ upsideDown: true }))]);
    await down.bus.selectAll();
    await down.bus.setProperty({ key: 'height', value: '6' }, 'MULTILEADER');
    // Its Y axis points down the page: a taller text's top line moves down.
    expect(down.leader('60').text).toMatchObject({ height: 6, position: { x: 20, y: 11 } });
  });

  it('shows *VARIES* where multileaders differ', () => {
    const s = setup([
      entityInit('60', textLeader()),
      entityInit('61', textLeader({ height: 5, attachment: 3, content: 'TEE' })),
    ]);
    const sheet = propertySheet(s.model, s.ids('60', '61'));
    for (const label of ['Contents', 'Justify', 'Text height'])
      expect(rowOf(sheet, label)?.varies, label).toBe(true);
    expect(rowOf(sheet, 'Text style')?.value).toBe(STANDARD_TEXT);
  });

  it('sets the text height, the text kept on its attachment level', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'height', value: '6' }, 'MULTILEADER');
    // "Middle of top line": the top line's middle stays on the landing, so its top rises by 1.
    expect(s.leader('60').text).toMatchObject({ height: 6, position: { x: 20, y: 13 } });
    // Left-justified right of its landing: no width is needed.
    expect(s.asked.filter((r) => r.op === 'textWidths')).toHaveLength(0);
    const before = s.leader('60');
    await s.bus.setProperty({ key: 'height', value: '0' }, 'MULTILEADER');
    await s.bus.setProperty({ key: 'height', value: '-2' }, 'MULTILEADER');
    expect(s.leader('60')).toEqual(before);
  });

  it('keeps a right-justified text’s left edge when its height changes its width', async () => {
    const s = setup([entityInit('60', textLeader({ position: { x: 50, y: 12 }, attachment: 3 }))]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'height', value: '8' }, 'MULTILEADER');
    // 30 wide at 4, 60 at 8: the right edge moves 30 right; the top rises by 2.
    expect(s.leader('60').text).toMatchObject({ height: 8, position: { x: 80, y: 14 } });
  });

  it('gives the text another style, flagged as overriding the multileader style', async () => {
    const s = setup([entityInit('60', textLeader({ position: { x: 50, y: 12 }, attachment: 3 }))]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'style', value: NARROW_TEXT }, 'MULTILEADER');
    const g = s.leader('60');
    // Narrow halves the width: the right edge moves 15 left.
    expect(g.text).toMatchObject({ style: NARROW_TEXT, height: 4, position: { x: 35, y: 12 } });
    expect(g.overrideFlags & (1 << 11)).toBeTruthy();
    // A fixed-height style keeps the multileader's height (its style's, times its scale).
    await s.bus.setProperty({ key: 'style', value: FIXED_TEXT }, 'MULTILEADER');
    expect(s.leader('60').text).toMatchObject({ style: FIXED_TEXT, height: 4 });
    const before = s.leader('60');
    await s.bus.setProperty({ key: 'style', value: 'FF' }, 'MULTILEADER');
    expect(s.leader('60')).toEqual(before);
  });
});

describe('a multileader’s Contents in the In-Place Text Editor (M2-35 part 11)', () => {
  it('opens the editor on the one multileader shown, one undo step', async () => {
    const s = setup([entityInit('60', textLeader())]);
    await s.bus.selectAll();
    await s.bus.editContents('MULTILEADER');
    expect(s.bus.command).toBe('PROPERTIES');
    expect((s.bus.prompt as StringPrompt).editor).toMatchObject({
      kind: 'mtext',
      value: 'VALVE',
      style: STANDARD_TEXT,
    });
    await s.bus.answer({ kind: 'string', value: 'GATE VALVE', editor: true });
    expect(s.bus.command).toBeUndefined();
    expect(s.leader('60').text?.content).toBe('GATE VALVE');
    expect(s.bus.selection).toEqual(s.ids('60'));
    await s.bus.submit('U');
    expect(s.leader('60').text?.content).toBe('VALVE');
  });

  it('does nothing for a block multileader or several multileaders', async () => {
    const s = setup([entityInit('62', blockLeader())]);
    await s.bus.selectAll();
    await s.bus.editContents('MULTILEADER');
    expect(s.bus.command).toBeUndefined();
    const t = setup([entityInit('60', textLeader()), entityInit('61', textLeader())]);
    await t.bus.selectAll();
    await t.bus.editContents('MULTILEADER');
    expect(t.bus.command).toBeUndefined();
  });
});
