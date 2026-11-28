// Vessel supports (M8-02): saddle, leg, bracket (lug), skirt and anchor chair outlines, each
// drawn in the view a general arrangement shows it in and sized by its principal dimensions.
// Each plate is one closed outline, so it can be picked on its own; bolt holes are hidden
// lines through their plate with a centre line, as an elevation shows them.
//
// Base points are where a drafter puts the support on a vessel's drawing: a saddle at the
// vessel's axis (its end view), a leg and a bracket at the vessel's axis on the level they
// bear on (they lie to the right, against the shell), a skirt at its axis on the foundation,
// an anchor chair at its bolt's centre on the foundation.
import { closed, corner, line, rect, type Corner, type LibraryPart } from '../parts';
import type { DetailField, DetailGenerator } from './detail';

const length = <K extends string>(
  key: K,
  code: string,
  label: string,
  optional = false,
): DetailField<K> => ({ key, code, label, kind: 'length', optional });

const angle = <K extends string>(key: K, code: string, label: string, optional = false) => ({
  ...length(key, code, label, optional),
  kind: 'angle' as const,
});

const visible = (loop: Corner[]): LibraryPart => ({ role: 'visible', geom: closed(loop) });

const centerLine = (x0: number, y0: number, x1: number, y1: number): LibraryPart => ({
  role: 'center',
  geom: line({ x: x0, y: y0 }, { x: x1, y: y1 }),
});

/** A hole of diameter `d` through a plate from y0 to y1, centred at x: hidden edges and its centre line. */
function holeAcross(x: number, d: number, y0: number, y1: number, overrun: number): LibraryPart[] {
  return [
    { role: 'hidden', geom: line({ x: x - d / 2, y: y0 }, { x: x - d / 2, y: y1 }) },
    { role: 'hidden', geom: line({ x: x + d / 2, y: y0 }, { x: x + d / 2, y: y1 }) },
    centerLine(x, y0 - overrun, x, y1 + overrun),
  ];
}

/** Both or neither of a pair of optional dimensions. */
const both = (a: number, b: number) => (a === 0) === (b === 0);

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The point at radius r and angle phi (radians) about the origin. */
const polar = (r: number, phi: number, bulge = 0): Corner =>
  corner(r * Math.cos(phi), r * Math.sin(phi), bulge);

/**
 * A band between radii r0 < r1 under the origin, `sweep` degrees about straight down: the
 * outer arc right to left, the inner back.
 */
function band(r0: number, r1: number, sweep: number): Corner[] {
  const half = rad(sweep) / 2;
  const b = Math.tan(rad(sweep) / 4);
  const right = -Math.PI / 2 + half;
  const left = -Math.PI / 2 - half;
  return [polar(r1, right, -b), polar(r1, left), polar(r0, left, b), polar(r0, right)];
}

// --- Saddle (horizontal vessel), end view ---------------------------------------------------

type SaddleKey =
  | 'vesselOD'
  | 'height'
  | 'contactAngle'
  | 'baseLength'
  | 'baseThickness'
  | 'topPlateThickness'
  | 'wearPlateThickness'
  | 'wearPlateAngle'
  | 'boltSpacing'
  | 'holeDiameter';

