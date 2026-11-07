// TriyaToAcad for APPID, UCS, VIEW and VPORT records (M1-75 part 10). The drawing is authored in
// memory with acad-ts and saved once, so "the file" is real bytes; the corpus-wide edits are in
// packages/testkit/src/export/export.corpus.test.ts.
import { ACadVersion, AppId, CadDocument, UCS, View, XY, XYZ } from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type ObjectCommon,
  type SymbolTableRecord,
  type UcsFrame,
  type UcsRecord,
  type ViewRecord,
  type VportRecord,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { same } from '../src/export/entities';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/** Application TRIYA_TEST, the UCS TILTED (rotated 90° about Z), the view PLAN and *Active. */
function drawing(version = ACadVersion.AC1032, format: CadFormat = 'dxf'): Uint8Array {
  const doc = new CadDocument(version);
  doc.appIds!.add(new AppId('TRIYA_TEST'));
  const tilted = new UCS('TILTED');
  tilted.origin = new XYZ(10, 20, 0);
  tilted.xAxis = new XYZ(0, 1, 0);
  tilted.yAxis = new XYZ(-1, 0, 0);
  doc.uCSs!.add(tilted);
  const plan = new View('PLAN');
  plan.center = new XY(50, 40);
  plan.height = 80;
  plan.width = 120;
  plan.direction = new XYZ(0, 0, 1);
  plan.lensLength = 50;
  doc.views!.add(plan);
  return writeCadDocument(doc, { format });
}

const open = (bytes: Uint8Array) => DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

type ViewTable = 'appIds' | 'ucs' | 'views' | 'vports';

const named = <T extends SymbolTableRecord>(
  model: DocumentModel,
  table: ViewTable,
  name: string,
): T =>
  [...(model.tables[table] as ReadonlyMap<string, T>).values()].find(
    (r) => r.name.toUpperCase() === name.toUpperCase(),
  )!;

/** Saves `model` over a fresh read of `bytes` and maps the result back. */
function saved(bytes: Uint8Array, model: DocumentModel, format: CadFormat) {
  return documentInit(readCadDocument(exportDocument(readCadDocument(bytes), model, { format })));
}

/** A record as it maps back, without the reader's link and the xdata the writer keeps. */
function comparable<T extends ObjectCommon>(r: T | undefined) {
  if (!r) return r;
  const { raw: _raw, xdata: _xdata, ...rest } = r;
  return rest;
}

/** A new record from an existing one, without its handle and links. */
function like<T extends ObjectCommon>(r: T): Omit<T, 'handle' | 'raw' | 'xdata'> {
  const { handle: _h, raw: _raw, xdata: _xdata, ...rest } = r;
  return rest;
}

function refusal(f: () => unknown): string[] {
  try {
    f();
  } catch (e) {
    if (e instanceof UnsupportedChangeError) return [...e.problems];
    throw e;
  }
  return [];
}

/** A UCS turned 90° about X: what the UCS command's X option makes. */
const frontFrame: UcsFrame = {
  origin: { x: 1, y: 2, z: 3 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 0, z: 1 },
  elevation: 4,
  orthographic: 3,
};

