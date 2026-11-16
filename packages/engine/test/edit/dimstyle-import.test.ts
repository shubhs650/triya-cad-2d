// M4-03 part 3: importing dimension styles from another drawing. The styles go as PASTECLIP's
// records do, each with its sub-styles and what it names (text style, linetypes, arrowhead
// blocks, the applications of its xdata), under new handles; a style the drawing has already by
// that name is ignored with its sub-styles, as AutoCAD's DesignCenter ignores a duplicate.
import { describe, expect, it } from 'vitest';
import {
  ChangeSetBuilder,
  DocumentModel,
  PromptBus,
  builtinCommands,
  compareHandles,
  copyDimStyles,
  dimStyleOffers,
  dimStyleXdataVars,
  importDimStyles,
  type DimStyleRecord,
  type DimStyleRequest,
  type TextStyleRecord,
} from '../../src/index';
import { entityInit, linetype, record, sampleInit } from '../model/fixtures';

const text = (handle: string, name: string, font = 'romans.shx'): TextStyleRecord =>
  ({ handle, name, font, height: 0, widthFactor: 1 }) as TextStyleRecord;
const style = (handle: string, name: string, vars: DimStyleRecord['vars'], extra = {}) =>
  ({ handle, name, vars, ...extra }) as DimStyleRecord;

/** The drawing styles are imported from. */
function source(): DocumentModel {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    handSeed: '200',
    tables: {
      ...base.tables,
      appIds: [record('90', 'ACAD'), record('91', 'ACAD_DSTYLE_DIMJAG')],
      textStyles: [text('80', 'Standard'), text('81', 'Notes', 'isocp.shx')],
      linetypes: [...(base.tables?.linetypes ?? []), linetype('82', 'CENTER')],
      blockRecords: [
        ...(base.tables?.blockRecords ?? []),
        { handle: '83', name: '_DOT', units: 0, explodable: true, scalable: true },
      ],
      dimStyles: [
        style('A0', 'Standard', { DIMTXT: 0.18, DIMTXSTY: '80' }),
        style('A1', 'Standard$0', { DIMTXT: 0.25, DIMTXSTY: '80' }),
        style(
          'A2',
          'Mech',
          { DIMTXT: 3.5, DIMTXSTY: '81', DIMBLK: '83', DIMLTYPE: '82' },
          {
            xdata: [
              {
                appId: '91',
                values: [
                  { code: 1070, value: 388 },
                  { code: 1040, value: 2 },
                ],
              },
            ],
          },
        ),
        style('A3', 'Mech$2', { DIMTXT: 3.5, DIMASZ: 5, DIMTXSTY: '81' }),
        style('A4', 'Arch', { DIMTXT: 0.125 }),
      ],
    },
    blocks: [...(base.blocks ?? []), { handle: '83', name: '_DOT', basePoint: { x: 0, y: 0 } }],
    entities: [
      ...(base.entities ?? []),
      entityInit('84', { kind: 'CIRCLE', center: { x: 0, y: 0 }, radius: 0.25 }, { owner: '83' }),
    ],
  });
}

/** The drawing they go into: Standard and ISO-25 of its own. */
function target(): DocumentModel {
  const base = sampleInit();
  return DocumentModel.create({
    ...base,
    tables: {
      ...base.tables,
      appIds: [record('12', 'ACAD')],
      textStyles: [text('32', 'Standard')],
      dimStyles: [
        style('27', 'Standard', { DIMTXT: 0.2, DIMTXSTY: '32' }),
        style('28', 'ISO-25', { DIMTXT: 2.5, DIMTXSTY: '32' }),
      ],
    },
  });
}

const named = (m: DocumentModel, name: string) =>
  [...m.tables.dimStyles.values()].find((s) => s.name === name);

