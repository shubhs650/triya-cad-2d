// AcadToTriya for TEXT, MTEXT, ATTDEF, INSERT/MINSERT and their ATTRIBs (M1-04 part 2) on
// drawings authored in memory with acad-ts. The corpus comparison is in
// packages/testkit/src/mapping/entities.corpus.test.ts; these cover what it holds few of
// (mirrored inserts, MINSERT arrays, multiline attributes, MTEXT columns and backgrounds).
import {
  ACadVersion,
  AttributeDefinition,
  AttributeEntity,
  AttributeType,
  BackgroundFillFlags,
  BlockRecord,
  CadDocument,
  Color,
  ColumnType,
  Insert,
  MText,
  TextEntity,
  TextColumnData,
  XYZ,
  type Entity,
} from '@node-projects/acad-ts';
import type { EntityInit, InsertGeometry, TextFields, Vec2 } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const DOWN = new XYZ(0, 0, -1);
const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function mapIn(doc: CadDocument, e: Entity): EntityInit {
  doc.entities?.add(e);
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  return entities.find((x) => x.handle === H(e))!;
}
const mapOne = (e: Entity): EntityInit => mapIn(new CadDocument(ACadVersion.AC1032), e);

const expectNear = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

/** Where Triya's text frame puts the glyph-space point (u, v), relative to the anchor. */
function textFrame(t: TextFields, u: number, v: number): Vec2 {
  const su = t.backward ? -u : u;
  const sv = t.upsideDown ? -v : v;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: t.position.x + c * su - s * sv, y: t.position.y + s * su + c * sv };
}

/** Where the block-space point q lands under an INSERT's plan-view placement. */
function placed(g: InsertGeometry, q: Vec2): Vec2 {
  const x = q.x * g.scale.x;
  const y = q.y * g.scale.y;
  const c = Math.cos(g.rotation);
  const s = Math.sin(g.rotation);
  return { x: g.position.x + c * x - s * y, y: g.position.y + s * x + c * y };
}

describe('TEXT', () => {
  it('maps the value, style, frame and justification', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const t = new TextEntity('Hello');
    t.insertPoint = new XYZ(1, 2, 0);
    t.alignmentPoint = new XYZ(5, 2, 0);
    t.horizontalAlignment = 2 as never;
    t.verticalAlignment = 3 as never;
    t.height = 2.5;
    t.rotation = 0.3;
    t.widthFactor = 0.8;
    t.obliqueAngle = 0.25;
    t.mirror = 2 as never;
    const { geom } = mapIn(doc, t);

    expect(geom).toEqual({
      kind: 'TEXT',
      value: 'Hello',
      style: H(doc.textStyles!.tryGetValue('Standard')!),
      position: { x: 1, y: 2 },
      alignmentPoint: { x: 5, y: 2 },
      height: 2.5,
      rotation: 0.3,
      widthFactor: 0.8,
      oblique: 0.25,
      halign: 2,
      valign: 3,
      backward: true,
      upsideDown: false,
    });
  });

  it('leaves out the second alignment point of left-baseline text, which AutoCAD ignores', () => {
    const t = new TextEntity('x');
    t.alignmentPoint = new XYZ(9, 9, 0);
    expect(mapOne(t).geom).not.toHaveProperty('alignmentPoint');
  });

  it('turns a −Z text into its mirror image: baseline π − θ and upside down', () => {
    const t = new TextEntity('M');
    t.insertPoint = new XYZ(3, 1, 4);
    t.rotation = 0.5;
    t.normal = DOWN;
    const { geom } = mapOne(t);
    if (geom.kind !== 'TEXT') throw new Error(geom.kind);

    // The file draws glyph point (u, v) at OCS insert + R(θ)(u, v), i.e. WCS (−x, y).
    const ocs = (u: number, v: number): Vec2 => ({
      x: -(3 + Math.cos(0.5) * u - Math.sin(0.5) * v),
      y: 1 + Math.sin(0.5) * u + Math.cos(0.5) * v,
    });
    for (const [u, v] of [
      [0, 0],
      [2, 0],
      [0, 1],
      [1.5, -0.7],
    ] as const)
      expectNear(textFrame(geom, u, v), ocs(u, v));
    expect(geom).toMatchObject({ upsideDown: true, backward: false, elevation: -4 });
  });
});

