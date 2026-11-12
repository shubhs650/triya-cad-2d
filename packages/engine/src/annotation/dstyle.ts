// Writing a dimension's DIMVAR overrides (M2-30 part 2): the `DSTYLE` list in its ACAD xdata,
// as AutoCAD's Properties palette and DIMOVERRIDE write it: `1000 DSTYLE`, `1002 {`, then each
// override as its DXF group code (1070) and its value, `1002 }` (AutoCAD DXF reference,
// "Common Group Codes for Entities"/xdata; `dstyleOverrides` reads the same list). The value's
// xdata code follows the DIMSTYLE group code's range: 40–59 and 140–149 are reals (1040),
// 340–349 handles (1005), 3 and 4 strings (1000), the rest integers (1070).
//
// An override set to what the style itself says is dropped, and a list left empty goes with its
// application's entry when nothing else is in it: AutoCAD's help does not say whether a value
// equal to the style's stays an override; dropping it keeps "no override" what the drafter sees.
import type { AnnotationTables } from './multileader';
import { DIMVAR_BY_CODE } from './dimvars';
import { dimVars } from './leader';
import type { DimVarValue, Entity, Xdata, XdataApp, XdataValue } from '../model/types';
import type { Handle } from '../model/handle';

const CODE_BY_DIMVAR: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(DIMVAR_BY_CODE).map(([code, name]) => [name, Number(code)]),
);

/** The xdata group code a DIMVAR's value is written with. */
function valueCode(code: number): number {
  if ((code >= 40 && code <= 59) || (code >= 140 && code <= 149)) return 1040;
  if (code >= 340 && code <= 349) return 1005;
  if (code === 3 || code === 4) return 1000;
  return 1070;
}

const noHandle = (v: DimVarValue | undefined): boolean => v === undefined || v === '' || v === '0';

/** The ACAD application's APPID handle, undefined when the drawing has none. */
export function acadAppId(model: AnnotationTables): Handle | undefined {
  for (const r of model.tables.appIds.values()) {
    if (r.name.toUpperCase() === 'ACAD') return r.handle;
  }
  return undefined;
}

/** The pairs (code, value) of a `DSTYLE` list found at `at` in `v`, and where it ends. */
function readList(v: readonly XdataValue[], at: number) {
  const pairs: [number, XdataValue][] = [];
  let i = at + 2;
  for (; i + 1 < v.length && v[i]!.code === 1070; i += 2)
    pairs.push([Number(v[i]!.value), v[i + 1]!]);
  // The closing `1002 }`.
  const end = i < v.length && v[i]!.code === 1002 ? i + 1 : i;
  return { pairs, end };
}

/**
 * `e`'s xdata with DIMVAR `name` overridden to `value` on top of its style `style` (or the
 * override removed when `value` is what the style says, `fallback` when the style does not
 * state it). Undefined xdata means none is left; `'no-acad'` when the drawing has no ACAD
 * application to file it under.
 */
export function withDimvarOverride(
  e: Pick<Entity, 'xdata'>,
  style: Handle,
  model: AnnotationTables,
  name: string,
  value: DimVarValue,
  fallback?: DimVarValue,
): Xdata | undefined | 'no-acad' {
  const code = CODE_BY_DIMVAR[name];
  if (code === undefined) throw new Error(`${name} is not a DIMVAR`);
  const acad = acadAppId(model);
  if (acad === undefined) return 'no-acad';
  const styled = dimVars(style, undefined, model)[name] ?? fallback;
  const same =
    styled === value ||
    (typeof styled === 'boolean' && Number(styled) === value) ||
    // DIMDSEP: a DIMSTYLE keeps the character, an override its code.
    (typeof styled === 'string' && typeof value === 'number' && styled.charCodeAt(0) === value) ||
    // A handle DIMVAR naming nothing: absent, empty or 0 alike.
    (valueCode(code) === 1005 && noHandle(styled) && noHandle(value));
  const pair: [number, XdataValue] = [
    code,
    { code: valueCode(code), value: typeof value === 'boolean' ? Number(value) : value },
  ];
  const apps: XdataApp[] = [...(e.xdata ?? [])];
  let index = apps.findIndex((a) => a.appId === acad);
  if (index < 0) {
    if (same) return e.xdata;
    apps.push({ appId: acad, values: [] });
    index = apps.length - 1;
  }
  const v = apps[index]!.values;
  const at = v.findIndex((x) => x.code === 1000 && x.value === 'DSTYLE');
  const list = at < 0 ? { pairs: [], end: v.length } : readList(v, at);
  const pairs = list.pairs.filter(([c]) => c !== code);
  const kept = list.pairs.findIndex(([c]) => c === code);
  if (!same) {
    if (kept < 0) pairs.push(pair);
    else pairs.splice(kept, 0, pair);
  }
  const written: XdataValue[] =
    pairs.length === 0
      ? []
      : [
          { code: 1000, value: 'DSTYLE' },
          { code: 1002, value: '{' },
          ...pairs.flatMap(([c, x]) => [{ code: 1070, value: c }, x]),
          { code: 1002, value: '}' },
        ];
  const values =
    at < 0 ? [...v, ...written] : [...v.slice(0, at), ...written, ...v.slice(list.end)];
  if (values.length === 0) apps.splice(index, 1);
  else apps[index] = { appId: acad, values };
  return apps.length === 0 ? undefined : apps;
}