describe('importing dimension styles (M4-03 part 3)', () => {
  it('offers a drawing’s styles, each followed by its sub-styles', () => {
    expect(dimStyleOffers(source())).toEqual([
      { name: 'Arch' },
      { name: 'Mech' },
      { name: 'Mech$2', parent: 'Mech', use: 'angular' },
      { name: 'Standard' },
      { name: 'Standard$0', parent: 'Standard', use: 'linear' },
    ]);
  });

  it('carries the styles named with their sub-styles and what they name', () => {
    const clip = copyDimStyles(source(), ['mech']);
    expect(clip.entities).toEqual([]);
    expect(clip.tables.dimStyles?.map((s) => s.name).sort()).toEqual(['Mech', 'Mech$2']);
    expect(clip.tables.textStyles?.map((s) => s.name)).toEqual(['Notes']);
    // The block's contents bring their layer's linetype too.
    expect(clip.tables.linetypes?.map((s) => s.name)).toContain('CENTER');
    expect(clip.tables.appIds?.map((s) => s.name)).toEqual(['ACAD_DSTYLE_DIMJAG']);
    expect(clip.blocks.map((b) => b.name)).toEqual(['_DOT']);
    expect(clip.blockEntities).toHaveLength(1);
    // A style the target has already stays behind with its sub-styles.
    const left = copyDimStyles(source(), ['Mech', 'Standard'], ['standard']);
    expect(left.tables.dimStyles?.map((s) => s.name).sort()).toEqual(['Mech', 'Mech$2']);
  });

  it('brings them in under new handles, naming the target’s own copies of what they use', () => {
    const t = target();
    const seed = t.handSeed;
    const b = new ChangeSetBuilder(t);
    const result = importDimStyles(b, t, copyDimStyles(source(), ['Mech', 'Standard', 'Arch']));
    t.apply(b.build());
    expect(result.added).toEqual(['Arch', 'Mech', 'Mech$2']);
    // Standard is the target's: ignored, and its sub-style with it.
    expect(result.ignored).toEqual(['Standard', 'Standard$0']);
    expect(named(t, 'Standard')!.vars.DIMTXT).toBe(0.2);
    expect(named(t, 'Standard$0')).toBeUndefined();

    const mech = named(t, 'Mech')!;
    expect(compareHandles(mech.handle, seed)).toBeGreaterThanOrEqual(0);
    const notes = t.tables.textStyles.get(mech.vars.DIMTXSTY as string)!;
    expect(notes.name).toBe('Notes');
    expect(t.tables.linetypes.get(mech.vars.DIMLTYPE as string)!.name).toBe('CENTER');
    const dot = t.blocks.get(mech.vars.DIMBLK as string)!;
    expect(dot.name).toBe('_DOT');
    expect(t.blockEntities(dot.handle)).toHaveLength(1);
    expect(dimStyleXdataVars(t, mech.xdata)).toEqual({ DIMJAG: 2 });
    expect(named(t, 'Mech$2')!.vars).toMatchObject({ DIMASZ: 5, DIMTXSTY: notes.handle });

    // A style whose text style the target has by name uses the target's.
    expect(named(t, 'Arch')!.vars.DIMTXSTY).toBeUndefined();
    const again = new ChangeSetBuilder(t);
    const twice = importDimStyles(again, t, copyDimStyles(source(), ['Mech']));
    expect(twice).toEqual({ added: [], ignored: ['Mech', 'Mech$2'] });
  });

  it('DIMSTYLE’s Import... brings them in as one undo step and opens on the first', async () => {
    const t = target();
    const bus = new PromptBus({ model: t, registry: builtinCommands() });
    const request = () => {
      const p = bus.prompt;
      if (p?.kind !== 'dialog' || p.dialog.type !== 'dimstyle') throw new Error('no manager');
      return p.dialog as DimStyleRequest;
    };
    await bus.submit('DIMSTYLE');
    await bus.answer({
      kind: 'dialog',
      action: 'apply',
      dimstyle: { op: 'import', styles: copyDimStyles(source(), ['Mech', 'Standard']) },
    });
    expect(request().selected).toBe('Mech');
    expect(request().note).toBe(
      'Dimension styles already in the drawing: Standard, Standard$0. Duplicate definitions were ignored.',
    );
    expect(request().styles.map((s) => s.name)).toEqual(['ISO-25', 'Mech', 'Mech$2', 'Standard']);
    // Nothing usable sent: nothing happens.
    await bus.answer({
      kind: 'dialog',
      action: 'apply',
      dimstyle: { op: 'import', styles: { nonsense: true } as never },
    });
    expect(request().styles).toHaveLength(4);
    await bus.answer({ kind: 'dialog', action: 'ok' });
    await bus.submit('U');
    expect(named(t, 'Mech')).toBeUndefined();
    expect([...t.tables.textStyles.values()].map((s) => s.name)).toEqual(['Standard']);
  });
});
