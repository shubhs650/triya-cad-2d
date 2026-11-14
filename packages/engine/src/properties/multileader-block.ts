// A block multileader's Block rows in the Properties palette (M2-35 part 15). AutoCAD's help does
// not list the palette's rows for block content; they follow ActiveX AcadMLeader's
// ContentBlockName and BlockScale, and the block colour and rotation the context data states
// (DXF 93, 46), with labels from MLEADERSTYLE's Block options: Source block, Block color, Block
// scale and Block rotation.
//
// Each edit sets the multileader's own value and flags it in DXF 90 (the ODA specification's
// BLOCK_CONTENT_ID, _COLOR, _SCALE and _ROTATION, bits 19 to 22). Block scale is the block's
// own: what it is drawn at over the overall scale (DXF 45), as the style's block scale is.
//
// The block stays on its landing, as a drafter who placed it expects (AutoCAD's help does not
// say): the side of its box that faces the landing is kept, as MLEADER attaches block content by
// its extents (`blockAnchor`, which bounds a turned block by its turned extents box), so a bigger
// block grows away from the leader. Where the style
// connects block content by its insertion point (block connection 1), or the canvas-free
// engine cannot bound the block (text only), the insertion point is kept instead. Another source
// block takes its attribute definitions' values, as MLEADER offers them; the old block's values
// belong to its own definitions. Content and placement are kept per annotation scale in the
// context data, so an annotative multileader refuses these edits (M2-43), as its Text rows do.
import type { Box } from '../geom/bounds';
import type { Vec2 } from '../geom/types';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type {
  BlockDefinition,
  Entity,
  MultiLeaderAttribute,
  MultiLeaderBlock,
  MultiLeaderGeometry,
} from '../model/types';
import { MLEADER_BLOCK, MLEADER_OVERRIDES, blockContentBox } from '../edit/mleader';
import { parseAngleValue, parseNumber } from '../commands/parse';
import { parseColorValue, type PropertyValue } from './sheet';

/** The keys of the Block rows. */
export const BLOCK_KEYS = new Set(['sourceBlock', 'blockColor', 'blockScale', 'blockRotation']);

const ANNOTATIVE = 'annotative (each scale keeps its own placement)';

/** The multileader's block content, when its content is a block (MLEADER's "Block"). */
export function blockOf(g: MultiLeaderGeometry): MultiLeaderBlock | undefined {
  return g.contentType === MLEADER_BLOCK ? g.block : undefined;
}

/**
 * A block a multileader can show: named (not anonymous, so not a layout's either), not an xref
 * nor one of an xref's blocks (DXF 70 bits 4 and 32, or a `|` in its name).
 */
export function isContentBlock(b: BlockDefinition): boolean {
  return (
    b.name !== '' &&
    !b.name.startsWith('*') &&
    !b.name.includes('|') &&
    b.xrefPath === undefined &&
    ((b.flags ?? 0) & (4 | 32)) === 0
  );
}

/** What the block's own scale reads as: the X scale drawn over the overall scale. */
export function blockScaleValue(g: MultiLeaderGeometry, b: MultiLeaderBlock): number {
  return Math.abs(b.scale.x) / (g.scale > 0 ? g.scale : 1);
}

/**
 * The multileader with Block row `key` set to `v`; undefined for another row or a multileader
 * without block content, `invalid` for a value the row cannot take, or a refusal.
 */