export const SADDLE: DetailGenerator<SaddleKey> = {
  id: 'SADDLE',
  label: 'Saddle support',
  view: 'end view',
  fields: [
    length('vesselOD', 'D', 'vessel OD'),
    length('height', 'H', 'height to vessel axis'),
    angle('contactAngle', 'A', 'contact angle'),
    length('baseLength', 'B', 'base length'),
    length('baseThickness', 'TB', 'base thickness'),
    length('topPlateThickness', 'TF', 'top plate thickness'),
    length('wearPlateThickness', 'TW', 'wear plate thickness', true),
    angle('wearPlateAngle', 'AW', 'wear plate angle', true),
    length('boltSpacing', 'S', 'bolt spacing', true),
    length('holeDiameter', 'HD', 'hole diameter', true),
  ],
  // A 60 in. vessel on a 120° saddle (L. P. Zick's usual range is 120° to 150°).
  defaults: {
    vesselOD: 60,
    height: 42,
    contactAngle: 120,
    baseLength: 52,
    baseThickness: 0.75,
    topPlateThickness: 0.5,
    wearPlateThickness: 0.375,
    wearPlateAngle: 132,
    boltSpacing: 44,
    holeDiameter: 1.125,
  },
  check(s) {
    if (s.contactAngle > 180) return 'contact angle must be 180° or less';
    if (!both(s.wearPlateThickness, s.wearPlateAngle))
      return 'a wear plate needs both its thickness and its angle';
    if (s.wearPlateAngle !== 0 && (s.wearPlateAngle < s.contactAngle || s.wearPlateAngle > 180))
      return 'wear plate angle must be from the contact angle to 180°';
    const web = s.vesselOD / 2 + s.wearPlateThickness + s.topPlateThickness;
    if (s.height - s.baseThickness <= web)
      return 'height must be more than the vessel radius, the plates and the base';
    if (!both(s.boltSpacing, s.holeDiameter))
      return 'bolt holes need both their spacing and their diameter';
    if (s.boltSpacing + s.holeDiameter >= s.baseLength)
      return 'bolt holes must lie inside the base';
    return undefined;
  },
  parts(s) {
    const r = s.vesselOD / 2;
    const rt = r + s.wearPlateThickness;
    const rb = rt + s.topPlateThickness;
    const baseTop = -s.height + s.baseThickness;
    const half = rad(s.contactAngle) / 2;
    const horns = [polar(rb, -Math.PI / 2 + half), polar(rb, -Math.PI / 2 - half)];
    const parts: LibraryPart[] = [
      visible(rect(-s.baseLength / 2, -s.height, s.baseLength / 2, baseTop)),
      // The web from the base's ends up to the horns, its top on the top plate's arc.
      visible([
        corner(-s.baseLength / 2, baseTop),
        corner(s.baseLength / 2, baseTop),
        { ...horns[0]!, bulge: -Math.tan(rad(s.contactAngle) / 4) },
        horns[1]!,
      ]),
      visible(band(rt, rb, s.contactAngle)),
    ];
    if (s.wearPlateThickness > 0) parts.push(visible(band(r, rt, s.wearPlateAngle)));
    const m = s.vesselOD / 16;
    parts.push(centerLine(-r - m, 0, r + m, 0), centerLine(0, r + m, 0, -s.height - m));
    if (s.holeDiameter > 0)
      for (const x of [-s.boltSpacing / 2, s.boltSpacing / 2])
        parts.push(...holeAcross(x, s.holeDiameter, -s.height, baseTop, s.holeDiameter));
    return parts;
  },
};

// --- Leg (vertical vessel), elevation --------------------------------------------------------

type LegKey =
  'vesselOD' | 'legHeight' | 'legWidth' | 'basePlateWidth' | 'basePlateThickness' | 'holeDiameter';

export const LEG: DetailGenerator<LegKey> = {
  id: 'LEG',
  label: 'Leg support',
  view: 'elevation',
  fields: [
    length('vesselOD', 'D', 'vessel OD'),
    length('legHeight', 'L', 'leg height'),
    length('legWidth', 'W', 'leg width'),
    length('basePlateWidth', 'BP', 'base plate width'),
    length('basePlateThickness', 'TB', 'base plate thickness'),
    length('holeDiameter', 'HD', 'hole diameter', true),
  ],
  defaults: {
    vesselOD: 48,
    legHeight: 60,
    legWidth: 6,
    basePlateWidth: 10,
    basePlateThickness: 0.75,
    holeDiameter: 0.875,
  },
  check(s) {
    if (s.legHeight <= s.basePlateThickness) return 'leg height must be more than the base plate';
    if (s.basePlateWidth <= s.legWidth) return 'base plate width must be more than the leg width';
    if (s.basePlateWidth - s.legWidth <= 2 * s.holeDiameter)
      return 'the bolt holes must fit on the base plate beside the leg';
    return undefined;
  },
  parts(s) {
    const r = s.vesselOD / 2;
    const c = r + s.legWidth / 2;
    const tb = s.basePlateThickness;
    const parts = [
      visible(rect(r, tb, r + s.legWidth, s.legHeight)),
      visible(rect(c - s.basePlateWidth / 2, 0, c + s.basePlateWidth / 2, tb)),
      centerLine(c, -s.basePlateWidth / 8, c, s.legHeight + s.basePlateWidth / 8),
    ];
    // An anchor bolt each side of the leg, halfway between it and the plate's edge.
    const offset = (s.basePlateWidth + s.legWidth) / 4;
    if (s.holeDiameter > 0)
      for (const x of [c - offset, c + offset])
        parts.push(...holeAcross(x, s.holeDiameter, 0, tb, tb));
    return parts;
  },
};

// --- Bracket (lug), elevation ---------------------------------------------------------------

type BracketKey =
  | 'vesselOD'
  | 'projection'
  | 'height'
  | 'baseThickness'
  | 'chamfer'
  | 'holeDiameter'
  | 'holeOffset'
  | 'padThickness'
  | 'padHeight';

