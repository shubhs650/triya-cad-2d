// Dimension sub-styles (M4-03 part 2): the Create New Dimension Style dialog's "Use for" (AutoCAD
// 2024 Help, "Create New Dimension Style Dialog Box": "Creates a dimension substyle that applies
// only to specific dimension types"). AutoCAD files a sub-style as a DIMSTYLE record of its own,
// named after its parent with `$` and the dimension type it is for: `Standard$0` for Standard's
// linear dimensions. The Dimension Style Manager shows it under its parent, by the type's name.
//
// A dimension made in the parent style names the parent (DXF 3, and Properties shows it), and is
// drawn with its sub-style's DIMVARs, its own DSTYLE overrides on top: the sub-style "applies to"
// those dimensions. AutoCAD's Help does not say which sub-style an aligned, jogged or arc length
// dimension takes. Triya takes the common drafter's reading: an aligned dimension is a linear
// one (the dialog has no type of its own for it), a jogged radius a radius, and an arc length,
// which measures along an arc rather than across it, keeps the parent.
import type { DocumentModel } from '../model/document';
import type { Handle } from '../model/handle';
import type { DimStyleRecord, Entity } from '../model/types';

/** What a sub-style is used for (`all`: the style itself). */
export type DimStyleUse =
  'all' | 'linear' | 'angular' | 'radius' | 'diameter' | 'ordinate' | 'leader';

/** The digit after `$` that names each kind of sub-style (DXF 70 dimension type; 7 leaders). */
export const DIMSTYLE_USE_SUFFIX: Readonly<Record<Exclude<DimStyleUse, 'all'>, number>> = {
  linear: 0,
  angular: 2,
  diameter: 3,
  radius: 4,
  ordinate: 6,
  leader: 7,
};

/** Use for's choices, in AutoCAD's order. */
export const DIMSTYLE_USES: readonly { readonly value: DimStyleUse; readonly label: string }[] = [
  { value: 'all', label: 'All dimensions' },
  { value: 'linear', label: 'Linear dimensions' },
  { value: 'angular', label: 'Angular dimensions' },
  { value: 'radius', label: 'Radius dimensions' },
  { value: 'diameter', label: 'Diameter dimensions' },
  { value: 'ordinate', label: 'Ordinate dimensions' },
  { value: 'leader', label: 'Leaders and Tolerances' },
];

/** The name of `parent`'s sub-style for `use`. */
export function childStyleName(parent: string, use: Exclude<DimStyleUse, 'all'>): string {
  return `${parent}$${DIMSTYLE_USE_SUFFIX[use]}`;
}

/** The parent and use of a sub-style's name; undefined for a style of its own. */
export function childStyleUse(
  name: string,
): { readonly parent: string; readonly use: Exclude<DimStyleUse, 'all'> } | undefined {
  const m = /^(.*)\$(\d)$/.exec(name);
  if (!m || m[1] === '' || m[1]!.includes('$')) return undefined;
  const digit = Number(m[2]);
  const use = (Object.keys(DIMSTYLE_USE_SUFFIX) as Exclude<DimStyleUse, 'all'>[]).find(
    (u) => DIMSTYLE_USE_SUFFIX[u] === digit,
  );
  return use ? { parent: m[1]!, use } : undefined;
}

/** The sub-style kind an object's dimension style applies to it as; undefined: the parent's. */
export function dimStyleUseOf(g: Entity['geom']): Exclude<DimStyleUse, 'all'> | undefined {
  switch (g.kind) {
    case 'LEADER':
    case 'TOLERANCE':
      return 'leader';
    case 'LARGE_RADIAL_DIMENSION':
      return 'radius';
    case 'DIMENSION':
      switch (g.dimType) {
        case 'linear':
        case 'aligned':
          return 'linear';
        case 'angular':
        case 'angular3pt':
          return 'angular';
        case 'radius':
          return 'radius';
        case 'diameter':
          return 'diameter';
        case 'ordinate':
          return 'ordinate';
        default:
          return undefined;
      }
    default:
      return undefined;
  }
}

type Styles = Pick<DocumentModel, 'tables'>;

/** `parent`'s sub-style for `use`, when the drawing has one. */
export function childStyleOf(
  model: Styles,
  parent: Handle,
  use: Exclude<DimStyleUse, 'all'> | undefined,
): DimStyleRecord | undefined {
  const p = model.tables.dimStyles.get(parent);
  if (!p || use === undefined || p.name.includes('$')) return undefined;
  const name = childStyleName(p.name, use).toUpperCase();
  for (const s of model.tables.dimStyles.values()) if (s.name.toUpperCase() === name) return s;
  return undefined;
}

/**
 * The DIMSTYLE an object is drawn with: its style's sub-style for its kind when the drawing has
 * one, else the style it names.
 */
export function drawnDimStyle(
  model: Styles,
  g: Entity['geom'] & { readonly style: Handle },
): Handle {
  return childStyleOf(model, g.style, dimStyleUseOf(g))?.handle ?? g.style;
}
