// General's rows after M2-35 part 6 and the 3D Visualization group (AutoCAD 2024 Help,
// "Properties Palette", General and 3D Visualization): Plot style, Hyperlink, Thickness and
// Material, as the sheet reads them and an edit writes them.
//
// - Plot style: a colour-dependent drawing ($PSTYLEMODE 1, AutoCAD's default when the header
//   says nothing) plots by colour and shows "ByColor", read only; a named-plot-style drawing
//   offers ByLayer and the names in ACAD_PLOTSTYLENAME. The model keeps a name only when the
//   entity states one (ByObjectId): ByBlock and the dictionary default read as none (io's
//   `entityProps`), so ByBlock is not offered.
// - Hyperlink: the entity's `PE_URL` xdata, the URL in its first 1000 string, then a `{ }` group
//   with the description and named location (what AutoCAD writes and ezdxf's `set_hyperlink`
//   writes). The palette edits the URL and keeps the rest; an empty value takes it off.
// - Thickness: DXF 39, on the objects whose DXF entity has one and io writes (LINE, CIRCLE, ARC,
//   POINT, LWPOLYLINE, a 2D POLYLINE, TEXT, ATTDEF, SOLID, TRACE). AutoCAD's help names no list;
//   the palette shows the row where the object carries the group.
// - Material: DXF 347, absent for ByLayer; the ByLayer, ByBlock and Global materials are records
//   of ACAD_MATERIAL like any other, so the ByLayer one by handle reads as ByLayer too.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { Entity, Xdata, XdataValue } from '../model/types';

/** The registered application AutoCAD files an object's hyperlink under. */
export const HYPERLINK_APP = 'PE_URL';

/** DXF 1000 strings hold at most 255 characters (the DXF reference, "Group codes in xdata"). */
export const MAX_XDATA_STRING = 255;

/** Whether the drawing uses named plot styles ($PSTYLEMODE 0). */
export function namedPlotStyles(model: DocumentModel): boolean {
  const mode = model.header.get('$PSTYLEMODE');
  return mode === 0 || mode === false;
}

/** The Plot style row's value: ByColor, ByLayer, or the named style's handle. */
export function plotStyleValue(model: DocumentModel, e: Entity): string {
  if (!namedPlotStyles(model)) return 'ByColor';
  return e.plotStyle ?? 'ByLayer';
}

/** The objects whose DXF entity has a thickness (group 39). */
export function hasThickness(e: Entity): boolean {
  const g = e.geom;
  switch (g.kind) {
    case 'LINE':
    case 'CIRCLE':
    case 'ARC':
    case 'POINT':
    case 'LWPOLYLINE':
    case 'TEXT':
    case 'ATTDEF':
    case 'SOLID':
    case 'TRACE':
      return true;
    case 'POLYLINE':
      return !g.is3d;
    default:
      return false;
  }
}

/** The thickness of an object that has one (`hasThickness`), 0 when it states none. */
export const thicknessOf = (e: Entity): number =>
  (e.geom as { readonly thickness?: number }).thickness ?? 0;

const isByLayerMaterial = (model: DocumentModel, h: Handle): boolean =>
  model.tables.materials.get(h)?.name.toUpperCase() === 'BYLAYER';

/** The Material row's value: ByLayer, or the material's handle. */
export function materialValue(model: DocumentModel, e: Entity): string {
  return e.material === undefined || isByLayerMaterial(model, e.material) ? 'ByLayer' : e.material;
}

/** The entity's material for a chosen Material value, or 'invalid'. */
export function materialOf(model: DocumentModel, v: string): Handle | undefined | 'invalid' {
  if (v === 'ByLayer') return undefined;
  if (!model.tables.materials.has(v)) return 'invalid';
  return isByLayerMaterial(model, v) ? undefined : v;
}

function hyperlinkAppId(model: DocumentModel): Handle | undefined {
  for (const r of model.tables.appIds.values()) {
    if (r.name.toUpperCase() === HYPERLINK_APP) return r.handle;
  }
  return undefined;
}

/** The URL of the object's hyperlink, '' when it has none. */
export function hyperlinkOf(model: DocumentModel, e: Entity): string {
  const app = hyperlinkAppId(model);
  if (app === undefined) return '';
  const values = e.xdata?.find((a) => a.appId === app)?.values;
  const first = values?.find((v) => v.code === 1000)?.value;
  return typeof first === 'string' ? first : '';
}

/**
 * Sets the hyperlink URL of `entities` (an empty one takes the hyperlink off), registering
 * `PE_URL` when the drawing has none. Returns how many changed, or 'invalid' for a URL xdata
 * cannot hold.
 */
export function setHyperlink(
  b: ChangeSetBuilder,
  model: DocumentModel,
  entities: readonly Entity[],
  value: string,
): number | 'invalid' {
  const url = value.trim();
  if (url.length > MAX_XDATA_STRING) return 'invalid';
  let app = hyperlinkAppId(model);
  let changed = 0;
  for (const e of entities) {
    if (hyperlinkOf(model, e) === url) continue;
    if (url !== '' && app === undefined) {
      app = b.addTableRecord('appIds', { name: HYPERLINK_APP, flags: 0 }).handle;
    }
    const xdata = withHyperlink(e.xdata, app!, url);
    b.updateEntity(e.id, { xdata });
    changed++;
  }
  return changed;
}

/** `xdata` with the hyperlink's URL set (its description and location kept), or taken off. */
function withHyperlink(xdata: Xdata | undefined, app: Handle, url: string): Xdata | undefined {
  const apps = xdata ?? [];
  const i = apps.findIndex((a) => a.appId === app);
  if (url === '') {
    const rest = apps.filter((_, j) => j !== i);
    return rest.length > 0 ? rest : undefined;
  }
  const old = i >= 0 ? apps[i]!.values : [];
  const at = old.findIndex((v) => v.code === 1000);
  const values: XdataValue[] =
    at >= 0
      ? old.map((v, j) => (j === at ? { code: 1000, value: url } : v))
      : [{ code: 1000, value: url }, ...old];
  const next = { appId: app, values };
  return i >= 0 ? apps.map((a, j) => (j === i ? next : a)) : [...apps, next];
}
