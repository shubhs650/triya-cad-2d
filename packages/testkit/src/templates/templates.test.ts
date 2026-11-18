// M5-10: the bundled drawing templates (assets/templates, written by
// scripts/templates/build-templates.py; UI_SPEC.md §9, DEC-024, DEC-074). Each opens in acad-ts
// and in Triya with what §9 lists: the layers, the drafting linetypes from the bundled .lin
// files, the text styles drawn by bundled fonts, the dimension styles, and a layout per sheet
// with its border, a 1:1 viewport, the title block and the revision table carrying their
// attributes. Each round-trips with no structural difference, and CI's ezdxf audit reads the
// template as bundled (kind `template`) and a new drawing made from it, drawn in, its title
// block filled in and saved (kind `new`; audit.py `FIXTURE_SAVES`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EngineSession,
  PromptBus,
  builtinCommands,
  modelSpaceOf,
  type DocumentModel,
  type InsertGeometry,
} from '@triya/engine';
import { ACadVersion } from '@node-projects/acad-ts';
import { openDocument, readCadDocument } from '@triya/io';
import { SHX_EQUIVALENTS } from '@triya/text';
import { describe, expect, it } from 'vitest';
import { saveAc1032Dxf, writeAuditSave } from '../dxf-audit/saves';
import { roundTrip } from '../roundtrip/roundtrip';

const root = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const bytesOf = (path: string) => new Uint8Array(readFileSync(root(path)));

interface Expected {
  readonly path: string;
  readonly lin: string;
  readonly insunits: number;
  readonly measurement: number;
  readonly sheets: readonly (readonly [string, number, number])[];
  readonly paperUnits: 'mm' | 'inches';
  readonly dimstyles: readonly (readonly [string, number])[];
  readonly dimtxt: number;
}

const TEMPLATES: readonly Expected[] = [
  {
    path: 'assets/templates/triya-iso.dxf',
    lin: 'assets/linetypes/triya-drafting-iso.lin',
    insunits: 4,
    measurement: 1,
    sheets: [
      ['A4', 297, 210],
      ['A3', 420, 297],
      ['A2', 594, 420],
      ['A1', 841, 594],
      ['A0', 1189, 841],
    ],
    paperUnits: 'mm',
    dimstyles: [
      ['ISO-25', 1],
      ['ISO-25-5', 5],
      ['ISO-25-10', 10],
      ['ISO-25-20', 20],
      ['ISO-25-50', 50],
    ],
    dimtxt: 2.5,
  },
  {
    path: 'assets/templates/triya-ansi.dxf',
    lin: 'assets/linetypes/triya-drafting.lin',
    insunits: 1,
    measurement: 0,
    sheets: [
      ['A', 11, 8.5],
      ['B', 17, 11],
      ['C', 22, 17],
      ['D', 34, 22],
      ['E', 44, 34],
    ],
    paperUnits: 'inches',
    dimstyles: [
      ['ANSI-DEC', 1],
      ['ANSI-DEC-2', 2],
      ['ANSI-DEC-4', 4],
      ['ANSI-DEC-8', 8],
      ['ANSI-DEC-16', 16],
    ],
    dimtxt: 0.125,
  },
];

/** UI_SPEC.md §9's layers: colour, linetype, lineweight (1/100 mm, -3 default), plotted. */
const LAYERS: readonly (readonly [string, number, string, number, boolean])[] = [
  ['0', 7, 'CONTINUOUS', -3, true],
  ['Defpoints', 7, 'CONTINUOUS', -3, false],
  ['CENTER', 1, 'CENTER2', -3, true],
  ['HIDDEN', 2, 'HIDDEN2', -3, true],
  ['DIMENSIONS', 3, 'CONTINUOUS', -3, true],
  ['TEXT', 7, 'CONTINUOUS', -3, true],
  ['HATCH', 8, 'CONTINUOUS', -3, true],
  ['TITLE', 7, 'CONTINUOUS', 50, true],
  ['VIEWPORT', 7, 'CONTINUOUS', -3, false],
  ['NOTES', 7, 'CONTINUOUS', -3, true],
  ['REVISION', 6, 'CONTINUOUS', -3, true],
];

