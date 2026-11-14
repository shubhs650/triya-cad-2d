// ULAYERS (M2-56 part 1): which of a PDF's layers each underlay turns off. AutoCAD 2024 Help,
// "ULAYERS (Command)" and "Underlay Layers Dialog Box": the layers of a DWF, DWFx, PDF or DGN
// underlay are turned on and off per underlay reference, and the drawing keeps them. AutoCAD
// files them as the underlay's `AdeskUnderlayLayerOverrideData` xdata, which io reads as one
// 1000 string per layer off (map/entities.ts `underlayLayersOff`, M2-38 part 2); a change writes
// that xdata back (the xdata writer) and the geometry's `layersOff` the renderer draws with,
// together, so what is drawn and what is saved cannot part.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { EntityId } from '../model/entity-ids';
import type { Handle } from '../model/handle';
import type { Entity, PdfDefinition, UnderlayGeometry, Xdata } from '../model/types';
import { MAX_XDATA_STRING } from '../properties/general';

/** The registered application AutoCAD keeps an underlay's layers turned off under. */
export const UNDERLAY_LAYERS_APP = 'AdeskUnderlayLayerOverrideData';

/** One underlay reference as the Underlay Layers dialog lists it. */
export interface UnderlayLayersInfo {
  readonly id: EntityId;
  /**
   * The dialog's Reference Name: its definition's name (the External References palette's), with
   * ` [n]` after it when the drawing attaches that definition more than once, in drawing order.
   */
  readonly name: string;
  /** The definition's file (DXF 1) and page (DXF 2), for the app to read the PDF's layers. */
  readonly fileName: string;
  readonly page: string;
  readonly layersOff: readonly string[];
}

const isUnderlay = (e: Entity): e is Entity & { readonly geom: UnderlayGeometry } =>
  e.geom.kind === 'PDFUNDERLAY';

/**
 * The underlay references of the drawing's model space and layouts, in drawing order (one inside
 * a block definition is the block's, as AutoCAD's dialog lists the references attached).
 */
export function underlayReferences(model: DocumentModel): UnderlayLayersInfo[] {
  // A drawing without LAYOUT objects (R12, or one written without them) still has its spaces.
  const spaces = new Set(model.layouts.map((l) => l.blockRecord));
  for (const [h, d] of model.blocks) if (/^\*(MODEL|PAPER)_SPACE/i.test(d.name)) spaces.add(h);
  const found: { e: Entity & { readonly geom: UnderlayGeometry }; def: PdfDefinition }[] = [];
  for (const space of spaces) {
    for (const id of model.blockEntities(space)) {
      const e = model.entity(id);
      if (!e || !isUnderlay(e) || e.geom.definition === undefined) continue;
      const def = model.objects.get(e.geom.definition);
      if (def?.type === 'PDFDEFINITION') found.push({ e, def: def as PdfDefinition });
    }
  }
  const total = new Map<Handle, number>();
  for (const { def } of found) total.set(def.handle, (total.get(def.handle) ?? 0) + 1);
  const seen = new Map<Handle, number>();
  return found.map(({ e, def }) => {
    const n = (seen.get(def.handle) ?? 0) + 1;
    seen.set(def.handle, n);
    return {
      id: e.id,
      name: total.get(def.handle)! > 1 ? `${def.name} [${n}]` : def.name,
      fileName: def.fileName,
      page: def.page,
      layersOff: e.geom.layersOff ?? [],
    };
  });
}

/** Why a list of layer names cannot be kept, or undefined. */
export function underlayLayersProblem(names: readonly string[]): string | undefined {
  for (const n of names) {
    if (n === '') return 'A layer has no name.';
    // A DXF group is one line of at most 255 characters (the xdata writer's limits).
    if (n.length > MAX_XDATA_STRING || /[\r\n]/.test(n)) return `Cannot keep layer "${n}".`;
  }
  return undefined;
}

function layersAppId(model: DocumentModel): Handle | undefined {
  const upper = UNDERLAY_LAYERS_APP.toUpperCase();
  for (const r of model.tables.appIds.values()) if (r.name.toUpperCase() === upper) return r.handle;
  return undefined;
}

/**
 * Turns off exactly `names` (once each, in the order given) of the underlay `id`'s PDF layers,
 * the rest on, registering the application when the drawing has none. Returns whether anything
 * changed; refuses (false) anything but a PDF underlay.
 */
export function setUnderlayLayersOff(
  b: ChangeSetBuilder,
  model: DocumentModel,
  id: EntityId,
  names: readonly string[],
): boolean {
  const e = model.entity(id);
  if (!e || !isUnderlay(e)) return false;
  const off = [...new Set(names)];
  if (underlayLayersProblem(off)) return false;
  const was = e.geom.layersOff ?? [];
  if (was.length === off.length && was.every((n, i) => n === off[i])) return false;
  let app = layersAppId(model);
  if (app === undefined && off.length > 0) {
    app = b.addTableRecord('appIds', { name: UNDERLAY_LAYERS_APP, flags: 0 }).handle;
  }
  const apps: Xdata = (e.xdata ?? []).filter((a) => a.appId !== app);
  const at = (e.xdata ?? []).findIndex((a) => a.appId === app);
  const mine =
    off.length > 0 ? [{ appId: app!, values: off.map((value) => ({ code: 1000, value })) }] : [];
  // The application keeps its place among the others when it had one.
  const xdata = at >= 0 ? [...apps.slice(0, at), ...mine, ...apps.slice(at)] : [...apps, ...mine];
  const { layersOff: _, ...rest } = e.geom;
  b.updateEntity(id, {
    geom: off.length > 0 ? { ...rest, layersOff: off } : rest,
    xdata: xdata.length > 0 ? xdata : undefined,
  });
  return true;
}
