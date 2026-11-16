// M4-14: the Text Style and Multileader Style dialogs' preview images are small drawings of their
// own (as the Dimension Style Manager's, M4-03 part 3): "AaBb123" in the dialog's text style, and
// one multileader in the dialog's multileader style, its leader from the lower left to the landing.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  MLEADER_STYLE_SAMPLE,
  TEXT_STYLE_SAMPLE,
  mleaderStyleSettings,
  standardMLeaderStyle,
  stylePreviewModel,
  textStyleSettings,
  type Entity,
  type MLeaderStyleRecord,
  type MultiLeaderGeometry,
  type TextGeometry,
  type TextStyleRecord,
} from '../../src/index';
import { blockRecord, circleGeom, entityInit, sampleInit } from '../model/fixtures';

const TEXT = '32';
const ROMANS = '33';
const NOTES = '40';
const TAG = '50';

const romans: TextStyleRecord = {
  handle: ROMANS,
  name: 'Notes',
  font: 'romans.shx',
  height: 2.5,
  widthFactor: 0.8,
  obliqueAngle: 0,
  lastHeight: 2.5,
  generation: 0,
  trueTypeFlags: 0,
};

const notes: MLeaderStyleRecord = {
  handle: NOTES,
  ...standardMLeaderStyle(true, TEXT, undefined),
  name: 'Notes',
  defaultText: '',
};

function drawing(o: { noStyles?: boolean; noTextStyles?: boolean; noSpace?: boolean } = {}) {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      textStyles: o.noTextStyles
        ? []
        : [
            {
              ...romans,
              handle: TEXT,
              name: 'Standard',
              font: 'txt',
              height: 0,
              widthFactor: 1,
            },
            romans,
          ],
      mleaderStyles: o.noStyles ? [] : [notes],
      blockRecords: [
        ...(o.noSpace
          ? (base.tables?.blockRecords ?? []).filter((r) => !r.name.startsWith('*Model'))
          : (base.tables?.blockRecords ?? [])),
        blockRecord(TAG, 'TAG'),
      ],
    },
    blocks: [
      ...(base.blocks ?? []).filter((b) => !(o.noSpace && b.name.startsWith('*Model'))),
      { handle: TAG, name: 'TAG', basePoint: { x: 0, y: 0 } },
    ],
    entities: [entityInit('AA', circleGeom(0, 0, 1), { owner: TAG })],
  });
}

/** The preview's one sample entity in model space. */
function sampleOf(pm: DocumentModel | undefined): Entity {
  expect(pm).toBeDefined();
  const space = [...pm!.tables.blockRecords.values()].find((r) => r.name === '*Model_Space')!;
  const ids = [...pm!.blockEntities(space.handle)];
  expect(ids).toHaveLength(1);
  return pm!.entity(ids[0]!)!;
}

const styleOf = (pm: DocumentModel, h: string | undefined) =>
  [...pm.tables.mleaderStyles.values()].find((s) => s.handle === h)!;

describe('Text Style preview (M4-14)', () => {
  it('shows AaBb123 in the dialog’s font and effects, on a style of its own', () => {
    const model = drawing();
    const settings = {
      ...textStyleSettings(romans),
      widthFactor: 0.5,
      obliqueAngle: 15,
      backwards: true,
      upsideDown: true,
    };
    const pm = stylePreviewModel(model, { kind: 'textstyle', settings });
    const e = sampleOf(pm);
    const g = e.geom as TextGeometry;
    expect(g).toMatchObject({
      kind: 'TEXT',
      value: TEXT_STYLE_SAMPLE,
      height: 2.5,
      widthFactor: 0.5,
      backward: true,
      upsideDown: true,
    });
    expect(g.oblique).toBeCloseTo((15 * Math.PI) / 180);
    expect(pm!.tables.textStyles.get(g.style)).toMatchObject({
      font: 'romans.shx',
      name: '*PREVIEW',
    });
    // Layer 0 drawn plain; the source drawing is untouched.
    expect(pm!.tables.layers.get(e.layer)).toMatchObject({ on: true, frozen: false });
    expect(model.tables.textStyles.size).toBe(2);
    expect(pm).not.toBe(model);
  });

  it('draws a style whose height is asked for at height 1', () => {
    const pm = stylePreviewModel(drawing(), {
      kind: 'textstyle',
      settings: { ...textStyleSettings(romans), height: 0 },
    });
    expect((sampleOf(pm).geom as TextGeometry).height).toBe(1);
  });

  it('shows nothing for a drawing without model space', () => {
    expect(
      stylePreviewModel(drawing({ noSpace: true }), {
        kind: 'textstyle',
        settings: textStyleSettings(romans),
      }),
    ).toBeUndefined();
  });
});