/** Every field each table maps, set to a value the drawing does not have. */
const FIELD_EDITS = {
  ucs: {
    origin: { origin: { x: 1, y: 2, z: 3 } },
    axes: { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 0, z: 1 } },
    elevation: { elevation: 4 },
    orthographic: { orthographic: 1 },
  },
  views: {
    center: { center: { x: 5, y: 6 } },
    height: { height: 7 },
    width: { width: 8 },
    direction: { direction: { x: 1, y: -1, z: 1 } },
    target: { target: { x: 1, y: 2, z: 3 } },
    lensLength: { lensLength: 35 },
    frontClip: { frontClip: 2 },
    backClip: { backClip: -3 },
    twist: { twist: 0.5 },
    'viewMode perspective': { viewMode: 1 },
    'viewMode front clip': { viewMode: 2 },
    'viewMode back clip': { viewMode: 4 },
    'viewMode front clip not at eye': { viewMode: 16 },
    renderMode: { renderMode: 3 },
    ucs: { ucs: frontFrame },
  },
  vports: {
    center: { center: { x: 5, y: 6 } },
    height: { height: 7 },
    direction: { direction: { x: 1, y: -1, z: 1 } },
    target: { target: { x: 1, y: 2, z: 3 } },
    lensLength: { lensLength: 35 },
    frontClip: { frontClip: 2 },
    backClip: { backClip: -3 },
    twist: { twist: 0.5 },
    'viewMode perspective': { viewMode: 1 },
    'viewMode front clip': { viewMode: 2 },
    'viewMode back clip': { viewMode: 4 },
    'viewMode follow UCS': { viewMode: 8 },
    'viewMode front clip not at eye': { viewMode: 16 },
    renderMode: { renderMode: 3 },
    corners: { lowerLeft: { x: 0, y: 0.5 }, upperRight: { x: 0.5, y: 1 } },
    aspectRatio: { aspectRatio: 2 },
    snapBase: { snapBase: { x: 1, y: 2 } },
    snapSpacing: { snapSpacing: { x: 0.25, y: 0.75 } },
    snapRotation: { snapRotation: 0.25 },
    snapOn: { snapOn: true },
    isometricSnap: { isometricSnap: true },
    isometricPlane: { isometricPlane: 2 },
    gridSpacing: { gridSpacing: { x: 5, y: 2.5 } },
    gridOn: { gridOn: false },
    gridFlags: { gridFlags: 4 },
    gridMajor: { gridMajor: 7 },
    circleZoom: { circleZoom: 500 },
    ucsIcon: { ucsIcon: 0 },
    ucs: { ucs: frontFrame },
  },
} as const satisfies Record<
  Exclude<ViewTable, 'appIds'>,
  Record<string, Partial<UcsRecord> | Partial<ViewRecord> | Partial<VportRecord>>
>;

const RECORD_OF = { ucs: 'TILTED', views: 'PLAN', vports: '*Active' } as const;

const SAVES: readonly [ACadVersion, CadFormat][] = [
  [ACadVersion.AC1009, 'dxf'],
  [ACadVersion.AC1014, 'dxf'],
  [ACadVersion.AC1014, 'dwg'],
  [ACadVersion.AC1015, 'dxf'],
  [ACadVersion.AC1015, 'dwg'],
  [ACadVersion.AC1018, 'dwg'],
  [ACadVersion.AC1021, 'dxf'],
  [ACadVersion.AC1024, 'dwg'],
  [ACadVersion.AC1032, 'dxf'],
  [ACadVersion.AC1032, 'dwg'],
];

/**
 * The field edits a save must refuse, as the format has no place for them (AutoCAD DXF reference
 * and ODA spec: AutoCAD 2000 brought the UCS elevation and orthographic type, a view's UCS and
 * the render mode, and a VPORT's UCS; AutoCAD 2007 the grid display flags and major lines).
 */
function refused(version: ACadVersion, table: string, field: string): boolean {
  const r2000 = version >= ACadVersion.AC1015;
  const r2007 = version >= ACadVersion.AC1021;
  if (table === 'ucs') return !r2000 && (field === 'elevation' || field === 'orthographic');
  if (field === 'ucs' || field === 'renderMode') return !r2000;
  if (table !== 'vports') return false;
  return (field === 'gridFlags' || field === 'gridMajor') && !r2007;
}

const formats: readonly CadFormat[] = ['dxf', 'dwg'];

