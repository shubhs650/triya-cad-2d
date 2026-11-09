// A dimension's DIMVARs resolved to the values the generator draws with: its DIMSTYLE (DXF 3)
// with the entity's ACAD `DSTYLE` xdata overrides on top, lengths multiplied by DIMSCALE.
// A DIMVAR the record does not hold takes AutoCAD's imperial default (the STANDARD style of
// acad.dwg); the DIMSTYLE reference lists them:
// https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-F2FAD36F-0CE3-4943-9DAD-A9BCD2AE81DA

import {
  dimColor,
  dimLineweight,
  dimTrueColors,
  dimVars,
  linetypeRef,
  type AnnotationTables,
  type Color,
  type DimVarValue,
  type Entity,
  type Handle,
  type LinetypeRef,
  type Lineweight,
} from '@triya/engine';

/** Properties one group of a dimension's parts draws in (absent: the dimension's own). */
export interface PartProps {
  readonly color?: Color;
  readonly linetype?: LinetypeRef;
  readonly lineweight?: Lineweight;
}

export interface DimStyle {
  readonly vars: Readonly<Record<string, DimVarValue>>;
  /** DIMSCALE, 0 (fit to the layout viewport) taken as 1 outside a viewport. */
  readonly scale: number;
  /** Lengths, already multiplied by DIMSCALE. */
  readonly asz: number;
  readonly exo: number;
  readonly exe: number;
  readonly dle: number;
  readonly gap: number;
  readonly cen: number;
  readonly tsz: number;
  readonly fxl: number;
  /** The text height: DIMTXT × DIMSCALE, or the text style's fixed height. */
  readonly textHeight: number;
  readonly textStyle: Handle | undefined;
  /** DIMTAD, DIMJUST, DIMTVP, DIMATFIT, DIMTMOVE. */
  readonly tad: number;
  readonly just: number;
  readonly tvp: number;
  readonly atfit: number;
  readonly tmove: number;
  readonly tih: boolean;
  readonly toh: boolean;
  readonly tix: boolean;
  readonly tofl: boolean;
  readonly soxd: boolean;
  readonly se1: boolean;
  readonly se2: boolean;
  readonly sd1: boolean;
  readonly sd2: boolean;
  readonly fxlon: boolean;
  /** The arrowhead block of each end; undefined is closed filled. */
  readonly blk1: Handle | undefined;
  readonly blk2: Handle | undefined;
  readonly dimLine: PartProps;
  readonly ext1: PartProps;
  readonly ext2: PartProps;
  readonly text: PartProps;
  /** DIMTFILL 1 (drawing background) or 2 (DIMTFILLCLR). */
  readonly fill: { readonly mode: number; readonly color?: Color };
}

/** AutoCAD's imperial defaults for the DIMVARs the generator reads. */
const DEFAULTS: Readonly<Record<string, DimVarValue>> = {
  DIMSCALE: 1,
  DIMASZ: 0.18,
  DIMEXO: 0.0625,
  DIMEXE: 0.18,
  DIMDLE: 0,
  DIMGAP: 0.09,
  DIMCEN: 0.09,
  DIMTSZ: 0,
  DIMFXL: 1,
  DIMTXT: 0.18,
  DIMTAD: 0,
  DIMJUST: 0,
  DIMTVP: 0,
  DIMATFIT: 3,
  DIMTMOVE: 0,
  DIMTIH: 1,
  DIMTOH: 1,
  DIMTIX: 0,
  DIMTOFL: 0,
  DIMSOXD: 0,
  DIMSE1: 0,
  DIMSE2: 0,
  DIMSD1: 0,
  DIMSD2: 0,
  DIMSAH: 0,
  DIMFXLON: 0,
  DIMLFAC: 1,
  DIMRND: 0,
  DIMLUNIT: 2,
  DIMDEC: 4,
  DIMZIN: 0,
  DIMDSEP: '.',
  DIMFRAC: 0,
  DIMTFAC: 1,
  DIMPOST: '',
  DIMAUNIT: 0,
  DIMADEC: 0,
  DIMAZIN: 0,
  DIMTFILL: 0,
};

export const num = (v: DimVarValue | undefined, fallback = 0): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : fallback;
/** A DIMVAR switch: records keep booleans, `DSTYLE` overrides 0 and 1. */
export const on = (v: DimVarValue | undefined): boolean => num(v) !== 0;
export const str = (v: DimVarValue | undefined): string => (typeof v === 'string' ? v : '');
const ref = (v: DimVarValue | undefined): Handle | undefined =>
  typeof v === 'string' && v !== '' && v !== '0' ? v : undefined;

