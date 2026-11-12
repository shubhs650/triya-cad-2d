// AcadToTriya for MULTILEADER (M1-04 part 3c) on drawings authored in memory with acad-ts:
// text and block content, branches and their leader lines, and the ±Z plane check. The corpus
// comparison is in packages/testkit/src/mapping/entities.corpus.test.ts; the corpus has no
// −Z or tilted multileader, and its DXF files lose the branch fields (M1-32).
import {
  ACadVersion,
  AttributeDefinition,
  BlockRecord,
  CadDocument,
  Color,
  LeaderLine,
  LeaderRoot,
  LineType,
  MultiLeader,
  MultiLeaderBlockAttribute,
  XYZ,
} from '@node-projects/acad-ts';
import type { MultiLeaderGeometry } from '@triya/engine';
import { describe, expect, it } from 'vitest';
import { mapEntities } from '../src/index';

const H = (o: { handle: number }) => o.handle.toString(16).toUpperCase();

function branch(connection: XYZ, direction: XYZ, ...lines: XYZ[][]): LeaderRoot {
  const r = new LeaderRoot();
  r.connectionPoint = connection;
  r.direction = direction;
  r.landingDistance = 0.36;
  lines.forEach((pts, k) => {
    const l = new LeaderLine();
    l.index = k;
    l.points = pts;
    r.lines.push(l);
  });
  return r;
}

function textLeader(doc: CadDocument): MultiLeader {
  const m = new MultiLeader();
  doc.entities?.add(m);
  const c = m.contextData;
  c.textStyle = doc.textStyles!.tryGetValue('Standard')!;
  m.contentType = 2 as never;
  c.hasTextContents = true;
  c.textLabel = 'NOTE\\PSEE DETAIL';
  c.textLocation = new XYZ(10, 5, 0);
  c.direction = new XYZ(0, 1, 0);
  c.textHeight = 2.5;
  c.boundaryWidth = 20;
  c.lineSpacingFactor = 1.5;
  c.lineSpacing = 2;
  c.textAttachmentPoint = 1;
  c.flowDirection = 5;
  c.textColor = new Color(3);
  c.contentBasePoint = new XYZ(9, 4, 0);
  c.landingGap = 0.09;
  c.basePoint = new XYZ(0, 0, 0);
  c.leaderRoots.push(
    branch(
      new XYZ(8, 4, 0),
      new XYZ(1, 0, 0),
      [new XYZ(0, 0, 0), new XYZ(4, 2, 0)],
      [new XYZ(0, 8, 0)],
    ),
  );
  return m;
}

function mapOne(doc: CadDocument, m: MultiLeader): MultiLeaderGeometry {
  const { entities, unmapped } = mapEntities(doc);
  expect(unmapped).toEqual([]);
  const g = entities.find((e) => e.handle === H(m))!.geom;
  if (g.kind !== 'MULTILEADER') throw new Error(g.kind);
  return g;
}

