// M4-09 part 1: SCALETEXT and JUSTIFYTEXT on the PromptBus, driven as the command line drives
// them, with AutoCAD 2024's prompts ("SCALETEXT (Command)", "JUSTIFYTEXT (Command)", AutoCAD
// 2024 Help). JUSTIFYTEXT changes the justification point "without changing their locations";
// SCALETEXT changes the height about each object's own base point. The canvas here measures a
// text as the renderer places it (render/src/text.ts placedText), with 0.6 of the height per
// character and a descent of 0.2 of it.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  justifiedInPlace,
  mtextAttachmentPoint,
  mtextJustifiedInPlace,
  textJustificationPoint,
  type BusEvent,
  type EntityId,
  type InsertAttribute,
  type InsertGeometry,
  type MTextGeometry,
  type TextGeometry,
  type TextOutline,
  type TextStyleRecord,
  type Vec2,
  type ViewHost,
  type ViewReply,
} from '../../src/index';
import { blockRecord, entityInit, sampleInit } from '../model/fixtures';

const STANDARD = '30';
const NOFONT = '31';
const TB = '32';

const style = (handle: string, name: string): TextStyleRecord => ({
  handle,
  name,
  font: 'arial.ttf',
  height: 0,
  widthFactor: 1,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
});

const text = (value: string, at: Vec2, extra: Partial<TextGeometry> = {}): TextGeometry => ({
  kind: 'TEXT',
  value,
  style: STANDARD,
  position: at,
  height: 2,
  rotation: 0,
  widthFactor: 1,
  oblique: 0,
  halign: 0,
  valign: 0,
  backward: false,
  upsideDown: false,
  ...extra,
});

const mtext = (contents: string, at: Vec2, extra: Partial<MTextGeometry> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents,
  style: STANDARD,
  position: at,
  height: 2,
  width: 0,
  rotation: 0,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

const attrib = (h: string, tag: string, value: string, at: Vec2): InsertAttribute => ({
  handle: h,
  layer: '10',
  color: { kind: 'byLayer' },
  linetype: 'ByLayer',
  lineweight: 'ByLayer',
  transparency: 'ByLayer',
  ltScale: 1,
  visible: true,
  ...text(value, at),
  tag,
  flags: 0,
});

const rot = (p: Vec2, a: number): Vec2 => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});
const plus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** A single-line text's box as the renderer places it (placedText), or null without a font. */
export function outlineOf(t: TextGeometry): TextOutline | null {
  if (t.style === NOFONT) return null;
  const h = t.height;
  const width = t.value.length * 0.6 * h * (t.widthFactor || 1);
  const below = 0.2 * h;
  let at = t.position;
  let local = (p: Vec2): Vec2 => p;
  if ((t.halign === 3 || t.halign === 5) && t.alignmentPoint) {
    const len = Math.hypot(t.alignmentPoint.x - at.x, t.alignmentPoint.y - at.y);
    const k = len / width;
    local = (p) => ({ x: p.x * k, y: p.y * (t.halign === 3 ? k : 1) });
  } else {
    if ((t.halign !== 0 || t.valign !== 0) && t.alignmentPoint) at = t.alignmentPoint;
    const dx = t.halign === 1 || t.halign === 4 ? -width / 2 : t.halign === 2 ? -width : 0;
    const dy =
      t.halign === 4
        ? -(h - below) / 2
        : t.valign === 1
          ? below
          : t.valign === 2
            ? -h / 2
            : t.valign === 3
              ? -h
              : 0;
    local = (p) => ({ x: p.x + dx, y: p.y + dy });
  }
  const corners = [
    { x: 0, y: -below },
    { x: width, y: -below },
    { x: width, y: h },
    { x: 0, y: h },
  ].map((p) => plus(at, rot(local(p), t.rotation)));
  return { corners, width, below };
}

/** An MTEXT's frame: its widest line (or its width), and 5/3 of the height per extra line. */
const frameOf = (g: MTextGeometry) => {
  if (g.style === NOFONT) return null;
  const lines = g.contents.split('\\P');
  const natural = Math.max(...lines.map((l) => l.length)) * 0.6 * g.height;
  return {
    width: g.width > 0 ? g.width : natural,
    height: g.height + ((lines.length - 1) * 5 * g.height) / 3,
  };
};