function props(
  color: Color | undefined,
  linetype: LinetypeRef | undefined,
  lineweight: Lineweight | undefined,
): PartProps {
  return {
    ...(color ? { color } : {}),
    ...(linetype !== undefined ? { linetype } : {}),
    ...(lineweight !== undefined ? { lineweight } : {}),
  };
}

/**
 * DIMVARs a DIMSTYLE keeps in its xdata in files older than they are: AutoCAD writes the
 * R2007 linetype variables to R2004 and older files as `ACAD_DSTYLE_DIM*_LINETYPE` xdata, a
 * 1070 code (380 DIMLTYPE, 381 DIMLTEX1, 382 DIMLTEX2) then the linetype's 1005 handle.
 */
const LEGACY: Readonly<Record<number, string>> = { 380: 'DIMLTYPE', 381: 'DIMLTEX1', 382: 'DIMLTEX2' };

function legacyVars(style: Handle, model: AnnotationTables): Record<string, DimVarValue> {
  const out: Record<string, DimVarValue> = {};
  for (const app of model.tables.dimStyles.get(style)?.xdata ?? []) {
    if (!model.tables.appIds.get(app.appId)?.name.toUpperCase().startsWith('ACAD_DSTYLE')) continue;
    const [code, value] = app.values;
    const name = code?.code === 1070 ? LEGACY[Number(code.value)] : undefined;
    if (name && value?.code === 1005 && typeof value.value === 'string') out[name] = value.value;
  }
  return out;
}

/** The dimension's resolved style. */
export function dimStyle(
  style: Handle,
  xdata: Entity['xdata'],
  model: AnnotationTables,
): DimStyle {
  const vars = { ...DEFAULTS, ...legacyVars(style, model), ...dimVars(style, xdata, model) };
  const trueColors = dimTrueColors(style, xdata, model);
  const scale = num(vars.DIMSCALE, 1) || 1;
  const len = (name: string): number => num(vars[name]) * scale;
  const textStyle = ref(vars.DIMTXSTY);
  const fixed = textStyle === undefined ? 0 : (model.tables.textStyles.get(textStyle)?.height ?? 0);
  const sah = on(vars.DIMSAH);
  const blk = ref(vars.DIMBLK);
  const lt = (name: string): LinetypeRef | undefined => linetypeRef(model, ref(vars[name]));
  const colorOf = (name: string): Color | undefined => trueColors[name] ?? dimColor(vars[name]);
  const dimLw = dimLineweight(vars.DIMLWD);
  const extLw = dimLineweight(vars.DIMLWE);
  const extColor = colorOf('DIMCLRE');
  const fillMode = num(vars.DIMTFILL);
  const fillColor = colorOf('DIMTFILLCLR');
  return {
    vars,
    scale,
    asz: len('DIMASZ'),
    exo: len('DIMEXO'),
    exe: len('DIMEXE'),
    dle: len('DIMDLE'),
    // A negative DIMGAP frames the text (basic dimensions); its size is the gap.
    gap: Math.abs(len('DIMGAP')),
    cen: len('DIMCEN'),
    tsz: len('DIMTSZ'),
    fxl: len('DIMFXL'),
    // DIMTXT "has no effect if the current text style has a fixed height".
    textHeight: fixed > 0 ? fixed : len('DIMTXT'),
    textStyle,
    tad: num(vars.DIMTAD),
    just: num(vars.DIMJUST),
    tvp: num(vars.DIMTVP),
    atfit: num(vars.DIMATFIT, 3),
    tmove: num(vars.DIMTMOVE),
    tih: on(vars.DIMTIH),
    toh: on(vars.DIMTOH),
    tix: on(vars.DIMTIX),
    tofl: on(vars.DIMTOFL),
    soxd: on(vars.DIMSOXD),
    se1: on(vars.DIMSE1),
    se2: on(vars.DIMSE2),
    sd1: on(vars.DIMSD1),
    sd2: on(vars.DIMSD2),
    fxlon: on(vars.DIMFXLON),
    blk1: sah ? ref(vars.DIMBLK1) : blk,
    blk2: sah ? ref(vars.DIMBLK2) : blk,
    dimLine: props(colorOf('DIMCLRD'), lt('DIMLTYPE'), dimLw),
    ext1: props(extColor, lt('DIMLTEX1'), extLw),
    ext2: props(extColor, lt('DIMLTEX2'), extLw),
    text: props(colorOf('DIMCLRT'), undefined, undefined),
    fill: fillMode === 2 && fillColor ? { mode: 2, color: fillColor } : { mode: fillMode },
  };
}