describe('MULTILEADER', () => {
  it('maps a text multileader: leader properties, branches and its MTEXT content', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const arrow = new BlockRecord('_DOT');
    doc.blockRecords?.add(arrow);
    const m = textLeader(doc);
    m.propertyOverrideFlags = 0x44000 as never;
    m.pathType = 2 as never;
    m.lineColor = new Color(1);
    m.leaderLineType = doc.lineTypes!.tryGetValue('Continuous')!;
    m.leaderLineWeight = 25 as never;
    m.enableLanding = true;
    m.enableDogleg = true;
    m.landingDistance = 0.36;
    m.arrowhead = arrow;
    m.arrowheadSize = 0.18;
    m.scaleFactor = 2;
    m.contextData.arrowheadSize = 0.36;
    m.textLeftAttachment = 1 as never;
    m.textRightAttachment = 3 as never;
    m.textTopAttachment = 9 as never;
    m.textBottomAttachment = 9 as never;
    m.textAngle = 1 as never;
    m.textAlignment = 0 as never;
    m.textFrame = true;

    expect(mapOne(doc, m)).toEqual({
      kind: 'MULTILEADER',
      overrideFlags: 0x44000,
      pathType: 2,
      lineColor: { kind: 'aci', index: 1 },
      linetype: H(doc.lineTypes!.tryGetValue('Continuous')!),
      lineweight: 25,
      landing: true,
      dogleg: true,
      doglegLength: 0.36,
      arrowhead: H(arrow),
      arrowheadSize: 0.18,
      // The context's drawn size, overall scale 2 applied.
      drawnArrowheadSize: 0.36,
      contentType: 2,
      scale: 2,
      annotative: false,
      textLeftAttachment: 1,
      textRightAttachment: 3,
      textTopAttachment: 9,
      textBottomAttachment: 9,
      textAttachmentDirection: 0,
      textAngleType: 1,
      textAlignment: 0,
      textFrame: true,
      contentBase: { x: 9, y: 4 },
      landingGap: 0.09,
      text: {
        content: 'NOTE\\PSEE DETAIL',
        style: H(doc.textStyles!.tryGetValue('Standard')!),
        position: { x: 10, y: 5 },
        rotation: Math.PI / 2,
        height: 2.5,
        width: 20,
        boundaryHeight: 0,
        lineSpacing: 1.5,
        lineSpacingStyle: 2,
        attachment: 1,
        flow: 5,
        color: { kind: 'aci', index: 3 },
      },
      branches: [
        {
          index: 0,
          connection: { x: 8, y: 4 },
          direction: { x: 1, y: 0 },
          doglegLength: 0.36,
          lines: [
            {
              index: 0,
              vertices: [
                { x: 0, y: 0 },
                { x: 4, y: 2 },
              ],
            },
            { index: 1, vertices: [{ x: 0, y: 8 }] },
          ],
        },
      ],
    });
  });

  // M2-44, as ezdxf reads MLEADER context data: 292 turns the mask on, 291 fills it with the
  // drawing window colour instead of 91 (as does a 91 stating the window colour, 0xC8).
  it('maps the background mask, and nothing for a mask turned off', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = textLeader(doc);
    const c = m.contextData;
    c.backgroundFillColor = Color.fromTrueColor(0xffffc8);
    c.backgroundScaleFactor = 1.5;
    c.backgroundTransparency = 20;
    // 291 alone (AutoCAD's default with no mask) masks nothing.
    c.backgroundFillEnabled = true;
    expect(mapOne(doc, m).text!.mask).toBeUndefined();
    c.backgroundMaskFillOn = true;
    expect(mapOne(doc, m).text!.mask).toEqual({ scale: 1.5, transparency: 20 });
    c.backgroundFillEnabled = false;
    expect(mapOne(doc, m).text!.mask).toEqual({
      color: { kind: 'rgb', r: 255, g: 255, b: 200 },
      scale: 1.5,
      transparency: 20,
    });
    c.backgroundFillColor = Color.fromCmValue(0xc8000000 | 0);
    c.backgroundTransparency = 0;
    expect(mapOne(doc, m).text!.mask).toEqual({ scale: 1.5 });
  });

  it('maps block content and the multileader style', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('TAG');
    doc.blockRecords?.add(block);
    const m = textLeader(doc);
    const style = [...(doc.mLeaderStyles ?? [])][0];
    if (style) m.style = style;
    m.contentType = 1 as never;
    const c = m.contextData;
    c.hasTextContents = false;
    c.hasContentsBlock = true;
    c.blockContent = block;
    c.blockContentLocation = new XYZ(12, 6, 0);
    c.blockContentScale = new XYZ(2, 2, 1);
    c.blockContentRotation = 0.5;
    c.blockContentColor = new Color(5);
    const g = mapOne(doc, m);

    expect(g.text).toBeUndefined();
    expect(g.block).toEqual({
      block: H(block),
      position: { x: 12, y: 6 },
      scale: { x: 2, y: 2, z: 1 },
      rotation: 0.5,
      color: { kind: 'aci', index: 5 },
    });
    expect(g.style).toBe(style ? H(style) : undefined);
  });

  it('maps block content attribute values (M1-111)', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const block = new BlockRecord('TAG');
    const attdef = new AttributeDefinition();
    attdef.tag = 'NO';
    block.entities.add(attdef);
    doc.blockRecords?.add(block);
    const m = textLeader(doc);
    m.contentType = 1 as never;
    const c = m.contextData;
    c.hasTextContents = false;
    c.hasContentsBlock = true;
    c.blockContent = block;
    const value = (text: string, index: number, def: AttributeDefinition | null) => {
      const a = new MultiLeaderBlockAttribute();
      a.attributeDefinition = def;
      a.index = index;
      a.width = 1.5;
      a.text = text;
      return a;
    };
    m.blockAttributes = [value('12', 0, attdef), value('lost', 1, null)];

    expect(mapOne(doc, m).block?.attributes).toEqual([
      { definition: H(attdef), index: 0, width: 1.5, value: '12' },
      { index: 1, width: 1.5, value: 'lost' },
    ]);
    // None stated: no attributes at all.
    m.blockAttributes = [];
    expect(mapOne(doc, m).block).not.toHaveProperty('attributes');
  });

  it('maps the properties a leader line overrides, and only those (M1-111)', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const arrow = new BlockRecord('_DOT');
    doc.blockRecords?.add(arrow);
    const dashed = new LineType('DASHED');
    doc.lineTypes?.add(dashed);
    const m = textLeader(doc);
    const [plain, over] = m.contextData.leaderRoots[0]!.lines;
    // Stored but not flagged: AutoCAD writes these for every line.
    plain!.lineColor = new Color(3);
    plain!.lineWeight = 50;
    over!.pathType = 2;
    over!.lineColor = new Color(1);
    over!.lineType = dashed;
    over!.lineWeight = 50;
    over!.arrowheadSize = 2.5;
    over!.arrowhead = arrow;
    over!.overrideFlags = 63;
    const lines = mapOne(doc, m).branches[0]!.lines;

    expect(lines[0]).not.toHaveProperty('overrides');
    expect(lines[1]!.overrides).toEqual({
      flags: 63,
      pathType: 2,
      color: { kind: 'aci', index: 1 },
      linetype: H(dashed),
      lineweight: 50,
      arrowheadSize: 2.5,
      arrowhead: H(arrow),
    });
    // Flag 32 without an arrowhead block is the closed filled arrow; unflagged values stay out.
    over!.arrowhead = null;
    over!.overrideFlags = 2 | 32;
    expect(mapOne(doc, m).branches[0]!.lines[1]!.overrides).toEqual({
      flags: 34,
      color: { kind: 'aci', index: 1 },
    });
  });

  it('drops Z from a −Z multileader, whose points are WCS, and marks its text', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = textLeader(doc);
    const c = m.contextData;
    c.basePoint = new XYZ(0, 0, 3);
    c.baseDirection = new XYZ(-1, 0, 0);
    c.baseVertical = new XYZ(0, 1, 0);
    c.textNormal = new XYZ(0, 0, -1);
    c.textLocation = new XYZ(10, 5, 3);
    c.direction = new XYZ(-1, 0, 0);
    const g = mapOne(doc, m);

    expect(g).toMatchObject({
      elevation: 3,
      normal: { x: 0, y: 0, z: -1 },
      text: { position: { x: 10, y: 5 }, rotation: Math.PI, upsideDown: true },
      branches: [{ connection: { x: 8, y: 4 } }],
    });
  });

  it('reports a multileader on a tilted plane', () => {
    const doc = new CadDocument(ACadVersion.AC1032);
    const m = textLeader(doc);
    m.contextData.baseVertical = new XYZ(0, 0, 1);

    expect(mapEntities(doc).unmapped).toEqual([
      { handle: H(m), type: 'MULTILEADER', reason: 'tilted plane' },
    ]);
  });
});