describe('MTEXT', () => {
  it('maps contents, box, attachment, spacing, background and columns', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = new MText('{\\fArial;one}\\Ptwo');
    m.insertPoint = new XYZ(10, 20, 0);
    m.alignmentPoint = new XYZ(0, 2, 0);
    m.height = 3;
    m.rectangleWidth = 40;
    m.rectangleHeight = 12;
    m.attachmentPoint = 5 as never;
    m.lineSpacingStyle = 2 as never;
    m.lineSpacing = 1.5;
    m.backgroundFillFlags = BackgroundFillFlags.UseBackgroundFillColor;
    m.backgroundColor = new Color(3);
    m.backgroundScale = 1.25;
    const cols = new TextColumnData();
    cols.columnType = ColumnType.StaticColumns;
    cols.columnCount = 2;
    cols.width = 18;
    cols.gutter = 4;
    m.columnData = cols;
    const { geom } = mapIn(doc, m);

    expect(geom).toEqual({
      kind: 'MTEXT',
      contents: '{\\fArial;one}\\Ptwo',
      style: H(doc.textStyles!.tryGetValue('Standard')!),
      position: { x: 10, y: 20 },
      height: 3,
      width: 40,
      definedHeight: 12,
      rotation: Math.PI / 2,
      attachment: 5,
      direction: 1,
      lineSpacingStyle: 2,
      lineSpacing: 1.5,
      background: { flags: 1, color: { kind: 'aci', index: 3 }, scale: 1.25 },
      columns: {
        type: 1,
        count: 2,
        flowReversed: false,
        autoHeight: false,
        width: 18,
        gutter: 4,
        heights: [],
      },
    });
  });

  it('keeps the WCS insertion point of a −Z MTEXT and says its Y axis is reversed', () => {
    const m = new MText('a');
    m.insertPoint = new XYZ(4, 5, 6);
    m.alignmentPoint = new XYZ(1, 1, 0);
    m.normal = DOWN;
    const { geom } = mapOne(m);

    expect(geom).toMatchObject({
      kind: 'MTEXT',
      position: { x: 4, y: 5 },
      rotation: Math.PI / 4,
      upsideDown: true,
      elevation: 6,
      normal: { x: 0, y: 0, z: -1 },
    });
  });
});