export function multiLeaderBlockChange(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
): MultiLeaderGeometry | 'invalid' | { readonly refuse: string } | undefined {
  const g = e.geom as MultiLeaderGeometry;
  const b = blockOf(g);
  if (!b || !BLOCK_KEYS.has(key)) return undefined;
  let next: MultiLeaderBlock;
  let bit: number;
  switch (key) {
    case 'sourceBlock': {
      const def = typeof v === 'string' ? model.blocks.get(v) : undefined;
      if (!def || !isContentBlock(def)) return 'invalid';
      const { attributes: _old, ...rest } = b;
      const attributes = attributeDefaults(model, def.handle);
      next = { ...rest, block: def.handle, ...(attributes.length > 0 && { attributes }) };
      bit = MLEADER_OVERRIDES.blockContent;
      break;
    }
    case 'blockColor': {
      const color = typeof v === 'string' ? parseColorValue(v) : undefined;
      if (!color) return 'invalid';
      next = { ...b, color };
      bit = MLEADER_OVERRIDES.blockColor;
      break;
    }
    case 'blockScale': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v.trim()) : NaN;
      if (n === undefined || !Number.isFinite(n) || n <= 0) return 'invalid';
      // A mirrored block stays mirrored.
      const k = n * (g.scale > 0 ? g.scale : 1);
      const signed = (s: number) => (s < 0 ? -k : k);
      next = { ...b, scale: { x: signed(b.scale.x), y: signed(b.scale.y), z: signed(b.scale.z) } };
      bit = MLEADER_OVERRIDES.blockScale;
      break;
    }
    default: {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseAngleValue(v) : NaN;
      if (n === undefined || !Number.isFinite(n)) return 'invalid';
      next = { ...b, rotation: n };
      bit = MLEADER_OVERRIDES.blockRotation;
    }
  }
  if (e.annotative || g.annotative) return { refuse: ANNOTATIVE };
  if (key !== 'blockColor') next = { ...next, position: keptOnLanding(model, g, b, next) };
  return { ...g, block: next, overrideFlags: g.overrideFlags | bit };
}

/** The block's non-constant attribute definitions, each at its value (MLEADER's defaults). */
function attributeDefaults(model: DocumentModel, block: Handle): MultiLeaderAttribute[] {
  const out: MultiLeaderAttribute[] = [];
  for (const id of model.blockEntities(block)) {
    const d = model.entity(id)!;
    if (d.geom.kind !== 'ATTDEF' || (d.geom.flags & 2) !== 0) continue;
    // DXF 44 "attribute width": 1, as MLEADER and ezdxf write it.
    out.push({ definition: d.handle, index: out.length, width: 1, value: d.geom.value });
  }
  return out;
}

/**
 * Where `next` goes so that the side of its box facing the landing is where `before`'s was (see
 * the file comment); its insertion point as before where the style connects by it, or where
 * either block has no known extents.
 */
function keptOnLanding(
  model: DocumentModel,
  g: MultiLeaderGeometry,
  before: MultiLeaderBlock,
  next: MultiLeaderBlock,
): Vec2 {
  const style = g.style === undefined ? undefined : model.tables.mleaderStyles.get(g.style);
  if (style?.blockConnection === 1) return before.position;
  const was = blockContentBox(model, before);
  const now = blockContentBox(model, { ...next, position: before.position });
  if (!was || !now) return before.position;
  const a = facingPoint(was, g);
  const c = facingPoint(now, g);
  return { x: before.position.x + a.x - c.x, y: before.position.y + a.y - c.y };
}

/**
 * The point of `box` facing the landings: for landings running right (towards content on their
 * right) its left edge's middle, running left its right edge's, running up its bottom's, down
 * its top's; between landings on both sides, or with none, its middle that way.
 */
function facingPoint(box: Box, g: MultiLeaderGeometry): Vec2 {
  const sides = (along: (d: Vec2) => number, across: (d: Vec2) => number) => {
    const out = new Set<number>();
    for (const br of g.branches) {
      const d = br.direction;
      if (Math.abs(along(d)) > Math.abs(across(d))) out.add(Math.sign(along(d)));
    }
    return out;
  };
  const pick = (s: Set<number>, min: number, max: number): number =>
    s.size === 1 ? (s.has(1) ? min : max) : (min + max) / 2;
  const x = sides(
    (d) => d.x,
    (d) => d.y,
  );
  const y = sides(
    (d) => d.y,
    (d) => d.x,
  );
  return { x: pick(x, box.minX, box.maxX), y: pick(y, box.minY, box.maxY) };
}
