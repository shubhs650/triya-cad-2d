// M3-12 part 7: EXPLODE of MTEXT (`edit/explode.ts`): AutoCAD Help, "EXPLODE (Command)":
// "Multiline Text: Explodes into text objects", one TEXT per run of one format as the canvas lays
// it out (`textPieces`), strokes as lines, runs in another font in a text style with that font.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  explodeObjects,
  type Entity,
  type EntityGeometry,
  type HeaderValue,
  type MTextGeometry,
  type TextPiece,
  type TextStyleRecord,
} from '../../src/index';
import {
  blockRecord,
  entityInit,
  LAYER_0,
  LAYER_WALLS,
  layer,
  MODEL_SPACE,
} from '../model/fixtures';

const STANDARD = '30';
const ROMANS = '31';
const ARIAL_BOLD = '32';
const RED = { kind: 'aci', index: 1 } as const;

const style = (handle: string, name: string, font: string, extra: Partial<TextStyleRecord> = {}) =>
  ({
    handle,
    name,
    font,
    height: 0,
    widthFactor: 0.8,
    obliqueAngle: 0,
    lastHeight: 2.5,
    generation: 0,
    trueTypeFlags: 0,
    ...extra,
  }) as TextStyleRecord;

const mtext = (extra: Partial<MTextGeometry> = {}): MTextGeometry => ({
  kind: 'MTEXT',
  contents: 'ONE\\PTWO',
  style: STANDARD,
  position: { x: 10, y: 20 },
  height: 2,
  width: 0,
  rotation: Math.PI / 6,
  attachment: 1,
  direction: 1,
  lineSpacingStyle: 1,
  lineSpacing: 1,
  ...extra,
});

const run = (value: string, x: number, extra: Partial<TextPiece> = {}): TextPiece =>
  ({
    kind: 'text',
    value,
    position: { x, y: 18 },
    height: 2,
    widthFactor: 0.8,
    oblique: 0,
    ...extra,
  }) as TextPiece;

function setup(extra: EntityGeometry[]) {
  const model = DocumentModel.create({
    meta: { sourceVersion: 'AC1032', codePage: 'ANSI_1252', insUnits: 1, measurement: 'imperial' },
    handSeed: '200',
    header: new Map<string, HeaderValue>(),
    tables: {
      layers: [layer(LAYER_0, '0'), layer(LAYER_WALLS, 'WALLS')],
      blockRecords: [blockRecord(MODEL_SPACE, '*Model_Space')],
      textStyles: [
        style(STANDARD, 'Standard', 'txt.shx', { bigFont: 'big.shx' }),
        style(ROMANS, 'Notes', 'romans.shx'),
        style(ARIAL_BOLD, 'Heading', 'arial.ttf', { trueTypeFlags: 2 }),
      ],
    },
    blocks: [{ handle: MODEL_SPACE, name: '*Model_Space', basePoint: { x: 0, y: 0 } }],
    layouts: [{ handle: '22', name: 'Model', tabOrder: 0, blockRecord: MODEL_SPACE }],
    entities: extra.map((g, i) =>
      entityInit((0x80 + i).toString(16).toUpperCase(), g, { layer: LAYER_WALLS }),
    ),
  });
  const explode = (pieces: (g: MTextGeometry) => readonly TextPiece[] | undefined) => {
    const b = new ChangeSetBuilder(model);
    const r = explodeObjects(b, model, model.blockEntities(MODEL_SPACE), { textPieces: pieces });
    model.apply(b.build());
    return r;
  };
  const space = (): Entity[] => model.blockEntities(MODEL_SPACE).map((id) => model.entity(id)!);
  return { model, explode, space };
}

