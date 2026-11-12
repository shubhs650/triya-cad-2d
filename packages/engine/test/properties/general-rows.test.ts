// M2-35 part 6: General's other rows as AutoCAD 2024's Properties palette lists them (Color,
// Layer, Linetype, Linetype scale, Plot style, Lineweight, Transparency, Hyperlink, Thickness)
// and the 3D Visualization group's Material. Plot style is ByColor and read only in a
// colour-dependent drawing ($PSTYLEMODE 1, AutoCAD's default) and a choice of the drawing's
// plot style names in a named one; Hyperlink is the entity's PE_URL xdata (the URL first, as
// AutoCAD and ezdxf write it); Thickness is DXF 39 on the objects that have one.
import { describe, expect, it } from 'vitest';
import {
  DocumentModel,
  PromptBus,
  builtinCommands,
  propertySheet,
  type BusEvent,
  type DocumentInit,
  type Entity,
  type EntityGeometry,
  type HeaderValue,
  type PropertyRow,
  type PropertySheet,
} from '../../src/index';
import {
  LAYER_0,
  circleGeom,
  entityInit,
  layer,
  lineGeom,
  record,
  sampleInit,
} from '../model/fixtures';

const ellipseGeom: EntityGeometry = {
  kind: 'ELLIPSE',
  center: { x: 0, y: 0 },
  majorAxis: { x: 4, y: 0 },
  ratio: 0.5,
  startParam: 0,
  endParam: 2 * Math.PI,
} as EntityGeometry;

const PE_URL = '60';
const ACAD = '61';

/** The sample drawing with materials, plot style names and the hyperlinked line 25. */
function init(named: boolean, extra: DocumentInit['entities'] = []): DocumentInit {
  const base = sampleInit();
  const header = new Map<string, HeaderValue>(base.header);
  header.set('$PSTYLEMODE', named ? 0 : 1);
  return {
    ...base,
    header,
    tables: {
      ...base.tables,
      layers: [...(base.tables?.layers ?? []), { ...layer('12', 'LOCKED'), locked: true }],
      appIds: [record(ACAD, 'ACAD'), ...(named ? [record(PE_URL, 'PE_URL')] : [])],
      materials: [record('70', 'ByLayer'), record('71', 'ByBlock'), record('72', 'Global')],
      plotStyles: named ? [record('80', 'Normal'), record('81', 'Heavy')] : [],
    },
    entities: [
      ...(base.entities ?? []),
      entityInit('25', lineGeom(0, 5, 10, 5), {
        material: '72',
        ...(named && {
          plotStyle: '81',
          xdata: [
            {
              appId: PE_URL,
              values: [
                { code: 1000, value: 'https://example.com/a' },
                { code: 1002, value: '{' },
                { code: 1000, value: 'Detail A' },
                { code: 1002, value: '}' },
              ],
            },
          ],
        }),
      }),
      entityInit('26', ellipseGeom),
      ...extra,
    ],
  };
}

function setup(named = true, extra: DocumentInit['entities'] = []) {
  const model = DocumentModel.create(init(named, extra));
  const bus = new PromptBus({ model, registry: builtinCommands() });
  const log: string[] = [];
  bus.on((e: BusEvent) => {
    if (e.type === 'log') log.push(e.line);
  });
  const byHandle = (h: string): Entity => model.entityByHandle(h)!;
  const ids = (...hs: string[]) => hs.map((h) => byHandle(h).id);
  const sheet = (...hs: string[]) => propertySheet(model, ids(...hs));
  return { model, bus, log, byHandle, ids, sheet };
}

const rowOf = (sheet: PropertySheet, label: string): PropertyRow | undefined => {
  for (const s of sheet.sections) {
    const r = s.rows.find((x) => x.label === label);
    if (r) return r;
  }
  return undefined;
};
const labels = (sheet: PropertySheet, title: string) =>
  sheet.sections.find((s) => s.title === title)?.rows.map((r) => r.label);
const titles = (sheet: PropertySheet) => sheet.sections.map((s) => s.title);
const url = (e: Entity, model: DocumentModel) =>
  e.xdata?.find((a) => model.tables.appIds.get(a.appId)?.name === 'PE_URL')?.values;

