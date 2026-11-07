// TriyaToAcad for where an entity sits (M1-75 part 24): an entity moved to another block
// (CHSPACE, BLOCK's Convert to block) keeps its handle, extension dictionary and xdata, and a
// block's entities are written in the engine's order. The drawing is authored in memory with
// acad-ts and saved once, so "the file" is real bytes; every corpus file takes a move and a
// reorder in packages/testkit/src/export/export-entity-order.corpus.test.ts.
import {
  ACadVersion,
  BlockRecord,
  CadDocument,
  Circle,
  Line,
  Viewport,
  XYZ,
  type Entity as AcadEntity,
} from '@node-projects/acad-ts';
import {
  ChangeSetBuilder,
  DocumentModel,
  type Entity,
  type Handle,
  type SortEntsTable,
} from '@triya/engine';
import { describe, expect, it } from 'vitest';
import {
  documentInit,
  exportDocument,
  readCadDocument,
  triyaToAcad,
  UnsupportedChangeError,
  writeCadDocument,
  type CadFormat,
} from '../src/index';

/**
 * Model space: LINEs A, B and C, A with an extension dictionary and on top in the draw order
 * table, and a circle Triya does not map (tilted out of plan) right after A. Paper space: a LINE
 * and, from R2000 here, a viewport. Two blocks: PART (one LINE) and an xref, XR.
 */
function drawing(version: ACadVersion, format: CadFormat): Uint8Array {
  const doc = new CadDocument(version);
  const [a, b, c] = [0, 1, 2].map((i) => new Line(new XYZ(0, i, 0), new XYZ(10, i, 0)));
  const tilted = new Circle(new XYZ(0, 0, 0), 1);
  tilted.normal = new XYZ(1, 0, 0);
  for (const e of [a!, tilted, b!, c!]) doc.entities!.add(e);
  a!.createExtendedDictionary();
  doc.paperSpace!.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(5, 5, 0)));
  if (version >= ACadVersion.AC1015) {
    const vp = new Viewport();
    vp.center = new XYZ(5, 5, 0);
    vp.width = 4;
    vp.height = 3;
    doc.paperSpace!.entities.add(vp);
  }
  const part = new BlockRecord('PART');
  doc.blockRecords!.add(part);
  part.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(1, 1, 0)));
  doc.blockRecords!.add(new BlockRecord('XR', 'xr.dwg'));
  if (version >= ACadVersion.AC1014) {
    const table = doc.modelSpace!.createSortEntitiesTable();
    table.add(a!, c!.handle + 1);
  }
  return writeCadDocument(doc, { format });
}

const CASES = [
  ['R2018 DXF', ACadVersion.AC1032, 'dxf'],
  ['R2018 DWG', ACadVersion.AC1032, 'dwg'],
  ['R2000 DWG', ACadVersion.AC1015, 'dwg'],
  ['R12 DXF', ACadVersion.AC1009, 'dxf'],
] as const;

const open = (bytes: Uint8Array): DocumentModel =>
  DocumentModel.create(documentInit(readCadDocument(bytes)));

function edit(model: DocumentModel, f: (b: ChangeSetBuilder) => void): void {
  const b = new ChangeSetBuilder(model);
  f(b);
  model.apply(b.build());
}

const blockNamed = (model: DocumentModel, name: string): Handle =>
  [...model.blocks.values()].find((b) => b.name.toUpperCase() === name)!.handle;

const linesIn = (model: DocumentModel, block: Handle): Entity[] =>
  model
    .blockEntities(block)
    .map((id) => model.entity(id)!)
    .filter((e) => e.type === 'LINE');

/** Every entity of model space as the save writes it, mapped or not, by handle. */
const written = (bytes: Uint8Array): string[] =>
  [...readCadDocument(bytes).modelSpace!.entities].map((e: AcadEntity) =>
    e.handle.toString(16).toUpperCase(),
  );

const save = (bytes: Uint8Array, model: DocumentModel, format: CadFormat): Uint8Array =>
  exportDocument(readCadDocument(bytes), model, { format });

