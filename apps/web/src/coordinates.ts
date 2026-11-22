// The status bar's coordinates (M2-20, the Settings "Coordinates" choice). AutoCAD shows them
// in the drawing's linear units, LUNITS (1 scientific, 2 decimal, 3 engineering, 4
// architectural, 5 fractional) at LUPREC (decimal places, or 1/2^LUPREC of an inch), the same
// rules the dimension text follows for DIMLUNIT and DIMDEC, so dims' `formatLinear` formats
// them: feet and inches with both zero parts kept (`0'-0"`, DIMZIN 1) and fractions unstacked
// (DIMFRAC 2). "Decimal" shows LUPREC decimal places whatever the units.
//
// The units are the drawing's as edited, not as opened (M2-73): SETVAR LUNITS, UNITS and their
// undo change the header through change sets, as every edit, so the status bar reads the header
// as the drawing's change log leaves it, as Dynamic Input and the command line read the units
// the engine's header holds now.
//
// M3-06 part 7: they are the current UCS's (the header's $UCSORG and axes, $PUCS* in a layout),
// as AutoCAD's are; `ucs` is a layout viewport's own while it is current with UCSVP on (M6-02
// part 20).
//
// M7-06 part 3: COORDS (Ctrl+I) chooses whether they follow the cursor, change only as points are
// picked, or show the distance<angle from a rubber band's start (`shownCoordinates`).
import { formatLinear } from '@triya/dims';
import { toUcs, ucsOf, type ChangeSet, type PlanUcs, type Prompt, type Vec2 } from '@triya/engine';
import { typedAngle, type DynUnits } from './dynamic-input';
import type { CoordinateDisplay } from './preferences';

const MAX_PLACES = 8;

export function coordinateText(
  world: Vec2,
  header: ReadonlyMap<string, unknown>,
  mode: CoordinateDisplay,
  paper = false,
  ucs?: PlanUcs,
): string {
  const p = toUcs(ucs ?? ucsOf(header, paper), world);
  const text = lengthText(header, mode);
  return [p.x, p.y, 0].map(text).join(', ');
}

/** How a length shows: the drawing's units at LUPREC, or LUPREC decimal places. */
function lengthText(header: ReadonlyMap<string, unknown>, mode: CoordinateDisplay) {
  const luprec = header.get('$LUPREC');
  const lunits = header.get('$LUNITS');
  const places = typeof luprec === 'number' ? Math.min(Math.max(luprec, 0), MAX_PLACES) : 4;
  const units = mode === 'drawing' && typeof lunits === 'number' ? lunits : 2;
  return units === 1 || units === 3 || units === 4 || units === 5
    ? (v: number) => formatLinear(v, { DIMLUNIT: units, DIMDEC: places, DIMZIN: 1, DIMFRAC: 2 })
    : (v: number) => v.toFixed(places);
}

/**
 * COORDS 2 at a prompt drawing a rubber band (M7-06 part 3): the cursor's distance and angle from
 * where the band starts, `5.0000<45, 0.0000`, the angle as it would be typed (ANGBASE, ANGDIR,
 * the UCS: `typedAngle`) in the drawing's angular units, as AutoCAD shows them.
 */
export function polarCoordinateText(
  from: Vec2,
  to: Vec2,
  header: ReadonlyMap<string, unknown>,
  mode: CoordinateDisplay,
  units: DynUnits,
): string {
  const text = lengthText(header, mode);
  return `${text(Math.hypot(to.x - from.x, to.y - from.y))}<${typedAngle(from, to, units)}, ${text(0)}`;
}

/**
 * COORDS (M7-06 part 3; AutoCAD 2024 Help, "COORDS (System Variable)"): 0 the coordinates are
 * updated only as points are picked, 1 they follow the cursor (initially), 2 they follow it, its
 * distance<angle from the last point at a prompt that draws a rubber band from it.
 */
export type Coords = 0 | 1 | 2;

/** What the status bar's coordinates show: a point, a distance<angle, or nothing. */
export function shownCoordinates(
  coords: Coords,
  at: {
    readonly cursor?: Vec2 | undefined;
    readonly picked?: Vec2 | undefined;
    readonly band?: Vec2 | undefined;
  },
): { readonly point: Vec2 } | { readonly from: Vec2; readonly to: Vec2 } | undefined {
  if (coords === 0) return at.picked && { point: at.picked };
  if (!at.cursor) return undefined;
  if (coords === 2 && at.band) return { from: at.band, to: at.cursor };
  return { point: at.cursor };
}

/**
 * Where the prompt's rubber band starts, for COORDS 2: a point prompt's line from the last point,
 * or a distance's or angle's base. Not a window's or a selection's box, which measure no
 * distance from a point.
 */
export function bandStart(prompt: Prompt | undefined): Vec2 | undefined {
  if (prompt?.kind === 'point') {
    const band = prompt.rubberBand;
    return band && !band.box && !band.selection && !band.path ? band.from : undefined;
  }
  if (prompt?.kind === 'distance' || prompt?.kind === 'angle') return prompt.base;
  return undefined;
}

/** Ctrl+I: off when on; on again as it was last (`lastOn`), else 1. */
export function toggledCoords(coords: Coords, lastOn: Coords = 1): Coords {
  return coords !== 0 ? 0 : lastOn === 0 ? 1 : lastOn;
}

/** The header as opened with `changes` applied in order; an entry changed to undefined is gone. */
export function editedHeader(
  opened: Iterable<readonly [string, unknown]> | undefined,
  changes: readonly ChangeSet[],
): Map<string, unknown> {
  const header = new Map<string, unknown>(opened ?? []);
  for (const cs of changes)
    for (const { name, after } of cs.header ?? []) {
      if (after === undefined) header.delete(name);
      else header.set(name, after);
    }
  return header;
}
