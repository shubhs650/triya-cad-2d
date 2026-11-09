// The status bar's coordinates (M2-20, the Settings "Coordinates" choice). AutoCAD shows them
// in the drawing's linear units, LUNITS (1 scientific, 2 decimal, 3 engineering, 4
// architectural, 5 fractional) at LUPREC (decimal places, or 1/2^LUPREC of an inch), the same
// rules the dimension text follows for DIMLUNIT and DIMDEC, so dims' `formatLinear` formats
// them: feet and inches with both zero parts kept (`0'-0"`, DIMZIN 1) and fractions unstacked
// (DIMFRAC 2). "Decimal" shows LUPREC decimal places whatever the units.
import { formatLinear } from '@triya/dims';
import type { Vec2 } from '@triya/engine';
import type { CoordinateDisplay } from './preferences';

const MAX_PLACES = 8;

export function coordinateText(
  p: Vec2,
  header: ReadonlyMap<string, unknown>,
  mode: CoordinateDisplay,
): string {
  const luprec = header.get('$LUPREC');
  const lunits = header.get('$LUNITS');
  const places = typeof luprec === 'number' ? Math.min(Math.max(luprec, 0), MAX_PLACES) : 4;
  const units = mode === 'drawing' && typeof lunits === 'number' ? lunits : 2;
  const text =
    units === 1 || units === 3 || units === 4 || units === 5
      ? (v: number) => formatLinear(v, { DIMLUNIT: units, DIMDEC: places, DIMZIN: 1, DIMFRAC: 2 })
      : (v: number) => v.toFixed(places);
  return [p.x, p.y, 0].map(text).join(', ');
}
