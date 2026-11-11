// The Properties palette's state (M2-21): the sheet each drawing's engine last sent while the
// palette was open, and how a row's value is shown. The engine works out the sheet (which
// objects, which rows, *VARIES*); the app formats numbers in the drawing's units, as AutoCAD's
// palette shows them: distances by LUNITS/LUPREC (dims' `formatLinear`, feet and inches kept
// whole as the status bar's coordinates), angles by AUNITS/AUPREC without a degree sign for
// decimal degrees, areas and plain numbers with LUPREC decimal places.
import { formatAngle, formatLinear } from '@triya/dims';
import type { PropertyRow, PropertySheet, PropertyUnits } from '@triya/engine';

export const VARIES = '*VARIES*';

const MAX_PLACES = 8;
const places = (n: number) => Math.min(Math.max(Math.round(n), 0), MAX_PLACES);

export function formatDistance(v: number, u: PropertyUnits): string {
  const units = u.lunits >= 1 && u.lunits <= 5 ? u.lunits : 2;
  if (units === 2) return v.toFixed(places(u.luprec));
  return formatLinear(v, { DIMLUNIT: units, DIMDEC: places(u.luprec), DIMZIN: 1, DIMFRAC: 2 });
}

export function formatAngleValue(v: number, u: PropertyUnits): string {
  const text = formatAngle(v, { DIMAUNIT: u.aunits, DIMADEC: places(u.auprec) });
  // Decimal degrees show bare; degrees/minutes/seconds as AutoCAD types them (45d30'0").
  return u.aunits === 1 ? text.replace('%%d', 'd') : text.replace('%%d', '');
}

/** A row's value as the palette shows it. */
export function valueText(row: PropertyRow, u: PropertyUnits): string {
  if (row.varies || row.value === undefined) return VARIES;
  const v = row.value;
  if (row.options) {
    const option = row.options.find((o) => o.value === String(v));
    if (option) return option.label;
  }
  if (typeof v !== 'number') return String(v);
  switch (row.kind) {
    case 'distance':
      return formatDistance(v, u);
    case 'angle':
      return formatAngleValue(v, u);
    case 'area':
    case 'number':
      return v.toFixed(places(u.luprec));
    default:
      return String(v);
  }
}

/**
 * What a typed field starts with: the shown value, except that a distance in units the engine's
 * number parser does not read (feet and inches, fractions, scientific) starts as a plain
 * decimal; a value that varies starts empty.
 */
export function editText(row: PropertyRow, u: PropertyUnits): string {
  if (row.varies || row.value === undefined) return '';
  if (row.kind === 'distance' && typeof row.value === 'number' && u.lunits !== 2) {
    return String(Number(row.value.toPrecision(12)));
  }
  if (row.kind === 'angle' && typeof row.value === 'number' && u.aunits === 4) {
    return String(Number(((row.value * 180) / Math.PI).toPrecision(12)));
  }
  return valueText(row, u);
}

/** "All (3)" or "Line (2)": the palette's object list. */
export function typeOptions(sheet: PropertySheet): { value: string; label: string }[] {
  // Nothing selected: AutoCAD's "No selection", over the drawing's current settings (M2-35).
  if (sheet.current) return [{ value: '', label: 'No selection' }];
  const all = { value: '', label: `All (${sheet.count})` };
  if (sheet.types.length <= 1) {
    const only = sheet.types[0];
    return only ? [{ value: '', label: `${only.label} (${only.count})` }] : [];
  }
  return [all, ...sheet.types.map((t) => ({ value: t.type, label: `${t.label} (${t.count})` }))];
}

/** The sheets the drawings' engines sent, per drawing, for the palette to show. */
export class PropertySheets {
  readonly #sheets = new Map<number, PropertySheet>();
  readonly #listeners = new Set<() => void>();

  set(doc: number, sheet: PropertySheet): void {
    this.#sheets.set(doc, sheet);
    for (const l of this.#listeners) l();
  }

  get(doc: number | undefined): PropertySheet | undefined {
    return doc === undefined ? undefined : this.#sheets.get(doc);
  }

  forget(doc: number): void {
    if (this.#sheets.delete(doc)) for (const l of this.#listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const propertySheets = new PropertySheets();

/** Which palette docks (one at a time until the palette stack, M7-03); PROPERTIES opens one. */
export type PaletteName = 'layers' | 'health' | 'references' | 'properties';

class DockedPalette {
  #current: PaletteName | undefined;
  readonly #listeners = new Set<() => void>();

  get = (): PaletteName | undefined => this.#current;

  set(p: PaletteName | undefined): void {
    if (p === this.#current) return;
    this.#current = p;
    for (const l of this.#listeners) l();
  }

  toggle(p: PaletteName): void {
    this.set(this.#current === p ? undefined : p);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

export const dockedPalette = new DockedPalette();
