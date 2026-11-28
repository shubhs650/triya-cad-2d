// The Compare palette's state (M8-06, PRD FR-Z3, DEC-092): the two drawings picked, the settings,
// and the last compare drawing made, with its results list's filters. It spans drawings (the
// original, the revision and the compare drawing are three tabs), so it is the app's, not a
// drawing's; COMPARE and COMPARECLOSE (and the View tab's Compare) open and close the palette.
//
// AutoCAD 2024 Help, "COMPARE (Command)" and "Compare Settings": the drawing compared with the
// current one is picked in a file dialog; objects only in one drawing, only in the other, and in
// both are shown in their colours, with a list of the changes to step through and "Export" of a
// snapshot. Triya picks both drawings (open ones, or files read without opening them), writes the
// result to a compare drawing of its own (packages/compare `compareMarkup`) and lists every
// difference with a Zoom to it, filtered by status, layer and type.
import type { CompareChange, CompareFilter, CompareMarkup, MarkedItem } from '@triya/compare';
import type { EntityId, EntityType, Handle } from '@triya/engine';

/** A drawing the compare reads: an open drawing as it stands now, or a file. */
export type CompareSource =
  | { readonly kind: 'open'; readonly doc: number; readonly name: string }
  | { readonly kind: 'file'; readonly file: File; readonly name: string };

/** The palette's Settings. */
export interface CompareOptions {
  /** How far a point may move and still be the same, drawing units; '' is the drawings' own. */
  readonly tolerance: string;
  readonly matchHandles: boolean;
  readonly properties: boolean;
}

/** A compare drawing made. */
export interface CompareRun {
  /** The compare drawing's document. */
  readonly doc: number;
  readonly name: string;
  readonly original: string;
  readonly revision: string;
  readonly markup: CompareMarkup;
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly modified: number;
    readonly unchanged: number;
  };
  /** The compare drawing's objects by handle, as its engine numbers them. */
  readonly ids: ReadonlyMap<Handle, EntityId>;
}

export interface CompareState {
  readonly original?: CompareSource;
  readonly revision?: CompareSource;
  readonly options: CompareOptions;
  /** What the compare is doing, while it runs. */
  readonly busy?: string | undefined;
  /** Why the last compare did not run. */
  readonly message?: string | undefined;
  readonly run?: CompareRun;
  readonly filter: CompareFilter;
}

export const ALL_DIFFERENCES: CompareFilter = {
  statuses: ['added', 'removed', 'modified'],
  unchanged: true,
};

const INITIAL: CompareState = {
  options: { tolerance: '', matchHandles: true, properties: true },
  filter: ALL_DIFFERENCES,
};

export class CompareSession {
  #state: CompareState = INITIAL;
  readonly #listeners = new Set<() => void>();

  readonly getSnapshot = (): CompareState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  update(patch: Partial<CompareState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }

  /** A drawing closed: a source or compare drawing that was it goes. */
  closed(doc: number): void {
    const s = this.#state;
    const gone = (x: CompareSource | undefined) => x?.kind === 'open' && x.doc === doc;
    if (!gone(s.original) && !gone(s.revision) && s.run?.doc !== doc) return;
    const { original, revision, run, ...rest } = s;
    this.#state = {
      ...rest,
      ...(original && !gone(original) && { original }),
      ...(revision && !gone(revision) && { revision }),
      ...(run && run.doc !== doc && { run }),
    };
    for (const l of this.#listeners) l();
  }
}

export const compareSession = new CompareSession();

/** The tolerance typed: undefined for the drawings' own, NaN when it is not a distance. */
export function toleranceOf(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : Number.NaN;
}

const stem = (name: string): string => name.replace(/\.(dwg|dxf)$/i, '');

/**
 * The compare drawing's name, as AutoCAD 2019's DWG Compare named its result: Compare_ with the
 * two drawings' names, numbered when a tab already has it.
 */
export function compareDrawingName(
  original: string,
  revision: string,
  taken: readonly string[],
): string {
  const base = `Compare_${stem(original)}_${stem(revision)}`;
  const have = new Set(taken.map((n) => n.toUpperCase()));
  if (!have.has(`${base}.dxf`.toUpperCase())) return `${base}.dxf`;
  for (let n = 2; ; n++) {
    const name = `${base} (${n}).dxf`;
    if (!have.has(name.toUpperCase())) return name;
  }
}

const CHANGE_LABELS: { readonly [K in CompareChange]: string } = {
  geometry: 'Geometry',
  text: 'Text',
  attributes: 'Attributes',
  block: 'Block definition',
  layer: 'Layer',
  color: 'Color',
  linetype: 'Linetype',
  lineweight: 'Lineweight',
  transparency: 'Transparency',
  ltScale: 'Linetype scale',
  visible: 'Visibility',
  plotStyle: 'Plot style',
};

/** What changed about a modified object, as the results list says it. */
export function changesText(item: MarkedItem): string {
  return item.changes.map((c) => CHANGE_LABELS[c]).join(', ');
}

export const STATUS_LABELS = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
} as const;

/** The layers the results list can be narrowed to: every marked object's, the case aside, sorted. */
export function layersOf(markup: CompareMarkup): string[] {
  const byKey = new Map<string, string>();
  for (const m of markup.marks)
    if (!byKey.has(m.layer.toUpperCase())) byKey.set(m.layer.toUpperCase(), m.layer);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** The object types the results list can be narrowed to, sorted. */
export function typesOf(markup: CompareMarkup): EntityType[] {
  return [...new Set(markup.marks.map((m) => m.type))].sort();
}
