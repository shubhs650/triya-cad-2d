// The ribbon's icons (M7-02, DEC-020, UI_SPEC.md §2): Fluent UI System Icons where Fluent has
// one that says the command, Triya's CAD glyphs (cad-icons.ts) where it has not. Both are drawn
// on a 20 × 20 grid, so one name is enough for every size the ribbon shows them at.
import { CAD_GLYPHS, type CadGlyph, type CadIconName } from './cad-icons';
import { FLUENT_ICONS, type FluentIconName } from './fluent-icons';

export type IconName = FluentIconName | CadIconName;

/** How to draw an icon: Fluent's filled path, or a CAD glyph's stroked path and vertex dots. */
export type IconArt =
  { readonly kind: 'fluent'; readonly d: string } | ({ readonly kind: 'cad' } & CadGlyph);

export function iconArt(name: IconName): IconArt {
  if (Object.hasOwn(FLUENT_ICONS, name))
    return { kind: 'fluent', d: FLUENT_ICONS[name as FluentIconName] };
  return { kind: 'cad', ...(CAD_GLYPHS[name as CadIconName] as CadGlyph) };
}

/** Every icon's name, for the tests' contact sheet. */
export const ICON_NAMES: readonly IconName[] = [
  ...(Object.keys(FLUENT_ICONS) as FluentIconName[]),
  ...(Object.keys(CAD_GLYPHS) as CadIconName[]),
];