describe('EXPLODE of MTEXT', () => {
  it('makes a TEXT of each run, along the MTEXT, with its layer and colour', () => {
    const { explode, space } = setup([mtext({ upsideDown: true, elevation: 4 })]);
    const r = explode(() => [run('ONE', 10), run('TWO', 10, { position: { x: 11, y: 15 } })]);
    expect(r.exploded).toBe(1);
    const made = space();
    expect(made.map((e) => e.geom.kind)).toEqual(['TEXT', 'TEXT']);
    expect(made[0]!.layer).toBe(LAYER_WALLS);
    expect(made[1]!.geom).toEqual({
      kind: 'TEXT',
      value: 'TWO',
      style: STANDARD,
      position: { x: 11, y: 15 },
      height: 2,
      rotation: Math.PI / 6,
      widthFactor: 0.8,
      oblique: 0,
      halign: 0,
      valign: 0,
      backward: false,
      upsideDown: true,
      elevation: 4,
    });
  });

  it("gives strokes as lines, runs their own colour and a run's %% its own percent signs", () => {
    const { explode, space } = setup([mtext()]);
    explode(() => [
      run('50%%', 10, { color: RED }),
      { kind: 'line', start: { x: 10, y: 17 }, end: { x: 14, y: 17 } },
    ]);
    const [t, l] = space();
    expect(t!.geom).toMatchObject({ value: '50%%%%%%' });
    expect(t!.color).toEqual(RED);
    expect(l!.geom).toEqual({ kind: 'LINE', start: { x: 10, y: 17 }, end: { x: 14, y: 17 } });
    expect(l!.color).toEqual({ kind: 'byLayer' });
  });

  it("puts a run in another font in the drawing's style with that font, or a new one", () => {
    const { model, explode, space } = setup([mtext(), mtext()]);
    explode(() => [
      run('A', 10, { font: { name: 'romans', kind: 'shx', bold: false, italic: false } }),
      run('B', 11, { font: { name: 'Arial', kind: 'ttf', bold: true, italic: false } }),
      run('C', 12, { font: { name: 'Arial', kind: 'ttf', bold: false, italic: true } }),
      run('D', 13, { font: { name: 'gothice.shx', kind: 'shx', bold: false, italic: false } }),
    ]);
    const made = space().map((e) => e.geom as Extract<EntityGeometry, { kind: 'TEXT' }>);
    expect(made.map((g) => g.style).slice(0, 2)).toEqual([ROMANS, ARIAL_BOLD]);
    const italic = model.tables.textStyles.get(made[2]!.style)!;
    expect(italic).toMatchObject({
      name: 'Arial Italic',
      font: 'Arial.ttf',
      trueTypeFlags: 1,
      height: 0,
      widthFactor: 0.8,
    });
    const gothic = model.tables.textStyles.get(made[3]!.style)!;
    expect(gothic).toMatchObject({ name: 'gothice', font: 'gothice.shx', bigFont: 'big.shx' });
    // The second MTEXT's runs take the same styles: each made once.
    expect(made[6]!.style).toBe(made[2]!.style);
    expect(model.tables.textStyles.size).toBe(5);
  });

  it('refuses an MTEXT the canvas cannot lay out, and an empty one', () => {
    const { explode, space } = setup([mtext(), mtext({ contents: '' })]);
    const r = explode((g) => (g.contents === '' ? [] : undefined));
    expect(r.refused).toEqual(
      new Map([
        ['the MTEXT cannot be laid out (its font is not loaded)', 1],
        ['the MTEXT is empty', 1],
      ]),
    );
    expect(space().map((e) => e.geom.kind)).toEqual(['MTEXT', 'MTEXT']);
    // Without the canvas at all, nothing either.
    const b = new ChangeSetBuilder(setup([mtext()]).model);
    expect(explodeObjects(b, setup([mtext()]).model, []).exploded).toBe(0);
  });

  it("keeps an inch drawing's tiny text runs where the canvas put them (tolerance case)", () => {
    const k = 1 / 64;
    const { explode, space } = setup([mtext({ height: 2 * k })]);
    explode(() => [run('X', 10, { height: 2 * k, position: { x: 10 + k, y: 20 - k } })]);
    expect(space()[0]!.geom).toMatchObject({ height: 2 * k, position: { x: 10 + k, y: 20 - k } });
  });
});
