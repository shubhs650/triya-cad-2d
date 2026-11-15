// FILTER's filters (M3-04 part 4): the named filters, which AutoCAD keeps per user in filter.nfl
// and Triya in the user's settings (preferences.ts `filters`), and the unnamed filter, whose
// properties "remain available during the current work session" (AutoCAD Help, "Object
// Selection Filters Dialog Box"), as does the filter last made current.
import {
  FILTER_NAME_MAX,
  NAME_KEYS,
  NUMBER_KEYS,
  POINT_KEYS,
  type FilterItem,
} from '@triya/engine';

export type NamedFilters = Readonly<Record<string, readonly FilterItem[]>>;

/** The Current list's entry for the filter that has no name. */
export const UNNAMED = '*unnamed';

const KEYS = new Set<string>([
  'Begin',
  'End',
  'Object',
  ...NAME_KEYS,
  ...NUMBER_KEYS,
  ...POINT_KEYS,
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stored named filters: any whose name or lines are not a filter's are left out. */
export function normalizeFilters(raw: unknown): NamedFilters {
  if (!isRecord(raw)) return {};
  const out: Record<string, readonly FilterItem[]> = {};
  for (const [name, list] of Object.entries(raw)) {
    if (!validName(name) || !Array.isArray(list)) continue;
    if (list.every((i) => isRecord(i) && typeof i['key'] === 'string' && KEYS.has(i['key'])))
      out[name] = list as FilterItem[];
  }
  return out;
}

/** Save As: "Names can contain up to 18 characters"; `*unnamed` is no name. */
export function validName(name: string): boolean {
  return name.trim() !== '' && name.length <= FILTER_NAME_MAX && !name.startsWith('*');
}

class SelectionFilters {
  #named: NamedFilters = {};
  #persist: (named: NamedFilters) => void = () => undefined;
  /** The unnamed filter's lines and the filter last current, for this session. */
  unnamed: readonly FilterItem[] = [];
  current = UNNAMED;

  get named(): NamedFilters {
    return this.#named;
  }

  /** The stored filters (as they load or change) and where a change is saved. */
  bind(named: NamedFilters, persist: (named: NamedFilters) => void): void {
    this.#named = named;
    this.#persist = persist;
  }

  /** The lines of the filter `name` (the unnamed one's for `*unnamed` or a name not saved). */
  list(name: string): readonly FilterItem[] {
    return name === UNNAMED ? this.unnamed : (this.#named[name] ?? this.unnamed);
  }

  save(name: string, list: readonly FilterItem[]): void {
    this.#named = { ...this.#named, [name]: list };
    this.#persist(this.#named);
  }

  remove(name: string): void {
    const rest = { ...this.#named };
    delete rest[name];
    this.#named = rest;
    this.#persist(rest);
  }
}

export const selectionFilters = new SelectionFilters();
