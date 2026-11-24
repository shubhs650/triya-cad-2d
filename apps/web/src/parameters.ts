// The Parameters Manager's rows (M9-03 part 5): what the drawing's engine sends while the palette
// shows its drawing, per drawing, and how the palette shows and narrows them.
import type { ParameterInfo } from '@triya/engine';

/** The rows the drawings' engines sent, per drawing, for the palette to show. */
export class ParameterRows {
  readonly #rows = new Map<number, readonly ParameterInfo[]>();
  readonly #listeners = new Set<() => void>();

  set(doc: number, rows: readonly ParameterInfo[]): void {
    this.#rows.set(doc, rows);
    for (const l of this.#listeners) l();
  }

  get(doc: number | undefined): readonly ParameterInfo[] | undefined {
    return doc === undefined ? undefined : this.#rows.get(doc);
  }

  forget(doc: number): void {
    if (this.#rows.delete(doc)) for (const l of this.#listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const parameterRows = new ParameterRows();

/**
 * The Value column: a distance to four places, an angle in degrees, or why there is none (an
 * expression naming a parameter that is gone, say).
 */
export function parameterValueText(row: ParameterInfo): string {
  if (row.value === undefined) return row.error ?? '';
  const n = row.value.toFixed(4);
  return row.type === 'Angular' ? `${n}°` : n;
}

/**
 * The rows whose name, expression or description holds `search`, any case: AutoCAD's "Search
 * for parameter" box narrows the list as it is typed.
 */
export function searchParameters(
  rows: readonly ParameterInfo[],
  search: string,
): readonly ParameterInfo[] {
  const s = search.trim().toLowerCase();
  if (s === '') return rows;
  return rows.filter((r) =>
    [r.name, r.expression, r.description].some((v) => v.toLowerCase().includes(s)),
  );
}
