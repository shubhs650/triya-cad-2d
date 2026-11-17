// A table's Table Breaks rows in the Properties palette (M4-16 part 10), after AutoCAD 2024's:
// Enabled, Direction, Repeat top labels, Repeat bottom labels, Manual positions, Manual heights,
// Break height and Spacing. An edit sets the table's break settings (`TableGeometry.breaks`),
// starting from the defaults the breaking grip starts on, and the bus draws its `*T` block again.
import { parseNumber } from '../commands/parse';
import { defaultTableBreaks } from '../annotation/table-breaks';
import type { Entity, TableBreaks, TableGeometry } from '../model/types';
import type { PropertyOption, PropertyValue } from './sheet';

/** The Yes/No rows and the setting each one is. */
export const TABLE_BREAK_FLAGS = {
  breaksEnabled: 'enabled',
  breaksRepeatTop: 'repeatTop',
  breaksRepeatBottom: 'repeatBottom',
  breaksManualPositions: 'manualPositions',
  breaksManualHeights: 'manualHeights',
} as const;
export type TableBreakFlag = keyof typeof TABLE_BREAK_FLAGS;

export const TABLE_BREAK_DIRECTIONS: readonly PropertyOption[] = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'down', label: 'Down' },
];

const KEYS = new Set<string>([
  ...Object.keys(TABLE_BREAK_FLAGS),
  'breaksDirection',
  'breaksHeight',
  'breaksSpacing',
]);

/** Whether `key` is a Table Breaks row. */
export const isTableBreakKey = (key: string): boolean => KEYS.has(key);

/**
 * Table `e` with Table Breaks row `key` set to `v`; 'invalid' for a value the row does not take
 * (a break height not above 0, a spacing below 0), undefined for another row or object.
 */
export function tableBreakChange(
  e: Entity,
  key: string,
  v: PropertyValue,
): TableGeometry | 'invalid' | undefined {
  if (!KEYS.has(key) || e.geom.kind !== 'ACAD_TABLE') return undefined;
  const g = e.geom;
  const b = g.breaks ?? defaultTableBreaks(g);
  let next: TableBreaks;
  if (key in TABLE_BREAK_FLAGS) {
    const on = v === true || v === 'yes' ? true : v === false || v === 'no' ? false : undefined;
    if (on === undefined) return 'invalid';
    next = { ...b, [TABLE_BREAK_FLAGS[key as TableBreakFlag]]: on };
  } else if (key === 'breaksDirection') {
    if (v !== 'right' && v !== 'left' && v !== 'down') return 'invalid';
    next = { ...b, direction: v };
  } else {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumber(v.trim()) : undefined;
    if (n === undefined || !Number.isFinite(n)) return 'invalid';
    if (key === 'breaksHeight' ? n <= 0 : n < 0) return 'invalid';
    next = key === 'breaksHeight' ? { ...b, height: n } : { ...b, spacing: n };
  }
  return { ...g, breaks: next };
}
