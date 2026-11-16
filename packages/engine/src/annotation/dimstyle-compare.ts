// What a dimension style's DIMVARs are called and how they read (M4-03 part 2), for the Compare
// Dimension Styles dialog (AutoCAD 2024 Help, "Compare Dimension Styles Dialog Box": Description,
// Variable and the two styles' values, every setting of one style when the other is <none>) and
// -DIMSTYLE's STatus and Variables listings ("-DIMSTYLE (Command)"), which name each variable,
// its value and the same description.
import type { DimVarValue } from '../model/types';
import { DIMVAR_BY_CODE } from './dimvars';
import { DIMSTYLE_DEFAULTS, DIMSTYLE_REFERENCES } from './dimstyle-fields';
import { DIMSTYLE_XDATA_DEFAULTS, DIMSTYLE_XDATA_VARS } from './dimstyle-xdata';

/** AutoCAD's descriptions, as -DIMSTYLE STatus lists them. */
export const DIMVAR_DESCRIPTIONS: Readonly<Record<string, string>> = {
  DIMADEC: 'Angular decimal places',
  DIMALT: 'Alternate units selected',
  DIMALTD: 'Alternate unit decimal places',
  DIMALTF: 'Alternate unit scale factor',
  DIMALTMZF: 'Alternate sub-units factor',
  DIMALTMZS: 'Alternate sub-unit suffix',
  DIMALTRND: 'Alternate units rounding',
  DIMALTTD: 'Alternate tolerance decimal places',
  DIMALTTZ: 'Alternate tolerance zero suppression',
  DIMALTU: 'Alternate units',
  DIMALTZ: 'Alternate unit zero suppression',
  DIMAPOST: 'Prefix and suffix for alternate text',
  DIMARCSYM: 'Arc length symbol',
  DIMASZ: 'Arrow size',
  DIMATFIT: 'Arrow and text fit',
  DIMAUNIT: 'Angular unit format',
  DIMAZIN: 'Angular zero suppression',
  DIMBLK: 'Arrow block name',
  DIMBLK1: 'First arrow block name',
  DIMBLK2: 'Second arrow block name',
  DIMBREAK: 'Dimension break size',
  DIMCEN: 'Center mark size',
  DIMCLRD: 'Dimension line and leader color',
  DIMCLRE: 'Extension line color',
  DIMCLRT: 'Dimension text color',
  DIMDEC: 'Decimal places',
  DIMDLE: 'Dimension line extension',
  DIMDLI: 'Dimension line spacing',
  DIMDSEP: 'Decimal separator',
  DIMEXE: 'Extension above dimension line',
  DIMEXO: 'Extension line origin offset',
  DIMFRAC: 'Fraction format',
  DIMFXL: 'Fixed extension line length',
  DIMFXLON: 'Enable fixed extension line',
  DIMGAP: 'Gap from dimension line to text',
  DIMJAG: 'Linear jog height factor',
  DIMJOGANG: 'Radius dimension jog angle',
  DIMJUST: 'Justification of text on dimension line',
  DIMLDRBLK: 'Leader block name',
  DIMLFAC: 'Linear unit scale factor',
  DIMLIM: 'Generate dimension limits',
  DIMLTEX1: 'Linetype extension line 1',
  DIMLTEX2: 'Linetype extension line 2',
  DIMLTYPE: 'Dimension linetype',
  DIMLUNIT: 'Linear unit format',
  DIMLWD: 'Dimension line and leader lineweight',
  DIMLWE: 'Extension line lineweight',
  DIMMZF: 'Sub-units factor',
  DIMMZS: 'Sub-unit suffix',
  DIMPOST: 'Prefix and suffix for dimension text',
  DIMRND: 'Rounding value',
  DIMSAH: 'Separate arrow blocks',
  DIMSCALE: 'Overall scale factor',
  DIMSD1: 'Suppress the first dimension line',
  DIMSD2: 'Suppress the second dimension line',
  DIMSE1: 'Suppress the first extension line',
  DIMSE2: 'Suppress the second extension line',
  DIMSOXD: 'Suppress outside dimension lines',
  DIMTAD: 'Place text above the dimension line',
  DIMTALN: 'Tolerance alignment',
  DIMTDEC: 'Tolerance decimal places',
  DIMTFAC: 'Tolerance text height scaling factor',
  DIMTFILL: 'Text background enabled',
  DIMTFILLCLR: 'Text background color',
  DIMTIH: 'Text inside extensions is horizontal',
  DIMTIX: 'Place text inside extensions',
  DIMTM: 'Minus tolerance',
  DIMTMOVE: 'Text movement',
  DIMTOFL: 'Force line inside extension lines',
  DIMTOH: 'Text outside horizontal',
  DIMTOL: 'Tolerance dimensioning',
  DIMTOLJ: 'Tolerance vertical justification',
  DIMTP: 'Plus tolerance',
  DIMTSZ: 'Tick size',
  DIMTVP: 'Text vertical position',
  DIMTXSTY: 'Text style',
  DIMTXT: 'Text height',
  DIMTXTDIRECTION: 'Dimension text direction',
  DIMTZIN: 'Tolerance zero suppression',
  DIMUPT: 'User positioned text',
  DIMZIN: 'Zero suppression',
};

