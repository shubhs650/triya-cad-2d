// The Underlay Layers dialog (M2-56 part 1), ULAYERS': what it lists and the answer OK gives.
// AutoCAD 2024 Help, "Underlay Layers Dialog Box": Reference Name lists the underlays attached,
// Search for layer filters the list, and each layer's Status turns it on or off for the selected
// underlay only. The layers are the PDF's own (its optional content groups), read with pdf.js;
// a layer the underlay turns off that the PDF does not have (the file was changed) is listed
// too, so it can be turned back on, and with no PDF supplied those are all the dialog can list.
import type { EntityId, UnderlayLayersInfo, ViewReply } from '@triya/engine';
import type { PdfLayer } from './underlay/pages';

/** One row of the layer list. */
export interface UnderlayLayerRow {
  readonly name: string;
  readonly on: boolean;
  /**
   * The PDF itself hides the layer by default: ULAYERS keeps only the layers an underlay turns
   * off, so it shows off and cannot be turned on.
   */
  readonly pdfOff?: true;
}

/**
 * The layer list of an underlay: the PDF's layers in its order (undefined: the file was not
 * supplied), then any layer turned off it does not have; `off` is what the dialog has now.
 */
export function layerRows(
  pdfLayers: readonly PdfLayer[] | undefined,
  off: readonly string[],
): UnderlayLayerRow[] {
  const offSet = new Set(off);
  const rows: UnderlayLayerRow[] = (pdfLayers ?? []).map(({ name, on }) =>
    on ? { name, on: !offSet.has(name) } : { name, on: false, pdfOff: true },
  );
  for (const name of off) if (!rows.some((r) => r.name === name)) rows.push({ name, on: false });
  return rows;
}

/** Search for layer: a part of the name, case ignored, or `*` and `?` wildcards. */
export function layerMatches(name: string, search: string): boolean {
  const s = search.trim();
  if (s === '') return true;
  if (!/[*?]/.test(s)) return name.toLowerCase().includes(s.toLowerCase());
  const re = s
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${re}$`, 'i').test(name);
}

/** `off` with `name` turned on or off, the others kept in their order. */
export function toggled(off: readonly string[], name: string, on: boolean): string[] {
  const rest = off.filter((n) => n !== name);
  return on ? rest : [...rest, name];
}

/**
 * OK's answer: the layers off of each underlay the dialog changed (by its id), in list order;
 * none changed answers like Cancel.
 */
export function okReply(
  underlays: readonly UnderlayLayersInfo[],
  edited: ReadonlyMap<EntityId, readonly string[]>,
): ViewReply {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((n) => b.includes(n));
  const underlayLayers = underlays
    .filter((u) => edited.has(u.id) && !same(edited.get(u.id)!, u.layersOff))
    .map((u) => ({ id: u.id, layersOff: [...edited.get(u.id)!] }));
  return underlayLayers.length > 0 ? { ok: true, underlayLayers } : { ok: true };
}

/** What ULAYERS asked: the drawing's underlays, and the one to open on. */
export interface UnderlayLayersRequest {
  readonly underlays: readonly UnderlayLayersInfo[];
  readonly current?: EntityId;
}

/** The open dialog: which drawing it is open for, what ULAYERS asked, and ULAYERS waiting. */
export const underlayLayersDialog = (() => {
  let open: { readonly doc: number; readonly request: UnderlayLayersRequest } | undefined;
  let done: ((reply: ViewReply) => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (v: typeof open) => {
    open = v;
    for (const l of listeners) l();
  };
  const finish = (reply: ViewReply) => {
    const d = done;
    done = undefined;
    set(undefined);
    d?.(reply);
  };
  return {
    get: () => open,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Opens the dialog; resolves with OK's answer, or `{ ok: true }` for Cancel. */
    show(doc: number, request: UnderlayLayersRequest): Promise<ViewReply> {
      finish({ ok: true });
      set({ doc, request });
      return new Promise((resolve) => (done = resolve));
    },
    close(reply: ViewReply = { ok: true }) {
      finish(reply);
    },
  };
})();
