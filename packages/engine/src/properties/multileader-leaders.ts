// A multileader's Leaders rows in the Properties palette (M2-35 part 12; AutoCAD 2024's
// "Properties Palette — Multileader": Leader type, Leader color, Leader linetype, Leader
// lineweight, Arrowhead, Arrowhead size, Horz landing, Landing distance).
//
// Each edit sets the MULTILEADER's own value and flags it in DXF 90 as overriding the style
// (`MLEADER_OVERRIDES`, the ODA specification's bits as ezdxf names them), as AutoCAD does for
// any property a multileader no longer takes from its MLEADERSTYLE. The leader lines' own
// overrides (LEADER_LINE 93, M1-111) stay: AutoCAD's palette edits the multileader, and a line
// that overrides a property keeps drawing its own.
//
// Where an edit moves geometry, the text stays put, as a drafter who placed it expects (AutoCAD's
// help does not say): a Landing distance keeps where each landing ends, a landing gap from the
// text, and moves where the leader lines meet it (the branch's connection point). Horz landing
// moves nothing: with the dogleg off the lines already run on to where the landing ends
// (`multiLeaderParts`). Both values an annotative multileader keeps per annotation scale (the
// arrowhead size and the landing, in its context data) are refused there, as the Text rows are.
import { arrowheadOptions } from './dimension';
import type { DocumentModel } from '../model/document';
import type { Entity, MultiLeaderGeometry } from '../model/types';
import { MLEADER_OVERRIDES } from '../edit/mleader';
import { parseColorValue, parseLineweightValue, type PropertyValue } from './sheet';

/** The keys of the Leaders rows. */
export const LEADER_KEYS = new Set([
  'leaderType',
  'leaderColor',
  'leaderLinetype',
  'leaderLineweight',
  'arrowhead',
  'arrowheadSize',
  'horzLanding',
  'landingDistance',
]);

const ANNOTATIVE = 'annotative (each scale keeps its own placement)';
const STYLE_ARROWHEAD = 'closed filled would draw its multileader style’s arrowhead';

/**
 * The multileader with Leaders row `key` set to `v` (already read as a distance where the row is
 * one); undefined for another row, `invalid` for a value the row cannot take, or a refusal.
 */
export function multiLeaderLeaderChange(
  model: DocumentModel,
  e: Entity,
  key: string,
  v: PropertyValue,
): MultiLeaderGeometry | 'invalid' | { readonly refuse: string } | undefined {
  if (!LEADER_KEYS.has(key)) return undefined;
  const g = e.geom as MultiLeaderGeometry;
  const flag = (bits: number, next: Partial<MultiLeaderGeometry>): MultiLeaderGeometry => ({
    ...g,
    ...next,
    overrideFlags: g.overrideFlags | bits,
  });
  const number = typeof v === 'number' ? v : Number.NaN;
  const annotative = e.annotative || g.annotative;
  switch (key) {
    case 'leaderType': {
      const pathType = ['0', '1', '2'].indexOf(String(v));
      return pathType < 0 ? 'invalid' : flag(MLEADER_OVERRIDES.pathType, { pathType });
    }
    case 'leaderColor': {
      const lineColor = typeof v === 'string' ? parseColorValue(v) : undefined;
      return lineColor ? flag(MLEADER_OVERRIDES.lineColor, { lineColor }) : 'invalid';
    }
    case 'leaderLinetype':
      return typeof v === 'string' && model.tables.linetypes.has(v)
        ? flag(MLEADER_OVERRIDES.linetype, { linetype: v })
        : 'invalid';
    case 'leaderLineweight': {
      const lineweight = parseLineweightValue(String(v));
      return lineweight === undefined
        ? 'invalid'
        : flag(MLEADER_OVERRIDES.lineweight, { lineweight });
    }
    case 'arrowhead': {
      if (v === '') {
        // No arrowhead block is closed filled only where the style names none: a reader draws
        // the style's arrowhead for a multileader without one (`multiLeaderParts`, ezdxf).
        const own = g.style ? model.tables.mleaderStyles.get(g.style)?.arrowhead : undefined;
        if (own !== undefined) return { refuse: STYLE_ARROWHEAD };
        const { arrowhead: _old, ...rest } = g;
        return { ...rest, overrideFlags: g.overrideFlags | MLEADER_OVERRIDES.arrowhead };
      }
      const offered = arrowheadOptions(model, [g.arrowhead]).some((o) => o.value === v);
      return offered && typeof v === 'string'
        ? flag(MLEADER_OVERRIDES.arrowhead, { arrowhead: v })
        : 'invalid';
    }
    case 'arrowheadSize': {
      if (!Number.isFinite(number) || number < 0) return 'invalid';
      if (annotative) return { refuse: ANNOTATIVE };
      // The context data draws it at the overall scale, as the multileader last drew it.
      const ratio =
        g.drawnArrowheadSize !== undefined && g.arrowheadSize > 0
          ? g.drawnArrowheadSize / g.arrowheadSize
          : g.scale;
      return flag(MLEADER_OVERRIDES.arrowheadSize, {
        arrowheadSize: number,
        drawnArrowheadSize: number * ratio,
      });
    }
    case 'horzLanding': {
      if (v !== 'yes' && v !== 'no') return 'invalid';
      // A dogleg needs the landing on (290); turning the dogleg off leaves 290 as it was.
      return v === 'yes'
        ? flag(MLEADER_OVERRIDES.landing | MLEADER_OVERRIDES.dogleg, {
            landing: true,
            dogleg: true,
          })
        : flag(MLEADER_OVERRIDES.dogleg, { dogleg: false });
    }
    case 'landingDistance': {
      if (!Number.isFinite(number) || number < 0) return 'invalid';
      if (annotative) return { refuse: ANNOTATIVE };
      const branches = g.branches.map((b) => {
        const len = Math.hypot(b.direction.x, b.direction.y);
        if (len === 0) return { ...b, doglegLength: number };
        const k = (b.doglegLength - number) / len;
        const connection = {
          x: b.connection.x + b.direction.x * k,
          y: b.connection.y + b.direction.y * k,
        };
        return { ...b, connection, doglegLength: number };
      });
      return flag(MLEADER_OVERRIDES.doglegLength, { doglegLength: number, branches });
    }
  }
  return undefined;
}