describe('General’s rows and 3D Visualization', () => {
  it('lists General in AutoCAD’s order, then 3D Visualization before the type’s sections', () => {
    const s = setup();
    const sheet = s.sheet('20');
    expect(labels(sheet, 'General')).toEqual([
      'Color',
      'Layer',
      'Linetype',
      'Linetype scale',
      'Plot style',
      'Lineweight',
      'Transparency',
      'Hyperlink',
      'Thickness',
    ]);
    expect(titles(sheet)).toEqual(['General', '3D Visualization', 'Geometry']);
    expect(labels(sheet, '3D Visualization')).toEqual(['Material']);
  });

  it('shows Plot style as ByColor, read only, in a colour-dependent drawing', () => {
    const s = setup(false);
    expect(rowOf(s.sheet('20', '25'), 'Plot style')).toMatchObject({
      value: 'ByColor',
      readOnly: true,
    });
  });

  it('offers ByLayer and the drawing’s plot style names in a named-plot-style drawing', () => {
    const s = setup();
    const r = rowOf(s.sheet('20'), 'Plot style')!;
    expect(r).toMatchObject({ kind: 'choice', value: 'ByLayer' });
    expect(r.readOnly).toBeUndefined();
    expect(r.options).toEqual([
      { value: 'ByLayer', label: 'ByLayer' },
      { value: '80', label: 'Normal' },
      { value: '81', label: 'Heavy' },
    ]);
    expect(rowOf(s.sheet('25'), 'Plot style')!.value).toBe('81');
    expect(rowOf(s.sheet('20', '25'), 'Plot style')!.varies).toBe(true);
  });

  it('shows the hyperlink’s URL, empty when there is none', () => {
    const s = setup();
    expect(rowOf(s.sheet('25'), 'Hyperlink')).toMatchObject({
      kind: 'text',
      value: 'https://example.com/a',
      clearable: true,
    });
    expect(rowOf(s.sheet('20'), 'Hyperlink')).toMatchObject({ value: '' });
    expect(rowOf(s.sheet('20', '25'), 'Hyperlink')!.varies).toBe(true);
  });

  it('shows Thickness only when every object has one', () => {
    const s = setup(true, [
      entityInit('27', { ...(circleGeom(1, 1, 1) as object), thickness: 3 } as EntityGeometry),
    ]);
    expect(rowOf(s.sheet('27'), 'Thickness')).toMatchObject({ kind: 'distance', value: 3 });
    expect(rowOf(s.sheet('20', '27'), 'Thickness')!.varies).toBe(true);
    // An ellipse has no thickness (DXF ELLIPSE has no group 39).
    expect(rowOf(s.sheet('26'), 'Thickness')).toBeUndefined();
    expect(rowOf(s.sheet('20', '26'), 'Thickness')).toBeUndefined();
  });

  it('shows Material by name with ByLayer for none, and only where the drawing has materials', () => {
    const s = setup();
    const r = rowOf(s.sheet('20'), 'Material')!;
    expect(r).toMatchObject({ kind: 'choice', value: 'ByLayer' });
    expect(r.options).toEqual([
      { value: 'ByLayer', label: 'ByLayer' },
      { value: '71', label: 'ByBlock' },
      { value: '72', label: 'Global' },
    ]);
    expect(rowOf(s.sheet('25'), 'Material')!.value).toBe('72');
    // Mixed types show it too, as AutoCAD does.
    expect(titles(s.sheet('20', '21'))).toEqual(['General', '3D Visualization']);
    // A drawing before R2007 has no materials, so no 3D Visualization.
    const bare = sampleInit();
    const model = DocumentModel.create(bare);
    const sheet = propertySheet(model, [model.entityByHandle('20')!.id]);
    expect(titles(sheet)).toEqual(['General', 'Geometry']);
  });

  it('keeps the six current settings only when nothing is selected', () => {
    const s = setup();
    expect(labels(propertySheet(s.model, []), 'General')).toEqual([
      'Color',
      'Layer',
      'Linetype',
      'Linetype scale',
      'Lineweight',
      'Transparency',
    ]);
  });
});