describe('attributes', () => {
  it('maps an ATTDEF with its tag, prompt and flags', () => {
    const a = new AttributeDefinition();
    a.tag = 'PART_NO';
    a.prompt = 'Part number?';
    a.value = 'P-1';
    a.flags = (1 | 8) as never;
    a.isReallyLocked = true;

    expect(mapOne(a).geom).toMatchObject({
      kind: 'ATTDEF',
      tag: 'PART_NO',
      prompt: 'Part number?',
      value: 'P-1',
      flags: 9,
      lockPosition: true,
    });
  });

  it('folds an INSERT’s ATTRIBs in with their own handles and properties', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('TAG');
    doc.blockRecords?.add(block);
    const ins = new Insert();
    ins.block = block;
    ins.insertPoint = new XYZ(7, 8, 0);
    ins.xScale = 2;
    ins.yScale = 3;
    ins.rotation = 0.25;
    const att = new AttributeEntity();
    att.tag = 'NAME';
    att.value = 'Pump';
    att.insertPoint = new XYZ(7, 9, 0);
    att.color = new Color(1);
    ins.attributes.push(att);
    doc.entities?.add(ins);
    const e = mapEntities(doc).entities.find((x) => x.type === 'INSERT')!;
    if (e.geom.kind !== 'INSERT') throw new Error(e.geom.kind);

    expect(e.geom).toMatchObject({
      kind: 'INSERT',
      block: H(block),
      position: { x: 7, y: 8 },
      scale: { x: 2, y: 3, z: 1 },
      rotation: 0.25,
    });
    expect(e.geom).not.toHaveProperty('array');
    expect(e.geom.attributes).toHaveLength(1);
    expect(e.geom.attributes[0]).toMatchObject({
      handle: H(att),
      tag: 'NAME',
      value: 'Pump',
      position: { x: 7, y: 9 },
      color: { kind: 'aci', index: 1 },
      layer: H(att.layer),
      visible: true,
    });
    expect(e.geom.attributes[0]).not.toHaveProperty('kind');
  });

  it('embeds the MTEXT of a multiline attribute', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('NOTE');
    doc.blockRecords?.add(block);
    const ins = new Insert();
    ins.block = block;
    const att = new AttributeEntity();
    att.tag = 'NOTE';
    att.attributeType = AttributeType.MultiLine;
    att.mText = new MText('line 1\\Pline 2');
    att.mText.rectangleWidth = 30;
    ins.attributes.push(att);
    doc.entities?.add(ins);
    const e = mapEntities(doc).entities.find((x) => x.type === 'INSERT')!;
    if (e.geom.kind !== 'INSERT') throw new Error(e.geom.kind);

    expect(e.geom.attributes[0]?.mtext).toMatchObject({
      kind: 'MTEXT',
      contents: 'line 1\\Pline 2',
      width: 30,
    });
  });
});

describe('INSERT placement', () => {
  it('folds a −Z extrusion into position, rotation and scale exactly', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('B');
    doc.blockRecords?.add(block);
    const ins = new Insert();
    ins.block = block;
    ins.insertPoint = new XYZ(5, 2, 1);
    ins.rotation = 0.4;
    ins.xScale = 2;
    ins.yScale = 1.5;
    ins.zScale = 3;
    ins.normal = DOWN;
    const { geom } = mapIn(doc, ins);
    if (geom.kind !== 'INSERT') throw new Error(geom.kind);

    // The file places block point q at OCS insert + R(θ)·S·q, which is WCS (−x, y).
    const file = (q: Vec2): Vec2 => {
      const x = q.x * 2;
      const y = q.y * 1.5;
      return {
        x: -(5 + Math.cos(0.4) * x - Math.sin(0.4) * y),
        y: 2 + Math.sin(0.4) * x + Math.cos(0.4) * y,
      };
    };
    for (const q of [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -2, y: 3 },
    ])
      expectNear(placed(geom, q), file(q));
    expect(geom).toMatchObject({ scale: { x: -2, y: 1.5, z: -3 }, elevation: -1 });
  });

  it('keeps a MINSERT array, its column spacing mirrored with the plane', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('CELL');
    doc.blockRecords?.add(block);
    const up = new Insert();
    up.block = block;
    up.columnCount = 3;
    up.rowCount = 2;
    up.columnSpacing = 10;
    up.rowSpacing = 5;
    const down = new Insert();
    down.block = block;
    down.columnCount = 3;
    down.rowCount = 2;
    down.columnSpacing = 10;
    down.rowSpacing = 5;
    down.normal = DOWN;
    doc.entities?.add(up);
    doc.entities?.add(down);
    const [a, b] = mapEntities(doc).entities.filter((x) => x.type === 'INSERT');

    expect(a!.geom).toMatchObject({
      array: { columns: 3, rows: 2, columnSpacing: 10, rowSpacing: 5 },
    });
    expect(b!.geom).toMatchObject({
      array: { columns: 3, rows: 2, columnSpacing: -10, rowSpacing: 5 },
    });
  });

  it('reports an INSERT whose block is missing', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const ins = new Insert();
    doc.entities?.add(ins);

    expect(mapEntities(doc).unmapped).toMatchObject([{ type: 'INSERT', reason: 'missing block' }]);
  });
});
