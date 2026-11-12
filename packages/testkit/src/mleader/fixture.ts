// The multileader editing test drawing (M2-44), authored here (Rule 0, DEC-047): an AC1032 DXF
// that `pnpm fixtures:mleader` writes to packages/testkit/fixtures/mleader/, where the app spec
// (tests/e2e/ui/mleader.spec.ts) reads it; fixture.test.ts keeps the committed file in step.
//
// mleader-edit.dxf, metric (text 4, landing gap 2), saved zoomed to the two multileaders:
// - NOTE: a text multileader reading FRAMED NOTE in blue, framed (DXF 292) and masked in
//   light yellow (context data 292 on, 91 the colour, 141 border scale 1.5), its leader from
//   (10, 10) to the landing at (30, 40), the text a dogleg (8) and a gap (2) right of it;
// - TAG: a block multileader showing block TAG (a circle of radius 6 and the ATTDEF NO,
//   prompt "Tag number", centred on the base point) at (100, 40) stating NO = 7, its leader
//   from (80, 10) to the landing at (86, 40).
import {
  ACadVersion,
  AttributeDefinition,
  BlockRecord,
  CadDictionary,
  CadDocument,
  Circle,
  Color,
  LeaderLine,
  LeaderRoot,
  MultiLeader,
  MultiLeaderBlockAttribute,
  MultiLeaderStyle,
  XY,
  XYZ,
} from '@node-projects/acad-ts';
import { writeCadDocument } from '@triya/io';

export const MLEADER_EDIT_DXF = 'mleader-edit.dxf';
export const NOTE_TEXT = 'FRAMED NOTE';
/** The mask's colour: light yellow. */
export const NOTE_MASK = { r: 255, g: 255, b: 200 } as const;
export const TAG_BLOCK = 'TAG';
export const TAG_VALUE = '7';
/** What the drawing is saved zoomed to: its centre and height. */
export const VIEW = { center: { x: 60, y: 30 }, height: 60 } as const;

const TEXT_HEIGHT = 4;
const GAP = 2;
const DOGLEG = 8;

function root(tip: XYZ, landing: XYZ, direction: XYZ): LeaderRoot {
  const r = new LeaderRoot();
  r.leaderIndex = 0;
  r.connectionPoint = landing;
  r.direction = direction;
  r.landingDistance = DOGLEG;
  const l = new LeaderLine();
  l.index = 0;
  l.points = [tip];
  r.lines = [l];
  return r;
}

/** The leader properties both multileaders share, as AutoCAD's metric Standard style has them. */
function leader(m: MultiLeader, style: MultiLeaderStyle): void {
  m.style = style;
  m.lineColor = Color.byBlock;
  m.arrowheadSize = 4;
  m.landingDistance = DOGLEG;
  m.enableLanding = true;
  m.enableDogleg = true;
  m.pathType = 1 as never;
  const c = m.contextData;
  c.arrowheadSize = 4;
  c.landingGap = GAP;
  c.textHeight = TEXT_HEIGHT;
  c.basePoint = new XYZ(0, 0, 0);
}

export function mleaderEditDxf(): Uint8Array {
  const doc = new CadDocument(ACadVersion.AC1032);
  doc.updateCollections(true, true);
  const active = [...doc.vPorts!].find((v) => v.name.toUpperCase() === '*ACTIVE')!;
  active.center = new XY(VIEW.center.x, VIEW.center.y);
  active.viewHeight = VIEW.height;
  const styles = doc.rootDictionary!.getEntry<CadDictionary>(CadDictionary.acadMLeaderStyle)!;
  const style = new MultiLeaderStyle('Standard');
  styles.add(style);

  const block = new BlockRecord(TAG_BLOCK);
  const circle = new Circle();
  circle.radius = 6;
  block.entities.add(circle);
  const attdef = new AttributeDefinition();
  attdef.tag = 'NO';
  attdef.prompt = 'Tag number';
  attdef.value = '1';
  attdef.height = TEXT_HEIGHT;
  // Middle centre (DXF 72 = 1, 74 = 2), on the base point.
  attdef.horizontalAlignment = 1 as never;
  attdef.verticalAlignment = 2 as never;
  attdef.insertPoint = new XYZ(0, 0, 0);
  attdef.alignmentPoint = new XYZ(0, 0, 0);
  block.entities.add(attdef);
  doc.blockRecords!.add(block);

  const note = new MultiLeader();
  doc.entities!.add(note);
  leader(note, style);
  note.contentType = 2 as never;
  note.textFrame = true;
  note.textLeftAttachment = 1 as never;
  note.textRightAttachment = 1 as never;
  const nc = note.contextData;
  const landing = new XYZ(30, 40, 0);
  nc.hasTextContents = true;
  nc.textLabel = NOTE_TEXT;
  nc.textNormal = new XYZ(0, 0, 1);
  nc.direction = new XYZ(1, 0, 0);
  nc.textLocation = new XYZ(landing.x + DOGLEG + GAP, landing.y + TEXT_HEIGHT / 2, 0);
  nc.textAttachmentPoint = 1;
  nc.lineSpacingFactor = 1;
  nc.lineSpacing = 1;
  nc.flowDirection = 1;
  // Blue (ACI 5), which reads on the mask; its frame is drawn in it too.
  nc.textColor = new Color(5);
  nc.contentBasePoint = new XYZ(landing.x + DOGLEG, landing.y, 0);
  nc.backgroundMaskFillOn = true;
  nc.backgroundFillEnabled = false;
  nc.backgroundFillColor = new Color(NOTE_MASK.r, NOTE_MASK.g, NOTE_MASK.b);
  nc.backgroundScaleFactor = 1.5;
  nc.leaderRoots = [root(new XYZ(10, 10, 0), landing, new XYZ(1, 0, 0))];
  nc.textStyle = doc.textStyles!.get('Standard');
  note.textStyle = nc.textStyle;

  const tag = new MultiLeader();
  doc.entities!.add(tag);
  leader(tag, style);
  tag.contentType = 1 as never;
  const tc = tag.contextData;
  const at = new XYZ(100, 40, 0);
  tc.hasContentsBlock = true;
  tc.blockContentNormal = new XYZ(0, 0, 1);
  tc.blockContentLocation = at;
  tc.blockContentScale = new XYZ(1, 1, 1);
  tc.blockContentColor = Color.byBlock;
  tc.contentBasePoint = new XYZ(at.x - 6, at.y, 0);
  tc.leaderRoots = [root(new XYZ(80, 10, 0), new XYZ(86, 40, 0), new XYZ(1, 0, 0))];
  tc.blockContent = block;
  tag.blockContentId = block;
  tag.blockContentScale = new XYZ(1, 1, 1);
  const value = new MultiLeaderBlockAttribute();
  value.attributeDefinition = attdef;
  value.index = 0;
  value.width = 1;
  value.text = TAG_VALUE;
  tag.blockAttributes = [value];
  return writeCadDocument(doc, { format: 'dxf' });
}