describe('editing General’s other rows and Material', () => {
  it('sets a plot style name and ByLayer, as one undo step each', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'plotStyle', value: '80' }, 'LINE');
    expect(s.byHandle('20').plotStyle).toBe('80');
    expect(s.byHandle('25').plotStyle).toBe('80');
    expect(s.byHandle('21').plotStyle).toBeUndefined();
    await s.bus.setProperty({ key: 'plotStyle', value: 'ByLayer' }, 'LINE');
    expect('plotStyle' in s.byHandle('25')).toBe(false);
    expect(s.bus.undo.state.undoable).toBe(2);
    await s.bus.submit('U');
    expect(s.byHandle('25').plotStyle).toBe('80');
  });

  it('refuses a plot style the drawing lacks, and any in a colour-dependent drawing', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'plotStyle', value: '99' });
    const c = setup(false);
    await c.bus.selectAll();
    await c.bus.setProperty({ key: 'plotStyle', value: 'ByLayer' });
    expect(s.log).toContain('Invalid input.');
    expect(c.log).toContain('Invalid input.');
    expect(s.bus.undo.state.undoable).toBe(0);
    expect(c.bus.undo.state.undoable).toBe(0);
  });

  it('sets a material, ByLayer taking the material off', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'material', value: '71' });
    expect(s.byHandle('20').material).toBe('71');
    expect(s.byHandle('26').material).toBe('71');
    await s.bus.setProperty({ key: 'material', value: 'ByLayer' });
    expect('material' in s.byHandle('25')).toBe(false);
    // The ByLayer material by handle is the same as ByLayer.
    await s.bus.setProperty({ key: 'material', value: '72' });
    await s.bus.setProperty({ key: 'material', value: '70' });
    expect('material' in s.byHandle('20')).toBe(false);
    await s.bus.setProperty({ key: 'material', value: '99' });
    expect(s.log).toContain('Invalid input.');
  });

  it('sets a hyperlink’s URL, keeping its description, and registers PE_URL when new', async () => {
    const s = setup(false);
    expect([...s.model.tables.appIds.values()].map((a) => a.name)).toEqual(['ACAD']);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'hyperlink', value: 'https://example.com/b' }, 'LINE');
    const app = [...s.model.tables.appIds.values()].find((a) => a.name === 'PE_URL');
    expect(app).toBeDefined();
    expect(url(s.byHandle('20'), s.model)).toEqual([
      { code: 1000, value: 'https://example.com/b' },
    ]);
    expect(url(s.byHandle('21'), s.model)).toBeUndefined();
    expect(s.bus.undo.state.undoable).toBe(1);
    await s.bus.submit('U');
    expect(s.byHandle('20').xdata).toBeUndefined();
    expect([...s.model.tables.appIds.values()].map((a) => a.name)).toEqual(['ACAD']);

    const n = setup();
    await n.bus.selectAll();
    await n.bus.setProperty({ key: 'hyperlink', value: '  https://example.com/c ' }, 'LINE');
    expect(url(n.byHandle('25'), n.model)).toEqual([
      { code: 1000, value: 'https://example.com/c' },
      { code: 1002, value: '{' },
      { code: 1000, value: 'Detail A' },
      { code: 1002, value: '}' },
    ]);
    expect(n.model.tables.appIds.size).toBe(2);
  });

  it('takes a hyperlink off with an empty value, keeping other applications’ xdata', async () => {
    const s = setup(true, [
      entityInit('27', lineGeom(0, 0, 1, 1), {
        xdata: [
          { appId: ACAD, values: [{ code: 1000, value: 'kept' }] },
          { appId: PE_URL, values: [{ code: 1000, value: 'https://example.com/d' }] },
        ],
      }),
    ]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'hyperlink', value: '' }, 'LINE');
    expect(s.byHandle('25').xdata).toBeUndefined();
    expect(s.byHandle('27').xdata).toEqual([
      { appId: ACAD, values: [{ code: 1000, value: 'kept' }] },
    ]);
    // A URL longer than xdata's 255 characters is refused.
    await s.bus.setProperty({ key: 'hyperlink', value: `https://${'x'.repeat(250)}` });
    expect(s.log).toContain('Invalid input.');
  });

  it('sets Thickness on the objects that have one, 0 taking it off', async () => {
    const s = setup();
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'thickness', value: '2.5' }, 'LINE');
    expect((s.byHandle('20').geom as { thickness?: number }).thickness).toBe(2.5);
    expect((s.byHandle('23').geom as { thickness?: number }).thickness).toBe(2.5);
    await s.bus.setProperty({ key: 'thickness', value: '-1' }, 'CIRCLE');
    expect((s.byHandle('21').geom as { thickness?: number }).thickness).toBe(-1);
    await s.bus.setProperty({ key: 'thickness', value: '0' }, 'LINE');
    expect('thickness' in s.byHandle('20').geom).toBe(false);
    await s.bus.setProperty({ key: 'thickness', value: 'thick' }, 'LINE');
    expect(s.log).toContain('Invalid input.');
    expect(s.bus.undo.state.undoable).toBe(3);
  });

  it('leaves objects on a locked layer alone', async () => {
    const s = setup(true, [entityInit('27', lineGeom(0, 0, 1, 1), { layer: '12' })]);
    await s.bus.selectAll();
    await s.bus.setProperty({ key: 'hyperlink', value: 'https://example.com/e' }, 'LINE');
    expect(s.byHandle('27').xdata).toBeUndefined();
    expect(url(s.byHandle('20'), s.model)).toBeDefined();
    expect(s.byHandle('20').layer).toBe(LAYER_0);
  });
});
