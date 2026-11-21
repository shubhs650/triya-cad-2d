// M7-02 part 3: the ribbon's Layers and Properties dropdowns (AutoCAD 2024 Help, "Layers Panel",
// "Properties Panel"). They show the layer, colour, linetype, lineweight and transparency of the
// objects selected, or with none the current ones, whatever the Properties palette shows; a pick
// changes the selection, or with none the current setting, as one undo step.
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  RIBBON_PROPERTY_KEYS,
  ribbonProperties,
  selectionKind,
  type CommandOutput,
  type DocumentModel,
  type EntityId,
  type RibbonProperties,
} from '../../src/index';
import { LAYER_0, LAYER_WALLS, sampleInit, sampleModel } from '../model/fixtures';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const value = (p: RibbonProperties, key: string) => p.rows.find((r) => r.key === key)?.value;

describe('ribbonProperties', () => {
  const model = sampleModel();

  it('gives the current settings with nothing selected, and every layer with its states', () => {
    const p = ribbonProperties(model, []);
    expect(p.count).toBe(0);
    expect(p.rows.map((r) => r.key)).toEqual([...RIBBON_PROPERTY_KEYS]);
    expect(value(p, 'layer')).toBe(p.currentLayer);
    expect(p.layers.map((l) => l.name)).toEqual(['0', 'WALLS']);
    expect(p.layers[0]).toMatchObject({ on: true, frozen: false, locked: false });
    expect(typeof p.layers[0]!.color).toBe('string');
  });

  it("gives the selection's shared values, a differing one varying", () => {
    const circle = model.entityByHandle('21')!.id;
    const line = model.entityByHandle('23')!.id;
    expect(value(ribbonProperties(model, [circle]), 'layer')).toBe(LAYER_WALLS);
    const both = ribbonProperties(model, [circle, line]);
    expect(both.count).toBe(2);
    expect(both.rows.find((r) => r.key === 'layer')?.varies).toBe(true);
  });
});

describe('selectionKind (M7-02 part 4)', () => {
  // A stand-in model: the kinds look only at each object's geometry kind, its block's xref flag
  // and the drawing's array records.
  const fake = (
    entities: Record<string, object>,
    o: { xrefs?: string[]; arrays?: string[] } = {},
  ): DocumentModel =>
    ({
      entity: (id: string) => entities[id],
      tables: {
        blockRecords: new Map((o.xrefs ?? []).map((h) => [h, { handle: h, name: 'X', flags: 4 }])),
      },
      objects: new Map(
        (o.arrays ?? []).map((h, i) => [`A${i}`, { type: 'TRIYA_ARRAY', insert: h }]),
      ),
    }) as unknown as DocumentModel;
  const ids = (...xs: string[]) => xs as unknown as EntityId[];
  const insert = (handle: string, block: string, extDict?: string) => ({
    handle,
    geom: { kind: 'INSERT', block },
    ...(extDict && { extDict }),
  });

  it('names the kind every selected object is, when they share one with a contextual tab', () => {
    const m = fake(
      {
        h1: { handle: 'h1', geom: { kind: 'HATCH' } },
        h2: { handle: 'h2', geom: { kind: 'HATCH' } },
        i: { handle: 'i', geom: { kind: 'IMAGE' } },
        w: { handle: 'w', geom: { kind: 'WIPEOUT' } },
        p: { handle: 'p', geom: { kind: 'PDFUNDERLAY' } },
        x: insert('x', 'XB'),
        a: insert('a', 'AB', 'D1'),
        b: insert('b', 'BB'),
        l: { handle: 'l', geom: { kind: 'LINE' } },
      },
      { xrefs: ['XB'], arrays: ['a'] },
    );
    expect(selectionKind(m, ids('h1', 'h2'))).toBe('hatch');
    expect(selectionKind(m, ids('i'))).toBe('image');
    expect(selectionKind(m, ids('p'))).toBe('pdf');
    expect(selectionKind(m, ids('x'))).toBe('xref');
    expect(selectionKind(m, ids('a'))).toBe('array');
    // A wipeout, a plain block reference or a line has none; nor has a mix, or nothing.
    expect(selectionKind(m, ids('w'))).toBeUndefined();
    expect(selectionKind(m, ids('b'))).toBeUndefined();
    expect(selectionKind(m, ids('h1', 'l'))).toBeUndefined();
    expect(selectionKind(m, ids('h1', 'i'))).toBeUndefined();
    expect(selectionKind(m, ids())).toBeUndefined();
  });
});

describe('EngineSession ribbon properties', () => {
  it('follows the selection while open, and a pick changes it or the current setting', async () => {
    const se = new EngineSession(sampleInit());
    const out: CommandOutput[] = [];
    se.onCommand((o) => out.push(o));
    const last = () =>
      out
        .filter(
          (o): o is Extract<CommandOutput, { type: 'ribbon-properties' }> =>
            o.type === 'ribbon-properties',
        )
        .at(-1)?.properties;
    await se.command({ kind: 'ribbon-properties', open: true });
    expect(last()?.count).toBe(0);

    // With nothing selected a pick sets the current layer (CLAYER).
    await se.command({ kind: 'ribbon-property', edit: { key: 'layer', value: LAYER_WALLS } });
    await flush();
    expect(last()?.currentLayer).toBe(LAYER_WALLS);
    expect(value(last()!, 'layer')).toBe(LAYER_WALLS);

    // With objects selected it moves them, whatever type the palette is narrowed to.
    await se.command({ kind: 'select-all' });
    await flush();
    expect(last()?.count).toBeGreaterThan(1);
    await se.command({ kind: 'ribbon-property', edit: { key: 'layer', value: LAYER_0 } });
    await flush();
    expect(value(last()!, 'layer')).toBe(LAYER_0);
    expect(last()?.currentLayer).toBe(LAYER_WALLS);

    // A layer edit from the Layer Properties Manager reaches the dropdown too.
    const before = out.length;
    expect(se.edit({ kind: 'layer', layer: LAYER_WALLS, on: false }).ok).toBe(true);
    await flush();
    expect(out.length).toBeGreaterThan(before);
    expect(last()?.layers.find((l) => l.handle === LAYER_WALLS)?.on).toBe(false);

    // Closed, it sends nothing more.
    await se.command({ kind: 'ribbon-properties', open: false });
    const n = out.length;
    await se.command({ kind: 'select-all' });
    await flush();
    expect(out.filter((o) => o.type === 'ribbon-properties').length).toBe(
      out.slice(0, n).filter((o) => o.type === 'ribbon-properties').length,
    );
  });
});