describe('Multileader Style preview (M4-14)', () => {
  const mleader = (pm: DocumentModel | undefined) => sampleOf(pm).geom as MultiLeaderGeometry;

  it('shows a text multileader rising from the arrowhead to the landing, Default Text on it', () => {
    const model = drawing();
    const pm = stylePreviewModel(model, {
      kind: 'mleaderstyle',
      settings: mleaderStyleSettings(notes),
      from: 'Notes',
    });
    const g = mleader(pm);
    expect(g.text?.content).toBe(MLEADER_STYLE_SAMPLE);
    expect(g.text?.height).toBe(notes.textHeight);
    const line = g.branches[0]!.lines[0]!.vertices;
    expect(line).toEqual([{ x: 0, y: 0 }]);
    // The landing is up and to the right of the arrowhead, the text right of the landing.
    expect(g.branches[0]!.connection.x).toBeGreaterThan(0);
    expect(g.branches[0]!.connection.y).toBeGreaterThan(0);
    expect(g.text!.position.x).toBeGreaterThan(g.branches[0]!.connection.x);
    const style = styleOf(pm!, g.style);
    expect(style.name).toBe('*PREVIEW');
    // The drawing gains nothing.
    expect(model.tables.mleaderStyles.size).toBe(1);
  });

  it('follows the dialog: its text, colour, scale, a bend without a point limit, no landing', () => {
    const pm = stylePreviewModel(drawing(), {
      kind: 'mleaderstyle',
      settings: {
        ...mleaderStyleSettings(notes),
        defaultText: 'NOTE',
        lineColor: 'aci:1',
        maxPointsOn: false,
        landing: false,
        scale: 2,
        textStyle: ROMANS,
        extendToText: true,
      },
      from: 'Notes',
    });
    const g = mleader(pm);
    expect(g.text?.content).toBe('NOTE');
    expect(g.text?.style).toBe(ROMANS);
    expect(g.lineColor).toEqual({ kind: 'aci', index: 1 });
    expect(g.scale).toBe(2);
    expect(g.text?.height).toBe(notes.textHeight * 2);
    expect(g.branches[0]!.lines[0]!.vertices).toHaveLength(2);
    expect(g.landing).toBe(false);
    expect(g.extendLeaderToText).toBe(true);
    expect(styleOf(pm!, g.style).maxLeaderPoints).toBe(0);
  });

  it('places vertical attachment text above the landing', () => {
    const g = mleader(
      stylePreviewModel(drawing(), {
        kind: 'mleaderstyle',
        settings: { ...mleaderStyleSettings(notes), attachment: '1' },
      }),
    );
    expect(g.textAttachmentDirection).toBe(1);
    expect(g.text!.position.y).toBeGreaterThan(g.branches[0]!.connection.y);
  });

  it('shows block content: the drawing’s block, or a built-in block added to the preview only', () => {
    const model = drawing();
    const own = mleader(
      stylePreviewModel(model, {
        kind: 'mleaderstyle',
        settings: { ...mleaderStyleSettings(notes), contentType: '1', block: TAG },
      }),
    );
    expect(own.contentType).toBe(1);
    expect(own.block?.block).toBe(TAG);
    const pm = stylePreviewModel(model, {
      kind: 'mleaderstyle',
      settings: {
        ...mleaderStyleSettings(notes),
        contentType: '1',
        block: '_TagCircle',
        arrowhead: '_DOT',
      },
    });
    const built = mleader(pm);
    expect(pm!.blocks.get(built.block!.block!)?.name).toBe('_TagCircle');
    expect(pm!.blocks.get(built.arrowhead!)?.name).toBe('_DOT');
    expect([...model.blocks.values()].some((b) => b.name === '_TagCircle')).toBe(false);
  });

  it('shows a multileader without content as its leader and landing', () => {
    const g = mleader(
      stylePreviewModel(drawing(), {
        kind: 'mleaderstyle',
        settings: { ...mleaderStyleSettings(notes), contentType: '0' },
      }),
    );
    expect(g.contentType).toBe(0);
    expect(g.text).toBeUndefined();
    expect(g.block).toBeUndefined();
  });

  it('shows AutoCAD’s Standard in a drawing without styles, and nothing without a text style', () => {
    const settings = mleaderStyleSettings({ handle: '', ...standardMLeaderStyle(true, TEXT) });
    const g = mleader(
      stylePreviewModel(drawing({ noStyles: true }), { kind: 'mleaderstyle', settings }),
    );
    expect(g.text?.style).toBe(TEXT);
    expect(
      stylePreviewModel(drawing({ noStyles: true, noTextStyles: true }), {
        kind: 'mleaderstyle',
        settings: { ...settings, textStyle: '' },
      }),
    ).toBeUndefined();
    expect(
      stylePreviewModel(drawing({ noSpace: true }), { kind: 'mleaderstyle', settings }),
    ).toBeUndefined();
  });
});