/** The variables a style shows, by name: its DIMVARs (the obsolete DIMFIT and DIMUNIT aside) and the xdata settings. */
export const DIMSTYLE_LISTED_VARS: readonly string[] = [
  ...Object.values(DIMVAR_BY_CODE).filter((n) => n !== 'DIMFIT' && n !== 'DIMUNIT'),
  ...DIMSTYLE_XDATA_VARS.map((v) => v.name),
].sort();

/** The switches, shown On or Off. */
const SWITCHES = new Set([
  'DIMALT',
  'DIMFXLON',
  'DIMLIM',
  'DIMSAH',
  'DIMSD1',
  'DIMSD2',
  'DIMSE1',
  'DIMSE2',
  'DIMSOXD',
  'DIMTIH',
  'DIMTIX',
  'DIMTOFL',
  'DIMTOH',
  'DIMTOL',
  'DIMTXTDIRECTION',
  'DIMUPT',
]);

const COLORS = new Set(['DIMCLRD', 'DIMCLRE', 'DIMCLRT', 'DIMTFILLCLR']);

/** DXF integer groups (16- and 32-bit), whose variables hold whole numbers. */
const INTEGER_CODES = (code: number): boolean =>
  (code >= 60 && code <= 99) ||
  (code >= 170 && code <= 179) ||
  (code >= 270 && code <= 294) ||
  (code >= 370 && code <= 379);

const INTEGERS = new Set([
  ...Object.entries(DIMVAR_BY_CODE)
    .filter(([code]) => INTEGER_CODES(Number(code)))
    .map(([, name]) => name),
  'DIMTALN',
]);

/** A style's variable as the listings show it: `name` resolves a referenced record's handle. */
export function formatDimStyleVar(
  name: string,
  value: DimVarValue | undefined,
  names: (name: string, handle: string) => string,
): string {
  if (DIMSTYLE_REFERENCES.has(name)) {
    const h = typeof value === 'string' && value !== '0' ? value : '';
    return names(name, h);
  }
  if (value === undefined) return '';
  if (SWITCHES.has(name))
    return (typeof value === 'boolean' ? value : Number(value) !== 0) ? 'On' : 'Off';
  if (typeof value === 'boolean') return String(Number(value));
  if (COLORS.has(name) && typeof value === 'number') {
    return value === 0 ? 'BYBLOCK' : value === 256 ? 'BYLAYER' : String(value);
  }
  if (name === 'DIMJOGANG' && typeof value === 'number')
    return String(Number(((value * 180) / Math.PI).toPrecision(12)));
  if (name === 'DIMDSEP') return typeof value === 'number' ? String.fromCharCode(value) : value;
  if (typeof value === 'string') return `"${value}"`;
  if (INTEGERS.has(name)) return String(value);
  return value.toFixed(4);
}

/** A style's variables with AutoCAD's defaults for what it does not state. */
export function listedDimStyleVars(
  vars: Readonly<Record<string, DimVarValue>>,
): Readonly<Record<string, DimVarValue>> {
  return { ...DIMSTYLE_DEFAULTS, ...DIMSTYLE_XDATA_DEFAULTS, ...vars };
}

export interface DimStyleComparison {
  readonly variable: string;
  readonly description: string;
  readonly values: readonly [string, string?];
}

/**
 * Compare Dimension Styles: the variables `a` and `b` (styles' DIMVARs, xdata settings among
 * them) set differently, or every variable of `a` when `b` is undefined (With: <none>), by
 * variable name.
 */
export function compareDimStyles(
  a: Readonly<Record<string, DimVarValue>>,
  b: Readonly<Record<string, DimVarValue>> | undefined,
  names: (name: string, handle: string) => string,
): DimStyleComparison[] {
  const va = listedDimStyleVars(a);
  const vb = b && listedDimStyleVars(b);
  const out: DimStyleComparison[] = [];
  for (const variable of DIMSTYLE_LISTED_VARS) {
    const x = formatDimStyleVar(variable, va[variable], names);
    const description = DIMVAR_DESCRIPTIONS[variable] ?? variable;
    if (!vb) {
      out.push({ variable, description, values: [x] });
      continue;
    }
    const y = formatDimStyleVar(variable, vb[variable], names);
    if (x !== y) out.push({ variable, description, values: [x, y] });
  }
  return out;
}
