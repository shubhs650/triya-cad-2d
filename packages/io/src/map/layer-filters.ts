// Layer filters (M5-07 part 4, DEC-076): AutoCAD 2005+ keeps the Layer Properties Manager's
// filter tree in the `ACLYDICTIONARY` dictionary of the LAYER table's extension dictionary, one
// XRECORD per filter (ObjectARX `AcLyLayerFilterManager`), whatever its entry name:
//
//   1 the class: `AcLyLayerFilter` (a property filter) or `AcLyLayerGroup` (a group filter),
//   90 1, 300 the filter's name, 301 a property filter's expression, 330 each layer of a group.
//
// A nested filter is filed in the `ACLYDICTIONARY` of its parent XRECORD's extension dictionary.
// A record of another class (a custom filter some application filed) is not mapped and stays as
// read, with what is nested in it; so does every unedited filter, as a save writes back only the
// filters that changed (export/layer-filters.ts). The R2000 `ACAD_LAYERFILTERS` dictionary beside
// it is not read: AutoCAD 2005+ converts it to ACLYDICTIONARY and keeps it for older releases.
import { CadDictionary, XRecord, type CadDocument } from '@node-projects/acad-ts';
import type { Handle, LayerFilter } from '@triya/engine';
import { common, hex } from './common';
import { drawingNames, type Group } from './layer-states';

/** The extension dictionary entry holding the filters (the LAYER table's, or a filter's). */
export const ACLYDICTIONARY = 'ACLYDICTIONARY';
/** DXF 1 of a property filter's XRECORD. */
export const PROPERTY_FILTER_CLASS = 'AcLyLayerFilter';
/** DXF 1 of a group filter's XRECORD. */
export const GROUP_FILTER_CLASS = 'AcLyLayerGroup';

/** The `ACLYDICTIONARY` of `o`'s extension dictionary, when it has one. */
export function filterDictionaryOf(
  o: { readonly xDictionary: CadDictionary | null } | null | undefined,
): CadDictionary | undefined {
  const d = o?.xDictionary?.get(ACLYDICTIONARY);
  return d instanceof CadDictionary ? d : undefined;
}

/** The drawing's top-level `ACLYDICTIONARY`, when it has one. */
export function layerFiltersDictionary(doc: CadDocument): CadDictionary | undefined {
  return filterDictionaryOf(doc.layers);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** A filter XRECORD's class, name, expression and group layers; undefined for another class. */
export function layerFilterFields(
  groups: readonly Group[],
  layer: (v: unknown) => { handle?: string } | undefined,
): Pick<LayerFilter, 'name' | 'filterType' | 'expression' | 'layers'> | undefined {
  const cls = groups.find((g) => g.code === 1);
  const filterType =
    text(cls?.value) === PROPERTY_FILTER_CLASS
      ? 'property'
      : text(cls?.value) === GROUP_FILTER_CLASS
        ? 'group'
        : undefined;
  if (!filterType) return undefined;
  const layers: Handle[] = [];
  let name = '';
  let expression = '';
  for (const { code, value } of groups) {
    if (code === 300) name = text(value);
    else if (code === 301 && filterType === 'property') expression = text(value);
    else if (code === 330 && filterType === 'group') {
      const h = layer(value)?.handle;
      if (h !== undefined && !layers.includes(h)) layers.push(h);
    }
  }
  return { name, filterType, expression, layers };
}

/** The drawing's layer filters, nested ones after their parents. */
export function mapLayerFilters(doc: CadDocument): LayerFilter[] {
  const names = drawingNames(doc);
  const out: LayerFilter[] = [];
  const walk = (dict: CadDictionary | undefined, parent: Handle | undefined) => {
    if (!dict) return;
    for (const x of dict) {
      if (!(x instanceof XRecord)) continue;
      const fields = layerFilterFields(x.entries as readonly Group[], names.layer);
      if (!fields) continue;
      const nested = filterDictionaryOf(x);
      out.push({
        ...common(x),
        type: 'LAYER_FILTER',
        owner: hex(dict.handle),
        ...fields,
        ...(parent !== undefined ? { parent } : {}),
        ...(nested ? { nested: hex(nested.handle) } : {}),
      });
      walk(nested, hex(x.handle));
    }
  };
  walk(layerFiltersDictionary(doc), undefined);
  return out;
}
