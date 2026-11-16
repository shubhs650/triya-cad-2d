// The Dimension Style dialog's settings a DIMSTYLE record has no group code for (M4-03 part 2),
// which AutoCAD files as xdata on the record, one application per setting, a `1070` code naming
// the setting and then its value:
//
// - Dimension Break's Break size (Symbols and Arrows tab): `ACAD_DSTYLE_DIMBREAK`, 1070 391,
//   1040 size (acadsharp's sample_AC1032 `custom_dim_style`: 0.125, AutoCAD's default).
// - Linear Jog's Jog height factor (Symbols and Arrows tab): `ACAD_DSTYLE_DIMJAG`, 1070 388,
//   1040 factor (every R2007+ acadsharp style: 1.5; read by `jogHeightFactor`, M4-01).
// - Tolerance Alignment (Tolerances tab): `ACAD_DSTYLE_DIMTALN`, 1070 392, 1070 0 (align
//   decimal separators, every acadsharp style) or 1 (align operational symbols).
// - Sub-units factor and suffix (Primary and Alternate Units tabs; the DIMMZF, DIMMZS, DIMALTMZF
//   and DIMALTMZS variables, which DWG files in the R2010+ DIMSTYLE record and the DXF reference
//   gives no group for). No corpus file states one; Triya files them the same way as
//   `ACAD_DSTYLE_DIMMZF` 1070 393 1040, `ACAD_DSTYLE_DIMMZS` 1070 394 1000,
//   `ACAD_DSTYLE_DIMALTMZF` 1070 395 1040 and `ACAD_DSTYLE_DIMALTMZS` 1070 396 1000. This is
//   Triya's reading, unverified against an AutoCAD save (DEC-047: compatibility welcome, not
//   required).
//
// The dialog and DIMSTYLE treat them as DIMVARs of the style under these names; the record keeps
// them in `xdata`, and its `vars` never hold them.
import type { ChangeSetBuilder } from '../model/builder';
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { DimVarValue, Xdata, XdataApp, XdataValue } from '../model/types';

export interface DimStyleXdataVar {
  /** The name the dialog knows it by (an AutoCAD system variable where there is one). */
  readonly name: string;
  readonly app: string;
  /** The 1070 code before the value. */
  readonly code: number;
  /** The value's group: 1040 a real, 1070 an integer, 1000 a string. */
  readonly group: 1040 | 1070 | 1000;
  /** AutoCAD's default, for a style without the entry. */
  readonly fallback: DimVarValue;
}

export const DIMSTYLE_XDATA_VARS: readonly DimStyleXdataVar[] = [
  { name: 'DIMBREAK', app: 'ACAD_DSTYLE_DIMBREAK', code: 391, group: 1040, fallback: 0.125 },
  { name: 'DIMJAG', app: 'ACAD_DSTYLE_DIMJAG', code: 388, group: 1040, fallback: 1.5 },
  { name: 'DIMTALN', app: 'ACAD_DSTYLE_DIMTALN', code: 392, group: 1070, fallback: 0 },
  { name: 'DIMMZF', app: 'ACAD_DSTYLE_DIMMZF', code: 393, group: 1040, fallback: 100 },
  { name: 'DIMMZS', app: 'ACAD_DSTYLE_DIMMZS', code: 394, group: 1000, fallback: '' },
  { name: 'DIMALTMZF', app: 'ACAD_DSTYLE_DIMALTMZF', code: 395, group: 1040, fallback: 100 },
  { name: 'DIMALTMZS', app: 'ACAD_DSTYLE_DIMALTMZS', code: 396, group: 1000, fallback: '' },
];

const BY_NAME = new Map(DIMSTYLE_XDATA_VARS.map((v) => [v.name, v]));

/** Whether `name` is one of the settings a style keeps in its xdata. */
export const isDimStyleXdataVar = (name: string): boolean => BY_NAME.has(name);

/** AutoCAD's defaults for the xdata settings. */
export const DIMSTYLE_XDATA_DEFAULTS: Readonly<Record<string, DimVarValue>> = Object.fromEntries(
  DIMSTYLE_XDATA_VARS.map((v) => [v.name, v.fallback]),
);

type Apps = Pick<DocumentModel, 'tables'>;

const appName = (model: Apps, a: XdataApp): string =>
  model.tables.appIds.get(a.appId)?.name.toUpperCase() ?? '';

/** The value after `1070 <code>` in `values`, when it is of `group`. */
function valueAfter(values: readonly XdataValue[], v: DimStyleXdataVar): DimVarValue | undefined {
  for (let i = 0; i + 1 < values.length; i++) {
    if (values[i]!.code !== 1070 || Number(values[i]!.value) !== v.code) continue;
    const x = values[i + 1]!;
    if (x.code !== v.group) return undefined;
    if (v.group === 1000) return typeof x.value === 'string' ? x.value : undefined;
    const n = Number(x.value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** The xdata settings `xdata` states (a style's, or a dimension's own). */
export function dimStyleXdataVars(
  model: Apps,
  xdata: Xdata | undefined,
): Record<string, DimVarValue> {
  const out: Record<string, DimVarValue> = {};
  for (const a of xdata ?? []) {
    const name = appName(model, a);
    for (const v of DIMSTYLE_XDATA_VARS) {
      if (v.app !== name) continue;
      const value = valueAfter(a.values, v);
      if (value !== undefined) out[v.name] = value;
    }
  }
  return out;
}

/** The drawing's APPID named `name`, registered by `b` when it has none. */
function appIdFor(b: ChangeSetBuilder, model: Apps, name: string): Handle {
  for (const r of model.tables.appIds.values()) if (r.name.toUpperCase() === name) return r.handle;
  return b.addTableRecord('appIds', { name, flags: 0 }).handle;
}

/**
 * `record`'s xdata with the settings of `changes` written (the APPIDs the drawing lacks
 * registered by `b`): an entry the style has keeps its other values and place, a new one is added
 * last as AutoCAD lays it out. Undefined when nothing is left.
 */
export function withDimStyleXdata(
  b: ChangeSetBuilder,
  model: Apps,
  record: { readonly xdata?: Xdata | undefined } | undefined,
  changes: ReadonlyMap<string, DimVarValue>,
): Xdata | undefined {
  const apps: XdataApp[] = [...(record?.xdata ?? [])];
  for (const [name, value] of changes) {
    const v = BY_NAME.get(name);
    if (!v) continue;
    const pair: XdataValue[] = [
      { code: 1070, value: v.code },
      { code: v.group, value: v.group === 1000 ? String(value) : Number(value) },
    ];
    const at = apps.findIndex((a) => appName(model, a) === v.app);
    if (at < 0) {
      apps.push({ appId: appIdFor(b, model, v.app), values: pair });
      continue;
    }
    const values = [...apps[at]!.values];
    const i = values.findIndex(
      (x, k) => x.code === 1070 && Number(x.value) === v.code && k + 1 < values.length,
    );
    if (i < 0) values.push(...pair);
    else values.splice(i, 2, ...pair);
    apps[at] = { ...apps[at]!, values };
  }
  return apps.length > 0 ? apps : undefined;
}