/** The corners of an MTEXT's frame as drawn: what JUSTIFYTEXT must not move. */
function frameCorners(g: MTextGeometry): Vec2[] {
  const f = frameOf(g)!;
  const col = (g.attachment - 1) % 3;
  const row = Math.floor((g.attachment - 1) / 3);
  const left = (-col * f.width) / 2;
  const top = (row * f.height) / 2;
  return [
    { x: left, y: top - f.height },
    { x: left + f.width, y: top - f.height },
    { x: left + f.width, y: top },
    { x: left, y: top },
  ].map((p) => plus(g.position, rot(p, g.rotation)));
}

const canvas: ViewHost = {
  request: (r): Promise<ViewReply> => {
    if (r.op === 'textOutlines') {
      return Promise.resolve({
        ok: true,
        outlines: r.texts.map((t) => (t.kind === 'TEXT' ? outlineOf(t) : null)),
      });
    }
    if (r.op === 'textFrames') return Promise.resolve({ ok: true, frames: r.texts.map(frameOf) });
    return Promise.resolve({ ok: false, message: 'no view' });
  },
};

function setup(o: { cannoscale?: number } = {}) {
  const base = sampleInit();
  const model = DocumentModel.create({
    ...base,
    handSeed: '100',
    header: new Map([
      ...base.header!,
      ['$TEXTSTYLE', 'Standard'],
      ['$TEXTSIZE', 2.5],
      ...(o.cannoscale ? ([['CANNOSCALEVALUE', o.cannoscale]] as const) : []),
    ]),
    tables: {
      ...base.tables,
      textStyles: [style(STANDARD, 'Standard'), style(NOFONT, 'Missing')],
      blockRecords: [...base.tables!.blockRecords!, blockRecord(TB, 'TB')],
    },
    blocks: [...base.blocks!, { handle: TB, name: 'TB', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...base.entities!,
      entityInit('50', text('NOTE', { x: 0, y: 0 })),
      entityInit('51', text('TITLE', { x: 20, y: 20 }, { rotation: Math.PI / 6 })),
      entityInit('52', mtext('FIRST\\PSECOND', { x: 50, y: 10 })),
      entityInit(
        '53',
        text('WIDE', { x: 0, y: 40 }, { halign: 3, alignmentPoint: { x: 12, y: 40 } }),
      ),
      entityInit('54', text('LOST', { x: 0, y: 60 }, { style: NOFONT })),
      entityInit('55', {
        ...text('', { x: 0, y: 80 }),
        kind: 'ATTDEF',
        value: 'X',
        tag: 'PART',
        flags: 0,
        prompt: 'Part',
      }),
      entityInit('56', {
        kind: 'INSERT',
        block: TB,
        position: { x: 100, y: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0,
        attributes: [
          attrib('57', 'REV', 'A1', { x: 100, y: 0 }),
          {
            ...attrib('5B', 'NOTES', 'M1\\PM2', { x: 100, y: -10 }),
            height: 3,
            mtext: mtext('M1\\PM2', { x: 100, y: -10 }, { height: 3 }),
          },
        ],
      }),
      entityInit('59', mtext('GONE', { x: 0, y: 100 }, { style: NOFONT })),
      entityInit('5A', text('ALSO', { x: 0, y: 120 }, { style: NOFONT })),
      entityInit(
        '58',
        mtext('TURNED', { x: 80, y: 80 }, { rotation: Math.PI / 2, width: 20, attachment: 5 }),
      ),
    ],
  });
  const bus = new PromptBus({ model, registry: builtinCommands(), view: canvas });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const id = (h: string): EntityId => [...model.entities()].find((e) => e.handle === h)!.id;
  const geom = <T>(h: string) => model.entity(id(h))!.geom as T;
  return { model, bus, log, id, geom };
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const pt = (p: Vec2 | undefined) => (p ? [r6(p.x), r6(p.y)] : undefined);
const pts = (ps: readonly Vec2[]) => ps.map(pt);

describe('justification points as drawn', () => {
  it('reads every point off the box the canvas measured, turned with the text', () => {
    const t = text('ABCDE', { x: 10, y: 0 }, { rotation: Math.PI / 2 });
    const o = outlineOf(t)!;
    // 6 long, 2 high, 0.4 below the baseline; turned a quarter: along +Y, up is −X.
    expect(pt(textJustificationPoint(t, o, { halign: 0, valign: 0 }))).toEqual([10, 0]);
    expect(pt(textJustificationPoint(t, o, { halign: 2, valign: 3 }))).toEqual([8, 6]);
    expect(pt(textJustificationPoint(t, o, { halign: 1, valign: 1 }))).toEqual([10.4, 3]);
    expect(pt(textJustificationPoint(t, o, { halign: 1, valign: 2 }))).toEqual([9, 3]);
    // Middle: halfway up the box from the descent line to the height.
    expect(pt(textJustificationPoint(t, o, { halign: 4, valign: 0 }))).toEqual([9.2, 3]);
  });

  it('an Aligned text leaving its points keeps its size in its height', () => {
    // WIDE (natural advance 4.8 at height 2) stretched over 12: 2.5 times.
    const t = text('WIDE', { x: 0, y: 0 }, { halign: 3, alignmentPoint: { x: 12, y: 0 } });
    const j = justifiedInPlace(t, { halign: 0, valign: 0 }, outlineOf(t)!);
    expect(r6(j.height)).toBe(5);
    expect(pt(j.position)).toEqual([0, 0]);
    const next = { ...t, ...j };
    expect(pts(outlineOf(next)!.corners)).toEqual(pts(outlineOf(t)!.corners));
  });

  it('a Fit text leaving its points keeps its size in its width factor', () => {
    const t = text('WIDE', { x: 0, y: 0 }, { halign: 5, alignmentPoint: { x: 9.6, y: 0 } });
    const j = justifiedInPlace(t, { halign: 1, valign: 2 }, outlineOf(t)!);
    expect(r6(j.widthFactor)).toBe(2);
    expect(j.height).toBe(2);
    expect(pts(outlineOf({ ...t, ...j })!.corners)).toEqual(pts(outlineOf(t)!.corners));
  });

  it("an MTEXT's attachment points lie on its frame, turned with it", () => {
    const g = mtext('ABCDE', { x: 0, y: 0 }, { rotation: Math.PI / 2, attachment: 1 });
    // A frame 6 wide and 2 high, turned a quarter: its width along +Y, its height along +X.
    expect(pt(mtextAttachmentPoint(g, frameOf(g)!, 9))).toEqual([2, 6]);
    expect(pt(mtextAttachmentPoint(g, frameOf(g)!, 5))).toEqual([1, 3]);
  });

  it("an upside-down MTEXT's frame hangs the other way; the same attachment changes nothing", () => {
    const g = mtext('ABCDE', { x: 0, y: 0 }, { upsideDown: true, attachment: 1 });
    expect(pt(mtextAttachmentPoint(g, frameOf(g)!, 9))).toEqual([6, 2]);
    expect(mtextJustifiedInPlace(g, 1, frameOf(g)!)).toBe(g);
  });
});

describe('JUSTIFYTEXT', () => {
  it('gives texts another justification without moving them', async () => {
    const s = setup();
    const before = ['50', '51'].map((h) => pts(outlineOf(s.geom<TextGeometry>(h))!.corners));
    await s.bus.submit('JUSTIFYTEXT');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('50'), s.id('51')] });
    expect(s.bus.promptText).toBe(
      'Enter a justification option [Left/Align/Fit/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Left>:',
    );
    await s.bus.submit('MC');
    expect(s.bus.command).toBeUndefined();
    const note = s.geom<TextGeometry>('50');
    expect([note.halign, note.valign]).toEqual([1, 2]);
    // NOTE is 4.8 long and 2 high: its middle center is 2.4 along and 1 up.
    expect(pt(note.alignmentPoint)).toEqual([2.4, 1]);
    expect(pt(note.position)).toEqual([0, 0]);
    const after = ['50', '51'].map((h) => pts(outlineOf(s.geom<TextGeometry>(h))!.corners));
    expect(after).toEqual(before);
    // One undo puts both back; the justification chosen is the next default.
    await s.bus.submit('U');
    expect(s.geom<TextGeometry>('50').halign).toBe(0);
    await s.bus.submit('JUSTIFYTEXT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    expect(s.bus.promptText).toContain('<MC>:');
  });

  it('turns an Aligned text into a left one the same size, and back to Fit', async () => {
    const s = setup();
    const before = pts(outlineOf(s.geom<TextGeometry>('53'))!.corners);
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('53')] });
    await s.bus.submit('L');
    const t = s.geom<TextGeometry>('53');
    expect([t.halign, r6(t.height)]).toEqual([0, 5]);
    expect(pts(outlineOf(t)!.corners)).toEqual(before);
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('53')] });
    await s.bus.submit('F');
    const f = s.geom<TextGeometry>('53');
    expect([f.halign, pt(f.position), pt(f.alignmentPoint)]).toEqual([5, [0, 40], [12, 40]]);
    expect(pts(outlineOf(f)!.corners)).toEqual(before);
  });

  it("moves an MTEXT's insertion point to the attachment chosen on its frame", async () => {
    const s = setup();
    const before = ['52', '58'].map((h) => pts(frameCorners(s.geom<MTextGeometry>(h))));
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('52'), s.id('58')] });
    await s.bus.submit('BR');
    const m = s.geom<MTextGeometry>('52');
    // FIRST\PSECOND: 6 × 0.6 × 2 = 7.2 wide, 2 + 10/3 high.
    expect([m.attachment, pt(m.position)]).toEqual([9, [57.2, r6(10 - 2 - 10 / 3)]]);
    expect(s.geom<MTextGeometry>('58').attachment).toBe(9);
    expect(['52', '58'].map((h) => pts(frameCorners(s.geom<MTextGeometry>(h))))).toEqual(before);
    // Left, Align and Fit name an MTEXT's top left, Middle its centre.
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('52')] });
    await s.bus.submit('M');
    expect(s.geom<MTextGeometry>('52').attachment).toBe(5);
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('52')] });
    await s.bus.submit('A');
    expect(s.geom<MTextGeometry>('52').attachment).toBe(1);
    expect(pts(frameCorners(s.geom<MTextGeometry>('52')))).toEqual(before[0]);
  });

  it("takes attribute definitions and a block's attributes", async () => {
    const s = setup();
    const a0 = s.geom<InsertGeometry>('56').attributes[0]! as InsertAttribute;
    const was = pts(outlineOf({ ...a0, kind: 'TEXT' })!.corners);
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('55'), s.id('56')] });
    await s.bus.submit('TR');
    const a = s.geom<InsertGeometry>('56').attributes[0]!;
    expect([a.halign, a.valign]).toEqual([2, 3]);
    expect(pts(outlineOf({ ...a, kind: 'TEXT' })!.corners)).toEqual(was);
    const d = s.geom<TextGeometry>('55');
    // An attribute definition is drawn by its tag (PART).
    expect([d.halign, pt(d.alignmentPoint)]).toEqual([2, [4.8, 82]]);
  });

  it('leaves text no loaded font draws, and says what it skipped', async () => {
    const s = setup();
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('54'), s.id('50'), s.id('20')] });
    await s.bus.submit('R');
    expect(s.geom<TextGeometry>('54').halign).toBe(0);
    expect(s.geom<TextGeometry>('50').halign).toBe(2);
    expect(s.log).toContain('1 object was not text.');
    expect(s.log).toContain('1 text cannot be measured: no loaded font draws it.');
  });

  it("justifies a multiline attribute by its MTEXT's frame", async () => {
    const s = setup();
    const notes = () => s.geom<InsertGeometry>('56').attributes[1]!.mtext!;
    const before = pts(frameCorners(notes()));
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('56')] });
    await s.bus.submit('BR');
    expect(notes().attachment).toBe(9);
    expect(pts(frameCorners(notes()))).toEqual(before);
  });

  it('counts what it skipped, and changes nothing when nothing can be measured', async () => {
    const s = setup();
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({
      kind: 'selection',
      ids: [s.id('54'), s.id('5A'), s.id('59'), s.id('20'), s.id('21')],
    });
    expect(s.log).toContain('2 objects were not text.');
    await s.bus.submit('TC');
    expect(s.log).toContain('3 texts cannot be measured: no loaded font draws them.');
    expect(s.geom<TextGeometry>('54').halign).toBe(0);
    expect(s.geom<MTextGeometry>('59').attachment).toBe(1);
  });

  it('ends at an empty answer', async () => {
    const s = setup();
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'enter' });
    expect(s.bus.command).toBeUndefined();
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.answer({ kind: 'enter' });
    expect(s.bus.command).toBeUndefined();
    expect(s.geom<TextGeometry>('50').halign).toBe(0);
  });

  it('ends quietly with nothing to justify', async () => {
    const s = setup();
    await s.bus.script(['JUSTIFYTEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('20')] });
    expect(s.bus.command).toBeUndefined();
    expect(s.log).toContain('1 object was not text.');
  });
});