describe.each(CASES)('entity moves and order (%s)', (_name, version, format) => {
  const FILE = drawing(version, format);

  it('moves a LINE to paper space keeping its handle and extension dictionary', () => {
    const model = open(FILE);
    const [ms, ps] = [blockNamed(model, '*MODEL_SPACE'), blockNamed(model, '*PAPER_SPACE')];
    const [a, b, c] = linesIn(model, ms);
    edit(model, (x) => x.moveEntity(a!.id, ps));
    const bytes = save(FILE, model, format);
    const back = open(bytes);

    const moved = back.entityByHandle(a!.handle)!;
    expect(moved.owner).toBe(ps);
    expect(moved.extDict).toBe(a!.extDict);
    expect(linesIn(back, ms).map((e) => e.handle)).toEqual([b!.handle, c!.handle]);
    expect(linesIn(back, ps).at(-1)?.handle).toBe(a!.handle);
    // The draw order entry stays behind with model space, and is dropped.
    const table = [...back.objects.values()].find(
      (o): o is SortEntsTable => o.type === 'SORTENTSTABLE' && (o as SortEntsTable).block === ms,
    );
    expect(table?.entries.map((e) => e.entity) ?? []).toEqual([]);
    // Nothing else of model space moves: the unmapped circle stays where it was.
    expect(written(bytes)).toEqual(written(FILE).filter((h) => h !== a!.handle));
  });

  it('moves and edits an entity in one save, into a block and back out of one', () => {
    const model = open(FILE);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const part = blockNamed(model, 'PART');
    const [, b] = linesIn(model, ms);
    const [inPart] = linesIn(model, part);
    edit(model, (x) => {
      // CHSPACE scales what it moves by the viewport scale.
      const moved = x.moveEntity(b!.id, part);
      x.updateEntity(moved.id, {
        geom: { kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
      });
      x.moveEntity(inPart!.id, ms);
    });
    const back = open(save(FILE, model, format));

    expect(back.entityByHandle(b!.handle)).toMatchObject({
      owner: part,
      geom: { start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
    });
    expect(back.entityByHandle(inPart!.handle)?.owner).toBe(ms);
    expect(linesIn(back, ms).at(-1)?.handle).toBe(inPart!.handle);
  });

  it("writes a block's entities in the engine's order, unmapped ones after their neighbour", () => {
    const model = open(FILE);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const [a, b, c] = linesIn(model, ms);
    let added: Entity | undefined;
    edit(model, (x) => {
      added = x.addEntity({
        owner: ms,
        layer: a!.layer,
        geom: { kind: 'LINE', start: { x: 0, y: 9 }, end: { x: 1, y: 9 } },
      });
      // Moving within the block puts A (and the circle after it) last, after the new LINE.
      x.moveEntity(a!.id, ms);
    });
    const bytes = save(FILE, model, format);
    const [tilted] = written(FILE).filter((h) => ![a, b, c].some((e) => e!.handle === h));

    expect(written(bytes)).toEqual([b!.handle, c!.handle, added!.handle, a!.handle, tilted]);
    // R12 has no extension dictionaries.
    if (a!.extDict !== undefined)
      expect(
        readCadDocument(bytes).getCadObject(Number.parseInt(a!.handle, 16))?.xDictionary?.handle,
      ).toBe(Number.parseInt(a!.extDict, 16));
  });

  it('refuses to move a viewport or into or out of an xref', () => {
    const cases: ((x: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      (x, m) => x.moveEntity(linesIn(m, blockNamed(m, '*MODEL_SPACE'))[0]!.id, blockNamed(m, 'XR')),
    ];
    if (version >= ACadVersion.AC1015)
      cases.push((x, m) => {
        const ps = blockNamed(m, '*PAPER_SPACE');
        const vp = m
          .blockEntities(ps)
          .map((id) => m.entity(id)!)
          .find((e) => e.type === 'VIEWPORT' && e.handle);
        x.moveEntity(vp!.id, blockNamed(m, 'PART'));
      });
    for (const f of cases) {
      const model = open(FILE);
      edit(model, (x) => f(x, model));
      const doc = readCadDocument(FILE);
      const init = documentInit(doc);
      expect(() => triyaToAcad(doc, model), String(cases.indexOf(f))).toThrow(
        UnsupportedChangeError,
      );
      expect(documentInit(doc)).toEqual(init);
    }
  });
});

describe('a file that states no entity handles', () => {
  // An R12 DXF with $HANDLING 0 (and every file before R11): acad-ts numbers the entities in file
  // order, so a reorder or a move would bring them back under one another's handles.
  const dxf = [
    ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$HANDLING', '70', '0'],
    ['0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
    ...[0, 1, 2].map((i) => [
      '0',
      'LINE',
      '8',
      '0',
      '10',
      '0',
      '20',
      `${i}`,
      '11',
      '9',
      '21',
      `${i}`,
    ]),
    // A paper-space LINE, so that the file has paper space.
    ['0', 'LINE', '8', '0', '67', '1', '10', '0', '20', '0', '11', '1', '21', '1'],
    ['0', 'ENDSEC', '0', 'EOF'],
  ]
    .flat()
    .join('\n');
  const FILE = Uint8Array.from(dxf, (c) => c.charCodeAt(0));

  it('refuses a reorder or a move, and still appends new entities', () => {
    const cases: ((x: ChangeSetBuilder, m: DocumentModel) => void)[] = [
      (x, m) =>
        x.moveEntity(
          linesIn(m, blockNamed(m, '*MODEL_SPACE'))[0]!.id,
          blockNamed(m, '*MODEL_SPACE'),
        ),
      (x, m) =>
        x.moveEntity(
          linesIn(m, blockNamed(m, '*MODEL_SPACE'))[1]!.id,
          blockNamed(m, '*PAPER_SPACE'),
        ),
    ];
    for (const f of cases) {
      const model = open(FILE);
      edit(model, (x) => f(x, model));
      expect(() => triyaToAcad(readCadDocument(FILE), model), String(cases.indexOf(f))).toThrow(
        /no entity handles/,
      );
    }
    const model = open(FILE);
    const ms = blockNamed(model, '*MODEL_SPACE');
    const [first, , third] = linesIn(model, ms);
    edit(model, (x) => {
      x.removeEntity(first!.id);
      x.addEntity({
        owner: ms,
        layer: third!.layer,
        geom: { kind: 'LINE', start: { x: 5, y: 5 }, end: { x: 6, y: 6 } },
      });
    });
    const back = open(save(FILE, model, 'dxf'));
    expect(
      linesIn(back, blockNamed(back, '*MODEL_SPACE')).map(
        (e) => (e.geom as { start: { y: number } }).start.y,
      ),
    ).toEqual([1, 2, 5]);
  });
});