const TITLE_TAGS = [
  'PROJECT',
  'CLIENT',
  'TITLE',
  'DRAWN',
  'CHECKED',
  'APPROVED',
  'DATE',
  'DWGNO',
  'REV',
  'SCALE',
  'SHEET',
];
const REVISION_TAGS = [1, 2, 3, 4].flatMap((n) => ['REV', 'DESC', 'DATE', 'BY'].map((c) => c + n));

/** The dashes and gaps of each linetype of a .lin file. */
function linPatterns(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.startsWith('*')) return;
    const name = line.slice(1).split(',')[0]!.toUpperCase();
    out.set(name, lines[i + 1]!.split(',').slice(1).map(Number));
  });
  return out;
}

const modelOf = (bytes: Uint8Array): DocumentModel =>
  new EngineSession(openDocument(readCadDocument(bytes)).init).model;

const inserts = (model: DocumentModel, block: string) =>
  model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .filter((e) => e.geom.kind === 'INSERT')
    .map((e) => ({ layer: e.layer, geom: e.geom as InsertGeometry }));

const recordName = (model: DocumentModel, handle: string) =>
  model.tables.blockRecords.get(handle)?.name;

describe.each(TEMPLATES)('the bundled template $path (M5-10)', (t) => {
  const bytes = bytesOf(t.path);

  it('is an AC1032 DXF in the template’s units', () => {
    const doc = readCadDocument(bytes);
    expect(doc.header?.version).toBe(ACadVersion.AC1032);
    const model = modelOf(bytes);
    expect(model.header.get('$INSUNITS')).toBe(t.insunits);
    expect(model.header.get('$MEASUREMENT')).toBe(t.measurement);
    expect(model.header.get('$DIMSTYLE')).toBe(t.dimstyles[0]![0]);
    expect(model.header.get('$DIMTXT')).toBe(t.dimtxt);
    expect(model.header.get('$CLAYER')).toBe('0');
  });

  it('has UI_SPEC §9’s layers, and the drafting linetypes of the bundled .lin file', () => {
    const model = modelOf(bytes);
    const linetypes = [...model.tables.linetypes.values()];
    const linetypeName = (h: string) => linetypes.find((l) => l.handle === h)?.name.toUpperCase();
    const layers = [...model.tables.layers.values()].map((l) => [
      l.name,
      l.color.kind === 'aci' ? l.color.index : l.color,
      linetypeName(l.linetype),
      l.lineweight === 'Default' ? -3 : l.lineweight,
      l.plot,
    ]);
    expect(layers).toEqual(LAYERS);

    const lin = linPatterns(readFileSync(root(t.lin), 'utf8'));
    for (const name of ['CENTER2', 'HIDDEN2']) {
      const lt = linetypes.find((l) => l.name === name)!;
      expect(lt.elements.map((e) => e.length)).toEqual(lin.get(name));
    }
  });

  it('has text styles every one of which a bundled font draws, and its dimension styles', () => {
    const model = modelOf(bytes);
    const styles = [...model.tables.textStyles.values()].map((s) => [s.name, s.font]);
    expect(styles).toEqual([
      ['Standard', 'simplex.shx'],
      ['ROMANS', 'romans.shx'],
      ['ISOCP', 'isocp.shx'],
      ['Arial', 'arial.ttf'],
    ]);
    for (const [, font] of styles.slice(0, 3))
      expect(SHX_EQUIVALENTS[font!.replace(/\.shx$/, '')]).toBe('oet-simplex');

    const dims = [...model.tables.dimStyles.values()];
    for (const [name, scale] of t.dimstyles) {
      const d = dims.find((s) => s.name === name);
      expect(d, name).toBeDefined();
      expect(d!.vars.DIMSCALE).toBe(scale);
      expect(d!.vars.DIMTXT).toBe(t.dimtxt);
    }
  });

  it('has a layout per sheet: its paper, border, 1:1 viewport, title block and revision table', () => {
    const model = modelOf(bytes);
    const sheets = model.layouts.filter((l) => l.name !== 'Model');
    expect(sheets.map((l) => l.name)).toEqual(t.sheets.map(([n]) => n));
    const k = t.paperUnits === 'mm' ? 1 : 25.4;
    sheets.forEach((layout, i) => {
      const [, w, h] = t.sheets[i]!;
      const plot = layout.plot!;
      expect(plot.paperUnits).toBe(t.paperUnits === 'mm' ? 'millimeters' : 'inches');
      expect(plot.paperWidth / k).toBeCloseTo(w, 6);
      expect(plot.paperHeight / k).toBeCloseTo(h, 6);
      expect(plot.paperSize).toContain(`_full_bleed_${layout.name}_`);

      const geoms = model.blockEntities(layout.blockRecord).map((id) => model.entity(id)!);
      const viewports = geoms.filter((e) => e.geom.kind === 'VIEWPORT');
      // The sheet's own viewport and the one AutoCAD numbers 1, the paper itself.
      const frame = viewports.find((e) => model.tables.layers.get(e.layer)?.name === 'VIEWPORT');
      expect(frame, layout.name).toBeDefined();

      const refs = inserts(model, layout.blockRecord);
      const title = refs.find((r) => recordName(model, r.geom.block) === 'TRIYA-TITLE-BLOCK')!;
      const table = refs.find((r) => recordName(model, r.geom.block) === 'TRIYA-REVISION-TABLE')!;
      expect(title.geom.attributes.map((a) => a.tag)).toEqual(TITLE_TAGS);
      expect(title.geom.attributes.find((a) => a.tag === 'SCALE')!.value).toBe('1:1');
      expect(table.geom.attributes.map((a) => a.tag)).toEqual(REVISION_TAGS);
      // Both in the border's lower-right corner, the table on the title block.
      expect(title.geom.position.x).toBeCloseTo(w - (t.paperUnits === 'mm' ? 10 : 0.5), 9);
      expect(table.geom.position.x).toBeCloseTo(title.geom.position.x, 9);
      expect(table.geom.position.y).toBeGreaterThan(title.geom.position.y);
    });
  });

  it('round-trips with no structural difference', () => {
    const r = roundTrip(bytes);
    expect(r.error).toBeUndefined();
    expect(r.summary?.total ?? 0).toBe(0);
    expect(r.status).toBe('clean');
  });

  it('makes a new drawing that is drawn in, has its title block filled in and saves', async () => {
    writeAuditSave(t.path, 'template', () => bytes);
    const model = modelOf(bytes);
    const bus = new PromptBus({
      model,
      registry: builtinCommands(),
      view: { request: () => Promise.resolve({ ok: false, message: '' }) },
    });
    await bus.script(['LINE', '0,0', '100,50', '']);
    await bus.script(['CLAYER', 'CENTER']);
    await bus.script(['CIRCLE', '50,25', '10']);
    // The title block's TITLE in the first layout, as -ATTEDIT edits one attribute.
    const first = model.layouts.find((l) => l.name === t.sheets[0]![0])!;
    const title = model.blockEntities(first.blockRecord).find((id) => {
      const g = model.entity(id)!.geom;
      return g.kind === 'INSERT' && recordName(model, g.block) === 'TRIYA-TITLE-BLOCK';
    })!;
    const { ChangeSetBuilder } = await import('@triya/engine');
    const b = new ChangeSetBuilder(model);
    const geom = model.entity(title)!.geom as InsertGeometry;
    b.updateEntity(title, {
      geom: {
        ...geom,
        attributes: geom.attributes.map((a) =>
          a.tag === 'TITLE' ? { ...a, value: 'BRACKET ASSEMBLY' } : a,
        ),
      },
    });
    model.apply(b.build());
    expect(bus.command).toBeUndefined();

    const out = saveAc1032Dxf(readCadDocument(bytes), model);
    writeAuditSave(t.path, 'new', () => out);
    const back = modelOf(out);
    const drawn = back.blockEntities(modelSpaceOf(back)).map((id) => back.entity(id)!);
    expect(drawn.map((e) => e.geom.kind)).toEqual(['LINE', 'CIRCLE']);
    const layer = back.tables.layers.get(drawn[1]!.layer)!;
    expect(layer.name).toBe('CENTER');
    const backFirst = back.layouts.find((l) => l.name === t.sheets[0]![0])!;
    const filled = inserts(back, backFirst.blockRecord).find(
      (r) => recordName(back, r.geom.block) === 'TRIYA-TITLE-BLOCK',
    )!;
    expect(filled.geom.attributes.find((a) => a.tag === 'TITLE')!.value).toBe('BRACKET ASSEMBLY');
  });
});
