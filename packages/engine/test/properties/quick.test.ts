// M2-35 part 16: Quick Properties (AutoCAD 2024 Help, "Quick Properties Palette", "QPMODE").
// The palette shows a short list of the selected objects' properties: Color, Layer and Linetype
// for every object, and a few of each type's own. AutoCAD's lists live in its CUI file, which
// Help does not reproduce, so Triya's are its own choice (`QUICK_PROPERTIES`).
import { describe, expect, it } from 'vitest';
import {
  EngineSession,
  QUICK_PROPERTIES,
  hasQuickProperties,
  propertySheet,
  quickPropertySheet,
  type CommandOutput,
  type PropertySheet,
} from '../../src/index';
import { entityInit, sampleInit, sampleModel } from '../model/fixtures';

const labels = (sheet: PropertySheet | undefined) =>
  sheet?.sections.flatMap((s) => s.rows.map((r) => r.label));

describe('quickPropertySheet', () => {
  const model = sampleModel();

  it('shows Color, Layer and Linetype, then the type’s own rows, without sections', () => {
    const quick = quickPropertySheet(propertySheet(model, [model.entityByHandle('20')!.id]));
    expect(quick?.sections).toHaveLength(1);
    expect(labels(quick)).toEqual(['Color', 'Layer', 'Linetype', 'Length', 'Angle']);
    expect(quick?.count).toBe(1);
    const circle = quickPropertySheet(propertySheet(model, [model.entityByHandle('21')!.id]));
    expect(labels(circle)).toEqual([
      'Color',
      'Layer',
      'Linetype',
      'Radius',
      'Diameter',
      'Circumference',
      'Area',
    ]);
  });

  it('shows the rows every type has for several types, and a type’s own once narrowed', () => {
    const ids = ['20', '21', '23'].map((h) => model.entityByHandle(h)!.id);
    const all = quickPropertySheet(propertySheet(model, ids));
    expect(labels(all)).toEqual(['Color', 'Layer', 'Linetype']);
    expect(all?.types.map((t) => t.count)).toEqual([2, 1]);
    const lines = quickPropertySheet(propertySheet(model, ids, 'LINE'));
    expect(lines?.filter).toBe('LINE');
    expect(labels(lines)).toEqual(['Color', 'Layer', 'Linetype', 'Length', 'Angle']);
  });

  it('shows nothing with nothing selected: the current settings stay the palette’s', () => {
    expect(quickPropertySheet(propertySheet(model, []))).toBeUndefined();
  });

  it('lists types whose own rows it shows; others show General’s three', () => {
    expect(hasQuickProperties('LINE')).toBe(true);
    expect(hasQuickProperties('XLINE')).toBe(false);
    expect(QUICK_PROPERTIES.TEXT).toContain('contents');
  });
});

describe('EngineSession quick properties', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('sends quick sheets while Quick Properties asks for them, and none with nothing selected', async () => {
    const init = sampleInit();
    const se = new EngineSession({
      ...init,
      entities: [
        ...(init.entities ?? []),
        entityInit('25', { kind: 'XLINE', base: { x: 0, y: 0 }, direction: { x: 1, y: 0 } }),
      ],
    });
    const out: CommandOutput[] = [];
    se.onCommand((o) => out.push(o));
    const sheets = () =>
      out.filter(
        (o): o is Extract<CommandOutput, { type: 'properties' }> => o.type === 'properties',
      );
    await se.command({ kind: 'properties', open: true, quick: true });
    // Nothing selected: an empty quick sheet, which Quick Properties does not show.
    expect(sheets().at(-1)!.sheet.count).toBe(0);
    expect(sheets().at(-1)!.sheet.current).toBeUndefined();
    await se.command({ kind: 'select-all' });
    await flush();
    const quick = sheets().at(-1)!.sheet;
    expect(quick.count).toBe(4);
    expect(labels(quick)).toEqual(['Color', 'Layer', 'Linetype']);
    await se.command({ kind: 'properties', open: true, quick: true, filter: 'CIRCLE' });
    expect(labels(sheets().at(-1)!.sheet)).toContain('Radius');
    // An edit through Quick Properties is the palette's edit: one undo step.
    await se.command({ kind: 'property', edit: { key: 'radius', value: '4' } });
    await flush();
    expect(
      sheets()
        .at(-1)!
        .sheet.sections[0]!.rows.find((r) => r.key === 'radius')?.value,
    ).toBe(4);
    // The Properties palette asks for the whole sheet again: all four objects' General.
    await se.command({ kind: 'properties', open: true });
    const whole = sheets().at(-1)!.sheet;
    expect(whole.sections[0]!.title).toBe('General');
    expect(labels(whole)).toContain('Linetype scale');
  });
});
