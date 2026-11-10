// AutoCAD's built-in multileader content blocks (M2-25): the Source block list of the
// Multileader Style Manager's Content tab ("Detail Callout", "Circle", "Box", "Slot",
// "Hexagon", "Triangle"; AutoCAD 2024 Help, "Modify Multileader Style Dialog Box"), which
// AutoCAD adds to a drawing as `_DetailCallout`, `_TagCircle`, `_TagBox`, `_TagSlot`,
// `_TagHexagon` and `_TagTriangle` when a multileader first uses one. Triya authors them from
// the published shapes when a drafter names one the drawing lacks (never copied from an
// AutoCAD install: CLAUDE.md, "No Autodesk assets").
//
// The help gives the shapes and their attributes but not their sizes. Our reading, kept to the
// common drafter expectation that a tag reads at the leader's text size: every shape is
// centred on the block's base point and sized from the text height `h` of the multileader
// style that first uses it (the tag number `h` high; the circle, box, slot and hexagon leave
// 1.5 h round the middle; the triangle's inscribed circle is 1.5 h; the detail callout's
// circle is 2 h with its view number above the line and its sheet number below). The tags'
// prompts and defaults are AutoCAD's: "Enter tag number <TAGNUMBER>", "Enter view number
// <VIEWNUMBER>", "Enter sheet number <SHEETNUMBER>". Every part is on layer 0, ByBlock, so the
// style's block colour shows through.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import type { ChangeSetBuilder } from '../model/builder';
import type { Handle } from '../model/handle';
import type { AttdefGeometry, EntityGeometry } from '../model/types';

/** The built-in content blocks, in the order AutoCAD's Source block list gives them. */
export const BUILTIN_MLEADER_BLOCKS = [
  '_DetailCallout',
  '_TagCircle',
  '_TagBox',
  '_TagSlot',
  '_TagHexagon',
  '_TagTriangle',
] as const;

/** A built-in content block as Triya authors it, before it is in the drawing. */
export interface BuiltinMLeaderBlock {
  readonly name: string;
  /** What it draws, in order: the shape, then its attribute definitions. */
  readonly parts: readonly EntityGeometry[];
  /** The attribute definitions among `parts`, in order. */
  readonly attdefs: readonly AttdefGeometry[];
  /** Its extents about the base point (the origin). */
  readonly extents: Box;
}

/** The built-in block a name means (any case), or undefined. */
export function builtinMLeaderBlockName(name: string): string | undefined {
  const n = name.trim().toUpperCase();
  return BUILTIN_MLEADER_BLOCKS.find((b) => b.toUpperCase() === n);
}

/** A middle-centre attribute definition at `at`, `h` high. */
function attdef(tag: string, prompt: string, at: Vec2, h: number, style: Handle): AttdefGeometry {
  return {
    kind: 'ATTDEF',
    tag,
    prompt,
    value: tag,
    flags: 0,
    style,
    position: at,
    alignmentPoint: at,
    height: h,
    rotation: 0,
    widthFactor: 1,
    oblique: 0,
    halign: 1,
    valign: 2,
    backward: false,
    upsideDown: false,
  };
}

/** A closed polyline through `pts` (bulges where given). */
const closed = (pts: readonly (Vec2 & { bulge?: number })[]): EntityGeometry => ({
  kind: 'LWPOLYLINE',
  vertices: pts.map((p) => ({ x: p.x, y: p.y, bulge: p.bulge ?? 0 })),
  closed: true,
});

const square = (r: number): Box => ({ minX: -r, minY: -r, maxX: r, maxY: r });

/**
 * Built-in block `name` (one of `BUILTIN_MLEADER_BLOCKS`) for text `h` high in text style
 * `style`.
 */
export function builtinMLeaderBlock(
  name: string,
  h: number,
  style: Handle,
): BuiltinMLeaderBlock | undefined {
  const canonical = builtinMLeaderBlockName(name);
  if (!canonical) return undefined;
  const r = 1.5 * h;
  const o = { x: 0, y: 0 };
  const tag = () => attdef('TAGNUMBER', 'Enter tag number', o, h, style);
  let shape: EntityGeometry[];
  let attdefs: AttdefGeometry[];
  let extents: Box;
  switch (canonical) {
    case '_DetailCallout': {
      const R = 2 * h;
      shape = [
        { kind: 'CIRCLE', center: o, radius: R },
        { kind: 'LINE', start: { x: -R, y: 0 }, end: { x: R, y: 0 } },
      ];
      attdefs = [
        attdef('VIEWNUMBER', 'Enter view number', { x: 0, y: R / 2 }, h, style),
        attdef('SHEETNUMBER', 'Enter sheet number', { x: 0, y: -R / 2 }, h, style),
      ];
      extents = square(R);
      break;
    }
    case '_TagCircle':
      shape = [{ kind: 'CIRCLE', center: o, radius: r }];
      attdefs = [tag()];
      extents = square(r);
      break;
    case '_TagBox':
      shape = [
        closed([
          { x: -r, y: -r },
          { x: r, y: -r },
          { x: r, y: r },
          { x: -r, y: r },
        ]),
      ];
      attdefs = [tag()];
      extents = square(r);
      break;
    case '_TagSlot':
      // Straight sides 2r long, round ends of radius r: bulge 1 is a half circle.
      shape = [
        closed([
          { x: -r, y: -r },
          { x: r, y: -r, bulge: 1 },
          { x: r, y: r },
          { x: -r, y: r, bulge: 1 },
        ]),
      ];
      attdefs = [tag()];
      extents = { minX: -2 * r, minY: -r, maxX: 2 * r, maxY: r };
      break;
    case '_TagHexagon': {
      // Flat top and bottom r from the middle; corners left and right.
      const R = r / Math.cos(Math.PI / 6);
      shape = [
        closed(
          [0, 1, 2, 3, 4, 5].map((i) => ({
            x: R * Math.cos((i * Math.PI) / 3),
            y: R * Math.sin((i * Math.PI) / 3),
          })),
        ),
      ];
      attdefs = [tag()];
      extents = { minX: -R, minY: -r, maxX: R, maxY: r };
      break;
    }
    default: {
      // _TagTriangle: point up, its inscribed circle r about the middle (corners 2r out).
      const R = 2 * r;
      const pts = [90, 210, 330].map((deg) => ({
        x: R * Math.cos((deg * Math.PI) / 180),
        y: R * Math.sin((deg * Math.PI) / 180),
      }));
      shape = [closed(pts)];
      attdefs = [tag()];
      extents = { minX: pts[1]!.x, minY: -r, maxX: pts[2]!.x, maxY: R };
      break;
    }
  }
  return { name: canonical, parts: [...shape, ...attdefs], attdefs, extents };
}

/**
 * Adds built-in block `def` to the drawing: its definition, based at the origin, and its parts
 * on layer `zero`, ByBlock. Returns the block's handle and its attribute definitions' handles.
 */
export function addBuiltinMLeaderBlock(
  b: ChangeSetBuilder,
  def: BuiltinMLeaderBlock,
  zero: Handle,
): { block: Handle; attdefs: Handle[] } {
  const block = b.addBlock({ name: def.name, basePoint: { x: 0, y: 0 } }).handle;
  const attdefs: Handle[] = [];
  for (const geom of def.parts) {
    const e = b.addEntity({
      owner: block,
      layer: zero,
      geom,
      color: { kind: 'byBlock' },
      linetype: 'ByBlock',
      lineweight: 'ByBlock',
    });
    if (geom.kind === 'ATTDEF') attdefs.push(e.handle);
  }
  return { block, attdefs };
}
