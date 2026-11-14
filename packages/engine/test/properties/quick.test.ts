// M2-35 part 16: Quick Properties (AutoCAD 2024 Help, "Quick Properties Palette", "QPMODE").
// The palette shows a short list of the selected objects' properties: Color, Layer and Linetype
// for every object, and a few of each type's own. AutoCAD's lists live in its CUI file, which
// Help does not reproduce, so Triya's are its own choice (`QUICK_PROPERTIES`).
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  EngineSession,
  PromptBus,
  QUICK_PROPERTIES,
  ROLLOVER_PROPERTIES,
  builtinCommands,
  hasQuickProperties,
  propertySheet,
  quickPropertySheet,
  rolloverSheet,
  type CommandOutput,
  type EntityId,
  type PropertySheet,
  type ViewRequest,
} from '../../src/index';
import { LAYER_WALLS, entityInit, sampleInit, sampleModel } from '../model/fixtures';

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

// M2-35 part 21: rollover tooltips (AutoCAD 2024 Help, "ROLLOVERTIPS (System Variable)": the
// properties an object under the cursor shows in a tooltip; the CUI's Rollover Tooltips list
// them, its General entry Color, Layer and Linetype).
describe('rolloverSheet', () => {
  const model = sampleModel();

  it('shows one object’s Color, Layer and Linetype under its type’s name', () => {
    const circle = model.entityByHandle('21')!;
    const tip = rolloverSheet(model, circle.id);
    expect(tip?.count).toBe(1);
    expect(tip?.sections).toHaveLength(1);
    expect(tip?.sections[0]!.title).toBe('Circle');
    expect(labels(tip)).toEqual(['Color', 'Layer', 'Linetype']);
    expect(tip?.sections[0]!.rows.find((r) => r.key === 'layer')?.value).toBe(LAYER_WALLS);
    expect(ROLLOVER_PROPERTIES).toEqual(['color', 'layer', 'linetype']);
    // A tooltip offers no choices: a choice keeps only the option naming its value.
    const layer = tip?.sections[0]!.rows.find((r) => r.key === 'layer');
    expect(layer?.options?.map((o) => o.value)).toEqual([String(LAYER_WALLS)]);
    expect(layer?.options?.[0]?.label).toBe('WALLS');
    expect(tip?.colorBooks).toBeUndefined();
  });

  it('shows nothing for an object that is gone', () => {
    expect(rolloverSheet(model, 99999 as EntityId)).toBeUndefined();
  });
});

describe('EngineSession rollover', () => {
  it('answers the object under the cursor with its tooltip, leaving the selection alone', async () => {
    const se = new EngineSession(sampleInit());
    const out: CommandOutput[] = [];
    se.onCommand((o) => out.push(o));
    const line = se.model.entityByHandle('20')!.id;
    await se.command({ kind: 'rollover', id: line });
    const tip = out.find(
      (o): o is Extract<CommandOutput, { type: 'rollover' }> => o.type === 'rollover',
    );
    expect(tip?.id).toBe(line);
    expect(tip?.sheet?.sections[0]!.title).toBe('Line');
    expect(out.some((o) => o.type === 'selection' || o.type === 'properties')).toBe(false);
    await se.command({ kind: 'rollover', id: 99999 as EntityId });
    expect(out.at(-1)).toEqual({ type: 'rollover', id: 99999 });
  });
});

// AutoCAD 2024 Help, "QUICKPROPERTIES (Command)": "Displays quick properties data for selected
// objects", whatever QPMODE says: the objects selected, or those picked at "Select objects".
describe('QUICKPROPERTIES', () => {
  function setup() {
    const model = DocumentModel.create(sampleInit());
    const requests: ViewRequest[] = [];
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: {
        request: (r) => {
          requests.push(r);
          return Promise.resolve({ ok: true });
        },
      },
    });
    return { model, bus, requests };
  }

  it('shows Quick Properties for the objects selected, keeping them selected', async () => {
    const s = setup();
    await s.bus.selectAll();
    const selected = s.bus.selection;
    expect(selected.length).toBeGreaterThan(0);
    await s.bus.submit('QUICKPROPERTIES');
    expect(s.requests).toEqual([{ op: 'palette', palette: 'quick', open: true }]);
    expect(s.bus.selection).toEqual(selected);
    expect(s.bus.promptText).toBe('Command:');
  });

  it('asks for objects when none are selected, and leaves those picked selected', async () => {
    const s = setup();
    await s.bus.submit('QUICKPROPERTIES');
    expect(s.bus.promptText).toBe('Select objects:');
    await s.bus.submit('ALL');
    await s.bus.submit('');
    expect(s.requests).toEqual([{ op: 'palette', palette: 'quick', open: true }]);
    const all = setup();
    await all.bus.selectAll();
    expect(s.bus.selection).toEqual(all.bus.selection);
    expect(s.bus.selection.length).toBeGreaterThan(0);
  });

  it('shows nothing when no object is picked', async () => {
    const s = setup();
    await s.bus.submit('QUICKPROPERTIES');
    await s.bus.submit('');
    expect(s.requests).toEqual([]);
    expect(s.bus.selection).toEqual([]);
  });
});