export const BRACKET: DetailGenerator<BracketKey> = {
  id: 'BRACKET',
  label: 'Bracket support',
  view: 'elevation',
  fields: [
    length('vesselOD', 'D', 'vessel OD'),
    length('projection', 'B', 'projection'),
    length('height', 'H', 'height'),
    length('baseThickness', 'TB', 'base thickness'),
    length('chamfer', 'C', 'gusset end'),
    length('holeDiameter', 'HD', 'hole diameter', true),
    length('holeOffset', 'E', 'hole offset', true),
    length('padThickness', 'TP', 'pad thickness', true),
    length('padHeight', 'HP', 'pad height', true),
  ],
  defaults: {
    vesselOD: 48,
    projection: 8,
    height: 10,
    baseThickness: 0.75,
    chamfer: 1,
    holeDiameter: 1,
    holeOffset: 5,
    padThickness: 0.375,
    padHeight: 14,
  },
  check(s) {
    if (s.chamfer >= s.projection || s.chamfer >= s.height - s.baseThickness)
      return 'gusset end must be less than the projection and the gusset height';
    if (!both(s.holeDiameter, s.holeOffset))
      return 'a bolt hole needs both its diameter and its offset';
    if (
      s.holeDiameter > 0 &&
      (s.holeOffset <= s.holeDiameter / 2 || s.holeOffset + s.holeDiameter / 2 >= s.projection)
    )
      return 'the bolt hole must lie inside the base';
    if (!both(s.padThickness, s.padHeight)) return 'a pad needs both its thickness and its height';
    if (s.padHeight !== 0 && s.padHeight < s.height)
      return 'pad height must be at least the height';
    return undefined;
  },
  parts(s) {
    const r = s.vesselOD / 2;
    const x0 = r + s.padThickness;
    const tb = s.baseThickness;
    const parts: LibraryPart[] = [];
    if (s.padThickness > 0) {
      const over = (s.padHeight - s.height) / 2;
      parts.push(visible(rect(r, -over, x0, s.height + over)));
    }
    parts.push(
      visible(rect(x0, 0, x0 + s.projection, tb)),
      // The gusset: square at the shell and the base's end, sloped between.
      visible([
        corner(x0, tb),
        corner(x0 + s.projection, tb),
        corner(x0 + s.projection, tb + s.chamfer),
        corner(x0 + s.chamfer, s.height),
        corner(x0, s.height),
      ]),
    );
    if (s.holeDiameter > 0) parts.push(...holeAcross(x0 + s.holeOffset, s.holeDiameter, 0, tb, tb));
    return parts;
  },
};

// --- Skirt (vertical vessel), elevation -----------------------------------------------------

type SkirtKey =
  | 'skirtOD'
  | 'skirtThickness'
  | 'skirtHeight'
  | 'baseRingOD'
  | 'baseRingID'
  | 'baseRingThickness'
  | 'boltCircle'
  | 'holeDiameter'
  | 'openingDiameter'
  | 'openingHeight';

export const SKIRT: DetailGenerator<SkirtKey> = {
  id: 'SKIRT',
  label: 'Skirt support',
  view: 'elevation',
  fields: [
    length('skirtOD', 'D', 'skirt OD'),
    length('skirtThickness', 'T', 'skirt thickness'),
    length('skirtHeight', 'H', 'skirt height'),
    length('baseRingOD', 'BO', 'base ring OD'),
    length('baseRingID', 'BI', 'base ring ID'),
    length('baseRingThickness', 'TB', 'base ring thickness'),
    length('boltCircle', 'BC', 'bolt circle', true),
    length('holeDiameter', 'HD', 'hole diameter', true),
    length('openingDiameter', 'OD', 'access opening diameter', true),
    length('openingHeight', 'OH', 'access opening height', true),
  ],
  defaults: {
    skirtOD: 60,
    skirtThickness: 0.5,
    skirtHeight: 96,
    baseRingOD: 72,
    baseRingID: 54,
    baseRingThickness: 1.25,
    boltCircle: 66,
    holeDiameter: 1.5,
    openingDiameter: 18,
    openingHeight: 36,
  },
  check(s) {
    const r = s.skirtOD / 2;
    if (s.skirtThickness >= r) return 'skirt thickness must be less than half the skirt OD';
    if (s.skirtHeight <= s.baseRingThickness) return 'skirt height must be more than the base ring';
    if (s.baseRingOD <= s.skirtOD) return 'base ring OD must be more than the skirt OD';
    if (s.baseRingID >= s.skirtOD - 2 * s.skirtThickness)
      return 'base ring ID must be less than the skirt ID';
    if (!both(s.boltCircle, s.holeDiameter))
      return 'bolt holes need both their bolt circle and their diameter';
    if (
      s.boltCircle > 0 &&
      (s.boltCircle - s.holeDiameter <= s.skirtOD || s.boltCircle + s.holeDiameter >= s.baseRingOD)
    )
      return 'bolt holes must lie on the base ring outside the skirt';
    if (!both(s.openingDiameter, s.openingHeight))
      return 'an access opening needs both its diameter and its height';
    if (
      s.openingDiameter > 0 &&
      (s.openingDiameter >= s.skirtOD - 2 * s.skirtThickness ||
        s.openingHeight - s.openingDiameter / 2 <= s.baseRingThickness ||
        s.openingHeight + s.openingDiameter / 2 >= s.skirtHeight)
    )
      return 'the access opening must lie inside the skirt above the base ring';
    return undefined;
  },
  parts(s) {
    const r = s.skirtOD / 2;
    const ri = r - s.skirtThickness;
    const tb = s.baseRingThickness;
    const parts: LibraryPart[] = [
      visible(rect(-r, tb, r, s.skirtHeight)),
      visible(rect(-s.baseRingOD / 2, 0, s.baseRingOD / 2, tb)),
    ];
    for (const x of [-ri, ri])
      parts.push({ role: 'hidden', geom: line({ x, y: tb }, { x, y: s.skirtHeight }) });
    for (const x of [-s.baseRingID / 2, s.baseRingID / 2])
      parts.push({ role: 'hidden', geom: line({ x, y: 0 }, { x, y: tb }) });
    if (s.holeDiameter > 0)
      for (const x of [-s.boltCircle / 2, s.boltCircle / 2])
        parts.push(...holeAcross(x, s.holeDiameter, 0, tb, tb));
    if (s.openingDiameter > 0) {
      const ro = s.openingDiameter / 2;
      const m = s.openingDiameter / 8;
      parts.push(
        {
          role: 'visible',
          geom: { kind: 'CIRCLE', center: { x: 0, y: s.openingHeight }, radius: ro },
        },
        centerLine(-ro - m, s.openingHeight, ro + m, s.openingHeight),
      );
    }
    const m = s.skirtOD / 16;
    parts.push(centerLine(0, -m, 0, s.skirtHeight + m));
    return parts;
  },
};

