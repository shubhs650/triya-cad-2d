// Layer states (M5-07 part 1): `.las` files (the Layer States Manager's Import and Export) and
// what the save refuses. The drawing is authored in memory with acad-ts; the corpus-wide round
// trip is packages/testkit/src/export/layer-states.corpus.test.ts.
import { ACadVersion } from '@node-projects/acad-ts';
import {
  DocumentModel,
  LAYER_STATE_MASK,
  importLayerStateChange,
  layerStateNamed,
  saveLayerStateChange,
  type ChangeSet,
  type LayerState,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  LasError,
  documentInit,
  exportDocument,
  parseLas,
  readCadDocument,
  UnsupportedChangeError,
  writeLas,
} from '../src/index';
import { sampleDocument, sampleDxf } from './fixtures';

/** A `.las` file as AutoCAD lays one out: two layers, one by true colour from a colour book. */
const LAS = [
  '0',
  'LAYERSTATEDICTIONARY',
  '0',
  'LAYERSTATE',
  '1',
  'Site plan',
  '91',
  '2047',
  '301',
  'Walls only ',
  '290',
  '0',
  '302',
  'WALLS',
  '8',
  '0',
  '90',
  '9',
  '62',
  '7',
  '370',
  '-3',
  '6',
  'Continuous',
  '2',
  'Color_7',
  '440',
  '0',
  '8',
  'WALLS',
  '90',
  '30',
  '62',
  '31',
  '370',
  '35',
  '6',
  'DASHED',
  '2',
  'Color_31',
  '440',
  '33554508',
  '92',
  '-1023622777',
  '300',
  'DIC COLOR GUIDE(R)$DIC 7',
  '0',
  'EOF',
  '',
].join('\r\n');

const apply = (model: DocumentModel, change: ChangeSet | string): void => {
  if (typeof change === 'string') throw new Error(change);
  model.apply(change);
};

const modelOf = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

describe('.las files', () => {
  it('reads a state with its layers, colours and linetypes by name', () => {
    const [s, ...more] = parseLas(LAS);
    expect(more).toEqual([]);
    expect(s).toEqual({
      name: 'Site plan',
      description: 'Walls only ',
      mask: LAYER_STATE_MASK.all,
      paperSpace: false,
      currentLayer: 'WALLS',
      layers: [
        {
          name: '0',
          on: false,
          frozen: false,
          locked: false,
          plot: true,
          newVpFrozen: false,
          vpFrozen: false,
          color: { kind: 'aci', index: 7 },
          linetypeName: 'Continuous',
          lineweight: 'Default',
          plotStyle: 'Color_7',
          transparency: { alpha: 255 },
        },
        {
          name: 'WALLS',
          on: true,
          frozen: true,
          locked: true,
          plot: true,
          newVpFrozen: true,
          vpFrozen: false,
          color: {
            kind: 'rgb',
            r: 0xfc,
            g: 0xc1,
            b: 0x87,
            bookName: 'DIC COLOR GUIDE(R)',
            colorName: 'DIC 7',
          },
          linetypeName: 'DASHED',
          lineweight: 35,
          plotStyle: 'Color_31',
          transparency: { alpha: 0x4c },
        },
      ],
    });
  });

  it('writes a state the drawing holds and reads it back', () => {
    const model = modelOf(sampleDxf(ACadVersion.AC1032));
    const [s] = parseLas(LAS);
    apply(model, importLayerStateChange(model, s!));
    const state = layerStateNamed(model, 'Site plan')!;
    // The drawing's layer 0 is named by handle, WALLS (not in it) by name.
    expect(state.layers.map((l) => [l.name, l.layer !== undefined])).toEqual([
      ['0', true],
      ['WALLS', false],
    ]);
    const text = writeLas(model, state);
    expect(text.startsWith('  0\r\nLAYERSTATEDICTIONARY\r\n  0\r\nLAYERSTATE\r\n')).toBe(true);
    expect(text.endsWith('  0\r\nEOF\r\n')).toBe(true);
    expect(parseLas(text)).toEqual([s]);
    // Several states in one file all come in.
    const two = text.replace(/  0\r\nEOF\r\n$/, '') + text.split('LAYERSTATEDICTIONARY\r\n')[1]!;
    expect(parseLas(two.replace('Site plan', 'First')).map((x) => x.name)).toEqual([
      'First',
      'Site plan',
    ]);
  });

  it('refuses a file that is not a layer state file', () => {
    expect(() => parseLas('0\nSECTION\n')).toThrow(LasError);
    expect(() => parseLas('x\nLAYERSTATEDICTIONARY\n')).toThrow('Line 1 is not a group code.');
    expect(() => parseLas('0\nLAYERSTATEDICTIONARY\n0\nEOF\n')).toThrow('no layer state');
    expect(() => parseLas('0\nLAYERSTATEDICTIONARY\n8\nA\n')).toThrow('Unexpected group 8.');
    expect(() => parseLas('0\nLAYERSTATEDICTIONARY\n0\nLAYER\n')).toThrow('Unexpected LAYER.');
    expect(() => parseLas('0\nLAYERSTATEDICTIONARY\n0\nLAYERSTATE\n91\n1\n0\nEOF\n')).toThrow(
      'no name',
    );
  });
});

describe('saving layer states', () => {
  it('makes ACAD_LAYERSTATES and its owner for the first state of a drawing without them', () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const model = modelOf(bytes);
    expect(model.meta.layerStateDictionary).toBeUndefined();
    apply(model, saveLayerStateChange(model, 'Plan'));
    const want = layerStateNamed(model, 'Plan')!;
    const doc = readCadDocument(bytes);
    const back = modelOf(exportDocument(doc, model, { format: 'dxf' }));
    const got = layerStateNamed(back, 'Plan')!;
    expect(got).toMatchObject({ handle: want.handle, owner: want.owner, reactors: [want.owner] });
    expect(got.layers).toEqual(want.layers);
    expect(back.meta.layerStateDictionary).toBe(want.owner);
  });

  it('refuses what it cannot write, before changing anything', () => {
    const bytes = sampleDxf(ACadVersion.AC1032);
    const model = modelOf(bytes);
    apply(model, saveLayerStateChange(model, 'Plan'));
    const state = layerStateNamed(model, 'Plan')!;
    // Filed in a dictionary that is not ACAD_LAYERSTATES, or under a handle in use.
    const moved: LayerState = { ...state, handle: model.handles.allocate(), owner: '1' };
    model.apply({ objects: { added: [moved] } } as ChangeSet);
    const refusal = (): string[] => {
      try {
        exportDocument(readCadDocument(bytes), model, { format: 'dxf' });
      } catch (e) {
        if (e instanceof UnsupportedChangeError) return e.problems;
        throw e;
      }
      return [];
    };
    expect(refusal().join('\n')).toMatch(/is not filed in ACAD_LAYERSTATES|another state is named/);
    // Before R2000 there are no XRECORDs to keep them in.
    const r14 = sampleDocument(ACadVersion.AC1014);
    const m14 = DocumentModel.create(documentInit(r14));
    apply(m14, saveLayerStateChange(m14, 'Plan'));
    expect(() =>
      exportDocument(sampleDocument(ACadVersion.AC1014), m14, { format: 'dxf' }),
    ).toThrow(/older than R2000/);
  });
});
