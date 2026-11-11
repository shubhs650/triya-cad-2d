// M2-35 part 4: the Properties palette's Select Color… (AutoCAD 2024 Help, "Select Color Dialog
// Box": Index Color, True Color and Color Books tabs). Triya ships no colour books (AutoCAD's
// .acb files are Autodesk's, CLAUDE.md), so the Color Books tab offers the books the drawing
// already uses, with the colours of them it uses, as -ATTEDIT's COlorbook does (M2-27). The
// sheet carries them; the dialog's choice is an ordinary Color edit.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  propertySheet,
  type Color,
  type DocumentInit,
  type Entity,
} from '../../src/index';
import {
  LAYER_WALLS,
  circleGeom,
  entityInit,
  layer,
  lineGeom,
  sampleInit,
} from '../model/fixtures';

const RAL_1006: Color = {
  kind: 'rgb',
  r: 226,
  g: 144,
  b: 0,
  bookName: 'RAL CLASSIC',
  colorName: 'RAL 1006',
};
const RAL_3020: Color = {
  kind: 'rgb',
  r: 204,
  g: 6,
  b: 5,
  bookName: 'RAL CLASSIC',
  colorName: 'RAL 3020',
};
const DIC_7: Color = {
  kind: 'rgb',
  r: 0,
  g: 120,
  b: 63,
  bookName: 'DIC COLOR GUIDE(R)',
  colorName: 'DIC 7',
};

function init(): DocumentInit {
  const base = sampleInit();
  return {
    ...base,
    tables: {
      ...base.tables,
      layers: [...(base.tables?.layers ?? []), { ...layer('12', 'GREEN'), color: DIC_7 }],
    },
    entities: [
      ...(base.entities ?? []),
      entityInit('30', circleGeom(30, -120, 2.4), { color: RAL_3020 }),
      entityInit('31', lineGeom(0, 5, 10, 5), { color: RAL_1006, layer: LAYER_WALLS }),
      // The same colour again: listed once.
      entityInit('32', lineGeom(0, 6, 10, 6), { color: { ...RAL_1006 } }),
    ],
  };
}

const idOf = (model: DocumentModel, handle: string) =>
  [...model.entities()].find((e) => e.handle === handle)!.id;

describe('the Properties sheet’s colour books', () => {
  it('lists the books the drawing uses, each with the colours of it the drawing uses', () => {
    const model = DocumentModel.create(init());
    const sheet = propertySheet(model, [idOf(model, '20')]);
    expect(sheet.colorBooks).toEqual([
      {
        name: 'DIC COLOR GUIDE(R)',
        colors: [
          { name: 'DIC 7', value: 'rgb:0,120,63;DIC COLOR GUIDE(R);DIC 7', rgb: [0, 120, 63] },
        ],
      },
      {
        name: 'RAL CLASSIC',
        colors: [
          { name: 'RAL 1006', value: 'rgb:226,144,0;RAL CLASSIC;RAL 1006', rgb: [226, 144, 0] },
          { name: 'RAL 3020', value: 'rgb:204,6,5;RAL CLASSIC;RAL 3020', rgb: [204, 6, 5] },
        ],
      },
    ]);
  });

  it('has none when the drawing uses no colour book', () => {
    const model = DocumentModel.create(sampleInit());
    expect(propertySheet(model, [idOf(model, '20')]).colorBooks).toBeUndefined();
  });

  it('is left out of "No selection", whose CECOLOR holds no true colour', () => {
    const model = DocumentModel.create(init());
    expect(propertySheet(model, []).colorBooks).toBeUndefined();
  });
});

describe('a colour the Select Color dialog picks', () => {
  function setup() {
    const model = DocumentModel.create(init());
    const bus = new PromptBus({ model, registry: builtinCommands() });
    // The sample's circle; the edits go to every circle, as the palette narrowed to Circle does.
    const circle = idOf(model, '21');
    const color = (): Color => (model.entity(circle) as Entity).color;
    const set = async (value: string) => {
      await bus.selectAll();
      await bus.setProperty({ key: 'color', value }, 'CIRCLE');
    };
    return { model, set, color };
  }

  it('sets an index colour beyond the first seven', async () => {
    const { set, color } = setup();
    await set('aci:142');
    expect(color()).toEqual({ kind: 'aci', index: 142 });
  });

  it('sets a true colour, offered in the Color list afterwards', async () => {
    const { model, set, color } = setup();
    await set('rgb:12,34,56');
    expect(color()).toEqual({ kind: 'rgb', r: 12, g: 34, b: 56 });
    const row = propertySheet(model, [idOf(model, '21')]).sections[0]!.rows[0]!;
    expect(row.value).toBe('rgb:12,34,56');
    expect(row.options).toContainEqual({ value: 'rgb:12,34,56', label: '12,34,56' });
  });

  it('sets a colour-book colour by its book and name', async () => {
    const { set, color } = setup();
    await set('rgb:204,6,5;RAL CLASSIC;RAL 3020');
    expect(color()).toEqual(RAL_3020);
  });
});
