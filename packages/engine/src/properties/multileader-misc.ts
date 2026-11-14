// A multileader's Misc rows in the Properties palette (M2-35 part 25). AutoCAD's help does not
// list the palette's rows for a multileader; these follow ActiveX AcadMLeader's StyleName and
// ScaleFactor and the Annotative row every annotative object shows: Multileader style and
// Annotative are shown (another style's values re-applied is left on M2-35; annotative
// multileaders are M2-43), Overall scale is set.
//
// Overall scale (DXF 45) is what the style's sizes are drawn at. The context data states them
// drawn (text height and wrap width, landing gap, arrowhead size, each landing's length, the
// block's scale), so an edit multiplies those by the change, as AutoCAD's own MLEADERSCALE
// change does; the entity's values before the scale (DXF 41, 42) stay. Where it grows from is
// not in AutoCAD's help: the arrowheads (the leader lines' vertices) stay where they point, and
// the content stays at its anchor (context DXF 10) and grows about it, as a drafter who placed
// the note expects; each landing keeps its place against the content, so the point where the
// leader lines meet it moves. A similarity about one point keeps wrapped text on the same lines
// and the text's attachment to its landing, with no measuring. An annotative multileader keeps
// its placement per annotation scale, so it refuses the edit, as its Text and Block rows do.
import type { Vec2 } from '../geom/types';
import type { Entity, MultiLeaderGeometry } from '../model/types';
import { MLEADER_OVERRIDES } from '../edit/mleader';
import { parseNumber } from '../commands/parse';
import type { PropertyValue } from './sheet';

/** The keys of the Misc rows an edit can set. */
export const MISC_KEYS = new Set(['overallScale']);

const ANNOTATIVE = 'annotative (each scale keeps its own placement)';

/**
 * The multileader with Misc row `key` set to `v`; undefined for another row, `invalid` for a
 * value the row cannot take, or a refusal.
 */
export function multiLeaderMiscChange(
  e: Entity,
  key: string,
  v: PropertyValue,
): MultiLeaderGeometry | 'invalid' | { readonly refuse: string } | undefined {
  if (!MISC_KEYS.has(key)) return undefined;
  const g = e.geom as MultiLeaderGeometry;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v.trim()) : NaN;
  if (n === undefined || !Number.isFinite(n) || n <= 0) return 'invalid';
  if (e.annotative || g.annotative) return { refuse: ANNOTATIVE };
  return rescaled(g, n);
}

/** `g` at overall scale `scale`: what is drawn grown about the content's anchor. */
function rescaled(g: MultiLeaderGeometry, scale: number): MultiLeaderGeometry {
  const k = g.scale > 0 ? scale / g.scale : 1;
  const c = g.contentBase;
  const about = (p: Vec2): Vec2 => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k });
  const t = g.text;
  const b = g.block;
  return {
    ...g,
    scale,
    overrideFlags: g.overrideFlags | MLEADER_OVERRIDES.scale,
    landingGap: g.landingGap * k,
    ...(g.drawnArrowheadSize !== undefined && { drawnArrowheadSize: g.drawnArrowheadSize * k }),
    ...(t && {
      text: {
        ...t,
        position: about(t.position),
        height: t.height * k,
        width: t.width * k,
        boundaryHeight: t.boundaryHeight * k,
      },
    }),
    ...(b && {
      block: {
        ...b,
        position: about(b.position),
        scale: { x: b.scale.x * k, y: b.scale.y * k, z: b.scale.z * k },
      },
    }),
    branches: g.branches.map((br) => {
      const d = br.direction;
      const end = about({
        x: br.connection.x + d.x * br.doglegLength,
        y: br.connection.y + d.y * br.doglegLength,
      });
      const length = br.doglegLength * k;
      return {
        ...br,
        doglegLength: length,
        connection: { x: end.x - d.x * length, y: end.y - d.y * length },
      };
    }),
  };
}