// --- Anchor chair (skirt), elevation from outside --------------------------------------------

type ChairKey =
  | 'holeDiameter'
  | 'gussetSpacing'
  | 'gussetThickness'
  | 'chairHeight'
  | 'topPlateWidth'
  | 'topPlateThickness'
  | 'baseRingThickness'
  | 'ringLengthShown';

export const ANCHOR_CHAIR: DetailGenerator<ChairKey> = {
  id: 'ANCHOR_CHAIR',
  label: 'Anchor chair',
  view: 'elevation',
  fields: [
    length('holeDiameter', 'HD', 'hole diameter'),
    length('gussetSpacing', 'G', 'gusset spacing'),
    length('gussetThickness', 'TG', 'gusset thickness'),
    length('chairHeight', 'HC', 'chair height'),
    length('topPlateWidth', 'WT', 'top plate width'),
    length('topPlateThickness', 'TT', 'top plate thickness'),
    length('baseRingThickness', 'TB', 'base ring thickness'),
    length('ringLengthShown', 'LR', 'base ring length shown'),
  ],
  // For a 1½ in. anchor bolt.
  defaults: {
    holeDiameter: 1.625,
    gussetSpacing: 4,
    gussetThickness: 0.75,
    chairHeight: 12,
    topPlateWidth: 8,
    topPlateThickness: 1,
    baseRingThickness: 1.25,
    ringLengthShown: 14,
  },
  check(s) {
    if (s.holeDiameter >= s.gussetSpacing) return 'the bolt must pass between the gussets';
    if (s.topPlateWidth < s.gussetSpacing + 2 * s.gussetThickness)
      return 'top plate width must cover the gussets';
    if (s.ringLengthShown < s.topPlateWidth)
      return 'base ring length shown must be at least the top plate width';
    return undefined;
  },
  parts(s) {
    const tb = s.baseRingThickness;
    const top = tb + s.chairHeight;
    const g = s.gussetSpacing / 2;
    const parts: LibraryPart[] = [
      visible(rect(-s.ringLengthShown / 2, 0, s.ringLengthShown / 2, tb)),
      visible(rect(-g - s.gussetThickness, tb, -g, top)),
      visible(rect(g, tb, g + s.gussetThickness, top)),
      visible(rect(-s.topPlateWidth / 2, top, s.topPlateWidth / 2, top + s.topPlateThickness)),
    ];
    const d = s.holeDiameter;
    for (const [y0, y1] of [
      [0, tb],
      [top, top + s.topPlateThickness],
    ] as const) {
      parts.push(
        { role: 'hidden', geom: line({ x: -d / 2, y: y0 }, { x: -d / 2, y: y1 }) },
        { role: 'hidden', geom: line({ x: d / 2, y: y0 }, { x: d / 2, y: y1 }) },
      );
    }
    parts.push(centerLine(0, -d, 0, top + s.topPlateThickness + d));
    return parts;
  },
};

/** The supports, in the order the library palette lists them. */
export const SUPPORTS = [SADDLE, LEG, BRACKET, SKIRT, ANCHOR_CHAIR] as const;