describe('APPID, UCS, VIEW and VPORT records', () => {
  it.each(formats)('writes edited and new records (%s)', (format) => {
    const bytes = drawing(ACadVersion.AC1032, format);
    const model = open(bytes);
    const app = named(model, 'appIds', 'TRIYA_TEST');
    const tilted = named<UcsRecord>(model, 'ucs', 'TILTED');
    const plan = named<ViewRecord>(model, 'views', 'PLAN');
    const active = named<VportRecord>(model, 'vports', '*Active');
    const added: { table: ViewTable; handle: string }[] = [];
    edit(model, (b) => {
      b.updateTableRecord('appIds', app.handle, { name: 'TRIYA_MARKUP' });
      added.push({
        table: 'appIds',
        handle: b.addTableRecord('appIds', { name: 'TRIYA_NOTES' }).handle,
      });
      b.updateTableRecord('ucs', tilted.handle, {
        name: 'FRONT',
        ...frontFrame,
      });
      added.push({
        table: 'ucs',
        handle: b.addTableRecord('ucs', { ...like(tilted), name: 'SIDE', elevation: 2 }).handle,
      });
      // VIEW save: the view as it is now, with its UCS; a second one without.
      b.updateTableRecord('views', plan.handle, {
        center: { x: 12.5, y: -4 },
        height: 30,
        width: 45,
        twist: 0.25,
        target: { x: 1, y: 1, z: 0 },
        ucs: frontFrame,
      });
      added.push({
        table: 'views',
        handle: b.addTableRecord('views', {
          ...like(plan),
          name: 'DETAIL A',
          height: 5,
          width: 7.5,
        }).handle,
      });
      // The last view a save keeps, and VPORTS: two tiles that share the *Active name.
      b.updateTableRecord('vports', active.handle, {
        center: { x: 100, y: 50 },
        height: 25,
        aspectRatio: 1.6,
        upperRight: { x: 0.5, y: 1 },
        snapSpacing: { x: 0.25, y: 0.25 },
        gridSpacing: { x: 1, y: 1 },
        gridOn: true,
        snapOn: true,
        circleZoom: 2000,
        ucs: frontFrame,
      });
      added.push({
        table: 'vports',
        handle: b.addTableRecord('vports', {
          ...like(active),
          lowerLeft: { x: 0.5, y: 0 },
          upperRight: { x: 1, y: 1 },
          center: { x: 0, y: 0 },
          height: 60,
        }).handle,
      });
    });

    const back = saved(bytes, model, format).tables!;
    const check = (table: ViewTable, h: string) => {
      const got = (back[table] as readonly ObjectCommon[]).find((r) => r.handle === h);
      expect(comparable(got), `${table} ${h}`).toEqual(
        comparable(model.tables[table].get(h) as ObjectCommon),
      );
    };
    check('appIds', app.handle);
    check('ucs', tilted.handle);
    check('views', plan.handle);
    check('vports', active.handle);
    for (const { table, handle } of added) check(table, handle);
    expect(back.vports!.filter((v) => v.name.toUpperCase() === '*ACTIVE')).toHaveLength(2);
  });

  it.each(SAVES)(
    'writes every field %s %s, or refuses what the save cannot keep',
    (version, format) => {
      const bytes = drawing(version, format);
      const problems: string[] = [];
      for (const [table, edits] of Object.entries(FIELD_EDITS) as [
        Exclude<ViewTable, 'appIds'>,
        Record<string, object>,
      ][]) {
        for (const [field, patch] of Object.entries(edits)) {
          const model = open(bytes);
          const r = named(model, table, RECORD_OF[table]);
          edit(model, (b) => b.updateTableRecord(table, r.handle, patch as never));
          const what = `${table} ${field}`;
          if (refused(version, table, field)) {
            const out = refusal(() => triyaToAcad(readCadDocument(bytes), model, format));
            if (out.length === 0) problems.push(`${what} is not refused`);
            continue;
          }
          const back = saved(bytes, model, format).tables?.[table]?.find(
            (x) => x.handle === r.handle,
          );
          if (
            !same(comparable(back), comparable(model.tables[table].get(r.handle) as ObjectCommon))
          )
            problems.push(`${what} is not kept: ${JSON.stringify(comparable(back))}`);
        }
      }
      expect(problems).toEqual([]);
    },
  );

  it('refuses what it cannot write and leaves the original as it was', () => {
    const update =
      (table: ViewTable, name: string, change: object) => (b: ChangeSetBuilder, m: DocumentModel) =>
        b.updateTableRecord(table, named(m, table, name).handle, change as never);
    const cases: [(b: ChangeSetBuilder, m: DocumentModel) => void, RegExp][] = [
      [
        (b, m) => b.removeTableRecord('vports', named(m, 'vports', '*Active').handle),
        /the first \*Active viewport is the current one/,
      ],
      [
        (b, m) => b.removeTableRecord('appIds', named(m, 'appIds', 'ACAD').handle),
        /ACAD cannot be purged/,
      ],
      [update('appIds', 'ACAD', { name: 'ACAD2' }), /ACAD cannot be renamed/],
      [update('appIds', 'TRIYA_TEST', { name: 'acad' }), /another application is named acad/],
      [update('appIds', 'TRIYA_TEST', { flags: 16 }), /xref-dependent/],
      [update('vports', '*Active', { name: 'MAIN' }), /\*Active cannot be renamed/],
      [update('views', 'PLAN', { name: 'A<B' }), /not a valid view name/],
      [(b) => b.addTableRecord('ucs', { ...ucsRecord('tilted') }), /another UCS is named tilted/],
      [update('ucs', 'TILTED', { xAxis: { x: 2, y: 0, z: 0 } }), /not unit vectors/],
      [update('ucs', 'TILTED', { yAxis: { x: 0, y: 1, z: 0 } }), /not at right angles/],
      [update('ucs', 'TILTED', { orthographic: 7 }), /orthographic type 7/],
      [update('views', 'PLAN', { height: 0 }), /height 0/],
      [update('views', 'PLAN', { width: -1 }), /width -1/],
      [update('views', 'PLAN', { direction: { x: 0, y: 0, z: 0 } }), /not a direction/],
      [update('views', 'PLAN', { lensLength: 0 }), /lens length/],
      [update('views', 'PLAN', { viewMode: 32 }), /view mode 32/],
      [update('views', 'PLAN', { renderMode: 7 }), /render mode 7/],
      [
        update('views', 'PLAN', { ucs: { ...frontFrame, yAxis: { x: 1, y: 0, z: 0 } } }),
        /UCS axes/,
      ],
      [update('vports', '*Active', { upperRight: { x: 1.5, y: 1 } }), /within 0–1/],
      [update('vports', '*Active', { lowerLeft: { x: 1, y: 0 } }), /within 0–1/],
      [update('vports', '*Active', { aspectRatio: 0 }), /aspect ratio/],
      [update('vports', '*Active', { snapSpacing: { x: -1, y: 1 } }), /snap spacing/],
      [update('vports', '*Active', { gridSpacing: { x: 1, y: Number.NaN } }), /grid spacing/],
      [update('vports', '*Active', { isometricPlane: 3 }), /isometric plane 3/],
      [update('vports', '*Active', { gridFlags: 16 }), /grid flags 16/],
      [update('vports', '*Active', { gridMajor: 0 }), /major grid line/],
      [update('vports', '*Active', { circleZoom: 0 }), /circle zoom 0/],
      [update('vports', '*Active', { ucsIcon: 4 }), /UCS icon flags 4/],
      [update('vports', '*Active', { xdata: [] }), /xdata changes/],
    ];
    for (const [f, message] of cases) {
      const bytes = drawing();
      const model = open(bytes);
      edit(model, (b) => f(b, model));
      const doc = readCadDocument(bytes);
      const before = documentInit(doc);

      expect(() => triyaToAcad(doc, model), String(message)).toThrow(message);
      expect(documentInit(doc)).toEqual(before);
    }
  });

  it.each(formats)(
    'saves the viewport edits acad-ts used to read back wrong or drop (M1-93, %s)',
    (format) => {
      const bytes = drawing(ACadVersion.AC1032, format);
      const model = open(bytes);
      const active = named<VportRecord>(model, 'vports', '*Active');
      const added: string[] = [];
      edit(model, (b) => {
        // No view mode bit, and a UCS icon that is off but at the origin.
        b.updateTableRecord('vports', active.handle, { viewMode: 0, ucsIcon: 2 });
        // A second *Active tile, and a saved configuration of two tiles.
        for (const name of ['*Active', 'SPLIT', 'SPLIT'])
          added.push(
            b.addTableRecord('vports', { ...like(active), name, viewMode: 8, ucsIcon: 1 }).handle,
          );
      });
      const back = saved(bytes, model, format).tables!.vports!;
      for (const h of [active.handle, ...added])
        expect(comparable(back.find((r) => r.handle === h)), h).toEqual(
          comparable(model.tables.vports.get(h)!),
        );
      expect(back.filter((v) => v.name.toUpperCase() === '*ACTIVE')).toHaveLength(2);
      expect(back.filter((v) => v.name === 'SPLIT')).toHaveLength(2);
    },
  );
});

const ucsRecord = (name: string): Omit<UcsRecord, 'handle'> => ({ name, ...frontFrame });