describe('SCALETEXT', () => {
  it('sets a new height about each object’s existing insertion point', async () => {
    const s = setup();
    await s.bus.submit('SCALETEXT');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('50'), s.id('52'), s.id('58')] });
    expect(s.bus.promptText).toBe(
      'Enter a base point option for scaling [Existing/Left/Center/Middle/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Existing>:',
    );
    await s.bus.submit('');
    expect(s.bus.promptText).toBe(
      'Specify new model height or [Paper height/Match object/Scale factor] <2.5000>:',
    );
    await s.bus.submit('5');
    expect(s.bus.command).toBeUndefined();
    const t = s.geom<TextGeometry>('50');
    expect([t.height, pt(t.position)]).toEqual([5, [0, 0]]);
    const m = s.geom<MTextGeometry>('52');
    expect([m.height, pt(m.position)]).toEqual([5, [50, 10]]);
    // A defined width grows with the text: the lines break where they did.
    const turned = s.geom<MTextGeometry>('58');
    expect([turned.height, turned.width, pt(turned.position)]).toEqual([5, 50, [80, 80]]);
    // One undo; the height given is the next default.
    await s.bus.submit('U');
    expect(s.geom<TextGeometry>('50').height).toBe(2);
    await s.bus.submit('SCALETEXT');
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.submit('');
    expect(s.bus.promptText).toContain('<5.0000>:');
  });

  it('scales about the justification point chosen, keeping each justification', async () => {
    const s = setup();
    const tl = (t: TextGeometry) =>
      pt(textJustificationPoint(t, outlineOf(t)!, { halign: 0, valign: 3 }));
    const before = tl(s.geom<TextGeometry>('51'));
    const mBefore = pt(frameCorners(s.geom<MTextGeometry>('52'))[3]!);
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('51'), s.id('52')] });
    await s.bus.script(['TL', '4']);
    const t = s.geom<TextGeometry>('51');
    expect([t.height, t.halign, t.valign]).toEqual([4, 0, 0]);
    expect(tl(t)).toEqual(before);
    const m = s.geom<MTextGeometry>('52');
    expect([m.height, m.attachment]).toEqual([4, 1]);
    expect(pt(frameCorners(m)[3]!)).toEqual(mBefore);
    // Bottom right: the frame's bottom right corner stays.
    const br = pt(frameCorners(m)[1]!);
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('52')] });
    await s.bus.script(['BR', '1']);
    expect(pt(frameCorners(s.geom<MTextGeometry>('52'))[1]!)).toEqual(br);
  });

  it('Scale factor, with Reference, multiplies each height', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50'), s.id('51')] });
    await s.bus.script(['', 'S']);
    expect(s.bus.promptText).toBe('Specify scale factor or [Reference] <2.0000>:');
    await s.bus.submit('3');
    expect([s.geom<TextGeometry>('50').height, s.geom<TextGeometry>('51').height]).toEqual([6, 6]);
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', 'S', 'R']);
    expect(s.bus.promptText).toBe('Specify reference length <1.0000>:');
    await s.bus.submit('4');
    expect(s.bus.promptText).toBe('Specify new length:');
    await s.bus.submit('2');
    expect(s.geom<TextGeometry>('50').height).toBe(3);
  });

  it('Match object takes the height of the text picked', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', 'M']);
    expect(s.bus.promptText).toBe('Select a text object with desired height:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('20')] });
    expect(s.log).toContain('The object is not text.');
    expect(s.bus.promptText).toBe('Select a text object with desired height:');
    await s.bus.answer({ kind: 'selection', ids: [s.id('53')] });
    expect(s.geom<TextGeometry>('50').height).toBe(2);
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('51')] });
    await s.bus.script(['', 'M']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('52')] });
    expect(s.geom<TextGeometry>('51').height).toBe(2);
  });

  it('Paper height gives the model height at the current annotation scale', async () => {
    const s = setup({ cannoscale: 0.01 });
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', 'P']);
    expect(s.bus.promptText).toBe('Specify new paper height <2.5000>:');
    await s.bus.submit('3.5');
    expect(r6(s.geom<TextGeometry>('50').height)).toBe(350);
  });

  it("scales attribute definitions and a block's attributes", async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('55'), s.id('56'), s.id('53')] });
    await s.bus.script(['', '1']);
    expect(s.geom<TextGeometry>('55').height).toBe(1);
    expect(s.geom<InsertGeometry>('56').attributes[0]!.height).toBe(1);
    // An Aligned text, scaled about its first point, runs half as far.
    const w = s.geom<TextGeometry>('53');
    expect([w.height, pt(w.alignmentPoint)]).toEqual([1, [6, 40]]);
  });

  it('leaves text that cannot be measured when a base point needs it', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('54'), s.id('50')] });
    await s.bus.script(['BC', '1']);
    expect(s.geom<TextGeometry>('54').height).toBe(2);
    expect(s.geom<TextGeometry>('50').height).toBe(1);
    expect(s.log).toContain('1 text cannot be measured: no loaded font draws it.');
  });

  it('refuses a height of zero', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', '0']);
    expect(s.log).toContain('Value must be positive and nonzero.');
    expect(s.bus.command).toBe('SCALETEXT');
  });

  it('scales a multiline attribute by its MTEXT, and leaves one already the height', async () => {
    const s = setup();
    const notes = () => s.geom<InsertGeometry>('56').attributes[1]!;
    const tl = pt(frameCorners(notes().mtext!)[3]!);
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('56')] });
    await s.bus.script(['TL', '2']);
    expect([notes().height, notes().mtext!.height]).toEqual([2, 2]);
    expect(pt(frameCorners(notes().mtext!)[3]!)).toEqual(tl);
    // REV is 2 high already: it stays as it was.
    const rev = s.geom<InsertGeometry>('56').attributes[0]!;
    expect([rev.height, pt(rev.position)]).toEqual([2, [100, 0]]);
  });

  it('Paper height is the model height when the drawing has no annotation scale', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', 'P', '0']);
    expect(s.log).toContain('Value must be positive and nonzero.');
    expect(s.bus.promptText).toContain('Specify new model height or');
    await s.bus.script(['P', '3']);
    expect(s.geom<TextGeometry>('50').height).toBe(3);
  });

  it('refuses a factor or length that is not positive, and asks again', async () => {
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
    await s.bus.script(['', 'S', '-1']);
    expect(s.bus.promptText).toBe('Specify scale factor or [Reference] <2.0000>:');
    await s.bus.script(['R', '0']);
    expect(s.bus.promptText).toBe('Specify scale factor or [Reference] <2.0000>:');
    await s.bus.script(['R', '2', '0']);
    expect(s.bus.promptText).toBe('Specify scale factor or [Reference] <2.0000>:');
    expect(s.log.filter((l) => l === 'Value must be positive and nonzero.')).toHaveLength(3);
    await s.bus.submit('');
    expect(s.geom<TextGeometry>('50').height).toBe(4);
  });

  it('ends at an empty answer to any prompt', async () => {
    const answers: string[][] = [['', 'S', 'R', '2']];
    for (const typed of [...answers, ['', 'M']]) {
      const s = setup();
      await s.bus.script(['SCALETEXT']);
      await s.bus.answer({ kind: 'selection', ids: [s.id('50')] });
      await s.bus.script(typed);
      await s.bus.answer(typed[1] === 'M' ? { kind: 'selection', ids: [] } : { kind: 'enter' });
      expect([typed, s.bus.command, s.bus.promptText]).toEqual([typed, undefined, 'Command:']);
      expect(s.geom<TextGeometry>('50').height).toBe(2);
    }
    const s = setup();
    await s.bus.script(['SCALETEXT']);
    await s.bus.answer({ kind: 'enter' });
    expect(s.bus.command).toBeUndefined();
  });
});
