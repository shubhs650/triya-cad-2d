// The ribbon's content (M7-01, UI_SPEC.md §2–§3, DEC-017): tabs → panels → items, with AutoCAD's
// tab, panel and item names so a drafter's spatial memory transfers. The layout (layout.ts)
// reads only this data: each item's explicit size at each breakpoint, `protected` on the Home
// Draw/Modify/Annotation items (never overflow), and each other panel's compression rule.
//
// Items run a registered command, as typed at the command line (`invoke`, then `keys` typed at
// its first prompts, as AutoCAD's ribbon macros do: `^C^C_circle _2p`), or a drafting toggle.
// Each item names its icon (M7-02): a Fluent UI System Icon or one of Triya's CAD glyphs
// (`icons.tsx`); its rich tooltip (`tooltips.ts`) adds a description, the command, its aliases
// and keys.

import type { IconName } from './icons';

/** How an item shows at a breakpoint: a big icon over its label, a small icon and label, an icon. */
export type ItemSize = 'large-label' | 'small-label' | 'icon';

/** An item's explicit size rules (UI_SPEC §3); compact uses the laptop's. */
export interface ItemSizes {
  readonly full: ItemSize;
  readonly wide: ItemSize;
  readonly laptop: ItemSize;
}

/** What an item does: a command with the keywords typed at its first prompts, or a toggle. */
export type RibbonRun =
  | { readonly command: string; readonly keys?: readonly string[] }
  /** A drafting toggle (`drafting:<toggle>`): flipped, or set to `on`. */
  | { readonly action: string; readonly on?: boolean };

export interface RibbonItem {
  /** Unique within its tab. */
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly run: RibbonRun;
  readonly sizes: ItemSizes;
  /** A Home Draw, Modify or Annotation item: always shown, never in an overflow list. */
  readonly protected?: true;
  /**
   * A split button's drop-down list (AutoCAD's ▾ groups): the button runs the entry picked last,
   * the first until then.
   */
  readonly menu?: readonly RibbonItem[];
}

export interface RibbonPanel {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RibbonItem[];
  /**
   * How the panel gives up room when the ribbon is short of it, `order` first (1, 2, …): it keeps
   * the items `keep` names and lists the rest in an overflow list, or with none kept becomes one
   * button listing the whole panel. Protected panels have none.
   */
  readonly compress?: { readonly order: number; readonly keep: readonly string[] };
}

export interface RibbonTab {
  readonly id: string;
  readonly label: string;
  readonly panels: readonly RibbonPanel[];
}

/** A primary item: a large labelled button when full, small labelled when wide, an icon below. */
const BIG: ItemSizes = { full: 'large-label', wide: 'small-label', laptop: 'icon' };
/** A labelled item when full and wide. */
const LABELLED: ItemSizes = { full: 'small-label', wide: 'small-label', laptop: 'icon' };
/** A secondary item (UI_SPEC §3): labelled when full, icon-only with a tooltip below that. */
const SECONDARY: ItemSizes = { full: 'small-label', wide: 'icon', laptop: 'icon' };
/** A tool-row icon at every size (the Layers panel's tools). */
const ICON: ItemSizes = { full: 'icon', wide: 'icon', laptop: 'icon' };

function cmd(
  id: string,
  label: string,
  icon: IconName,
  command: string,
  sizes: ItemSizes = LABELLED,
  keys?: readonly string[],
): RibbonItem {
  return { id, label, icon, sizes, run: keys ? { command, keys } : { command } };
}

/** A split button; its entries take its sizes. */
function split(
  id: string,
  label: string,
  icon: IconName,
  sizes: ItemSizes,
  entries: readonly RibbonItem[],
): RibbonItem {
  return {
    id,
    label,
    icon,
    sizes,
    run: entries[0]!.run,
    menu: entries.map((e) => ({ ...e, sizes })),
  };
}

function toggle(
  id: string,
  label: string,
  icon: IconName,
  action: string,
  on?: boolean,
): RibbonItem {
  return { id, label, icon, sizes: ICON, run: on === undefined ? { action } : { action, on } };
}

const protect = (items: readonly RibbonItem[]): RibbonItem[] =>
  items.map((i) => ({
    ...i,
    protected: true as const,
    ...(i.menu && { menu: i.menu.map((e) => ({ ...e, protected: true as const })) }),
  }));

const HOME: RibbonTab = {
  id: 'home',
  label: 'Home',
  panels: [
    {
      id: 'draw',
      label: 'Draw',
      items: protect([
        cmd('line', 'Line', 'line', 'LINE', BIG),
        cmd('polyline', 'Polyline', 'polyline', 'PLINE', BIG),
        split('circle', 'Circle', 'circle-cr', BIG, [
          cmd('circle-cr', 'Center, Radius', 'circle-cr', 'CIRCLE'),
          cmd('circle-2p', '2-Point', 'circle-2p', 'CIRCLE', LABELLED, ['2P']),
          cmd('circle-3p', '3-Point', 'circle-3p', 'CIRCLE', LABELLED, ['3P']),
          cmd('circle-ttr', 'Tan, Tan, Radius', 'circle-ttr', 'CIRCLE', LABELLED, ['T']),
        ]),
        split('arc', 'Arc', 'arc', BIG, [
          cmd('arc-3p', '3-Point', 'arc', 'ARC'),
          cmd('arc-cse', 'Center, Start, End', 'arc-cse', 'ARC', LABELLED, ['C']),
        ]),
        split('rectangle', 'Rectangle', 'rectangle_landscape', LABELLED, [
          cmd('rectang', 'Rectangle', 'rectangle_landscape', 'RECTANG'),
          cmd('polygon', 'Polygon', 'pentagon', 'POLYGON'),
        ]),
        split('ellipse', 'Ellipse', 'ellipse-center', LABELLED, [
          cmd('ellipse-center', 'Center', 'ellipse-center', 'ELLIPSE', LABELLED, ['C']),
          cmd('ellipse-axis', 'Axis, End', 'ellipse-axis', 'ELLIPSE'),
          cmd('ellipse-arc', 'Elliptical Arc', 'ellipse-arc', 'ELLIPSE', LABELLED, ['A']),
        ]),
        split('hatch', 'Hatch', 'hatch', LABELLED, [
          cmd('hatch-hatch', 'Hatch', 'hatch', 'HATCH'),
          cmd('gradient', 'Gradient', 'gradient', 'GRADIENT'),
        ]),
        split('spline', 'Spline', 'spline-fit', LABELLED, [
          cmd('spline-fit', 'Spline Fit', 'spline-fit', 'SPLINE', LABELLED, ['M', 'F']),
          cmd('spline-cv', 'Spline CV', 'spline-cv', 'SPLINE', LABELLED, ['M', 'CV']),
        ]),
        split('xline', 'Construction Line', 'xline', ICON, [
          cmd('xline-xline', 'Construction Line', 'xline', 'XLINE'),
          cmd('ray', 'Ray', 'ray', 'RAY'),
        ]),
        split('point', 'Point', 'point', ICON, [
          cmd('point-multiple', 'Multiple Points', 'point', 'POINT'),
          cmd('divide', 'Divide', 'divide', 'DIVIDE'),
          cmd('measure', 'Measure', 'measure', 'MEASURE'),
        ]),
        split('revcloud', 'Revision Cloud', 'revcloud-rect', ICON, [
          cmd('revcloud-rect', 'Rectangular', 'revcloud-rect', 'REVCLOUD', LABELLED, ['R']),
          cmd('revcloud-poly', 'Polygonal', 'revcloud-poly', 'REVCLOUD', LABELLED, ['P']),
          cmd('revcloud-free', 'Freehand', 'revcloud-free', 'REVCLOUD', LABELLED, ['F']),
          cmd('revcloud-object', 'Object', 'revcloud-object', 'REVCLOUD', LABELLED, ['O']),
        ]),
        cmd('wipeout', 'Wipeout', 'wipeout', 'WIPEOUT', ICON),
      ]),
    },
    {
      id: 'modify',
      label: 'Modify',
      items: protect([
        cmd('move', 'Move', 'arrow_move', 'MOVE'),
        cmd('copy', 'Copy', 'copy_arrow_right', 'COPY'),
        cmd('stretch', 'Stretch', 'stretch', 'STRETCH'),
        cmd('rotate', 'Rotate', 'arrow_rotate_clockwise', 'ROTATE'),
        cmd('mirror', 'Mirror', 'flip_horizontal', 'MIRROR'),
        cmd('scale', 'Scale', 'resize', 'SCALE'),
        split('trim', 'Trim', 'trim', LABELLED, [
          cmd('trim-trim', 'Trim', 'trim', 'TRIM'),
          cmd('trim-extend', 'Extend', 'extend', 'EXTEND'),
        ]),
        cmd('extend', 'Extend', 'extend', 'EXTEND', ICON),
        split('fillet', 'Fillet', 'fillet', LABELLED, [
          cmd('fillet-fillet', 'Fillet', 'fillet', 'FILLET'),
          cmd('fillet-chamfer', 'Chamfer', 'chamfer', 'CHAMFER'),
        ]),
        cmd('chamfer', 'Chamfer', 'chamfer', 'CHAMFER', ICON),
        split('array', 'Array', 'array-rect', LABELLED, [
          cmd('array-rect', 'Rectangular Array', 'array-rect', 'ARRAYRECT'),
          cmd('array-polar', 'Polar Array', 'array-polar', 'ARRAYPOLAR'),
          cmd('array-path', 'Path Array', 'array-path', 'ARRAYPATH'),
        ]),
        cmd('offset', 'Offset', 'offset', 'OFFSET', ICON),
        cmd('explode', 'Explode', 'explode', 'EXPLODE', ICON),
        cmd('erase', 'Erase', 'eraser', 'ERASE', ICON),
        split('break', 'Break', 'break', ICON, [
          cmd('break-break', 'Break', 'break', 'BREAK'),
          cmd('break-at-point', 'Break at Point', 'break-at-point', 'BREAKATPOINT'),
        ]),
        cmd('join', 'Join', 'join', 'JOIN', ICON),
        cmd('lengthen', 'Lengthen', 'lengthen', 'LENGTHEN', ICON),
        cmd('align', 'Align', 'align', 'ALIGN', ICON),
        cmd('overkill', 'Overkill', 'overkill', 'OVERKILL', ICON),
      ]),
    },
    {
      id: 'annotation',
      label: 'Annotation',
      items: protect([
        split('text', 'Text', 'text_t', BIG, [
          cmd('mtext', 'Multiline Text', 'text_t', 'MTEXT'),
          cmd('dtext', 'Single Line', 'text_font', 'TEXT'),
        ]),
        split('dimension', 'Dimension', 'dim-linear', BIG, [
          cmd('dim-linear', 'Linear', 'dim-linear', 'DIMLINEAR'),
          cmd('dim-aligned', 'Aligned', 'dim-aligned', 'DIMALIGNED'),
          cmd('dim-angular', 'Angular', 'dim-angular', 'DIMANGULAR'),
          cmd('dim-arc', 'Arc Length', 'dim-arc', 'DIMARC'),
          cmd('dim-radius', 'Radius', 'dim-radius', 'DIMRADIUS'),
          cmd('dim-diameter', 'Diameter', 'dim-diameter', 'DIMDIAMETER'),
          cmd('dim-jogged', 'Jogged', 'dim-jogged', 'DIMJOGGED'),
          cmd('dim-ordinate', 'Ordinate', 'dim-ordinate', 'DIMORDINATE'),
        ]),
        split('leader', 'Leader', 'mleader', LABELLED, [
          cmd('mleader', 'Multileader', 'mleader', 'MLEADER'),
          cmd('mleader-add', 'Add Leader', 'mleader-add', 'AIMLEADEREDITADD'),
          cmd('mleader-remove', 'Remove Leader', 'mleader-remove', 'AIMLEADEREDITREMOVE'),
        ]),
        cmd('table', 'Table', 'table', 'TABLE'),
        split('centerline', 'Centerline', 'centerline', LABELLED, [
          cmd('centerline-line', 'Centerline', 'centerline', 'CENTERLINE'),
          cmd('centermark', 'Center Mark', 'centermark', 'CENTERMARK'),
        ]),
      ]),
    },
    {
      id: 'layers',
      label: 'Layers',
      compress: { order: 6, keep: ['layer-properties'] },
      items: [
        cmd('layer-properties', 'Layer Properties', 'layer', 'LAYER', BIG),
        cmd('layer-off', 'Off', 'eye_off', 'LAYOFF', ICON),
        cmd('layer-isolate', 'Isolate', 'layer-isolate', 'LAYISO', ICON),
        cmd('layer-unisolate', 'Unisolate', 'layer_diagonal', 'LAYUNISO', ICON),
        cmd('layer-freeze', 'Freeze', 'weather_snowflake', 'LAYFRZ', ICON),
        cmd('layer-lock', 'Lock', 'lock_closed', 'LAYLCK', ICON),
        cmd('layer-unlock', 'Unlock', 'lock_open', 'LAYULK', ICON),
        cmd('layer-on', 'Turn All Layers On', 'eye', 'LAYON', ICON),
        cmd('layer-thaw', 'Thaw All Layers', 'weather_sunny', 'LAYTHW', ICON),
        cmd('layer-make-current', 'Make Current', 'checkmark_circle', 'LAYMCUR', ICON),
        cmd('layer-match', 'Match Layer', 'paint_brush_arrow_down', 'LAYMCH', ICON),
        cmd('layer-previous', 'Previous', 'history', 'LAYERP', ICON),
      ],
    },
    {
      id: 'block',
      label: 'Block',
      compress: { order: 5, keep: ['insert'] },
      items: [
        cmd('insert', 'Insert', 'cube_arrow_curve_down', 'INSERT', BIG),
        cmd('create', 'Create', 'cube_add', 'BLOCK', SECONDARY),
        cmd('edit', 'Edit', 'cube_tree', 'BEDIT', SECONDARY),
        split('edit-attributes', 'Edit Attributes', 'tag_edit', SECONDARY, [
          cmd('eattedit', 'Single', 'tag_edit', 'EATTEDIT'),
          cmd('battman', 'Block Attribute Manager', 'tag_multiple', 'BATTMAN'),
        ]),
      ],
    },
    {
      id: 'properties',
      label: 'Properties',
      compress: { order: 4, keep: ['match-properties'] },
      items: [
        cmd('match-properties', 'Match Properties', 'paint_brush', 'MATCHPROP', BIG),
        cmd('properties', 'Properties', 'apps_list_detail', 'PROPERTIES', SECONDARY),
      ],
    },
    {
      id: 'groups',
      label: 'Groups',
      compress: { order: 3, keep: [] },
      items: [
        cmd('group', 'Group', 'group', 'GROUP', BIG),
        cmd('ungroup', 'Ungroup', 'group_dismiss', 'UNGROUP', ICON),
        cmd('group-edit', 'Group Edit', 'pen', 'GROUPEDIT', ICON),
        cmd('group-manager', 'Group Manager', 'group_list', 'CLASSICGROUP', ICON),
        toggle('group-selection', 'Group Selection On/Off', 'select_object', 'drafting:groups'),
        toggle('group-box', 'Group Bounding Box On/Off', 'border_outside', 'drafting:groupBox'),
      ],
    },
    {
      id: 'utilities',
      label: 'Utilities',
      compress: { order: 2, keep: [] },
      items: [
        split('measure-tools', 'Measure', 'ruler', BIG, [
          cmd('measure-geom', 'Measure', 'ruler', 'MEASUREGEOM'),
          cmd('dist', 'Distance', 'distance', 'DIST'),
          cmd('area', 'Area', 'area', 'AREA'),
        ]),
        cmd('quick-select', 'Quick Select', 'filter', 'QSELECT', SECONDARY),
        cmd('id-point', 'ID Point', 'location', 'ID', SECONDARY),
        cmd('list', 'List', 'text_bullet_list_square', 'LIST', SECONDARY),
      ],
    },
    {
      id: 'clipboard',
      label: 'Clipboard',
      compress: { order: 1, keep: [] },
      items: [
        split('paste', 'Paste', 'clipboard_paste', BIG, [
          cmd('pasteclip', 'Paste', 'clipboard_paste', 'PASTECLIP'),
          cmd('pasteblock', 'Paste as Block', 'clipboard_more', 'PASTEBLOCK'),
          cmd('pasteorig', 'Paste to Original Coordinates', 'clipboard_arrow_right', 'PASTEORIG'),
        ]),
        cmd('cut', 'Cut', 'cut', 'CUTCLIP', ICON),
        cmd('copy-clip', 'Copy Clip', 'copy', 'COPYCLIP', ICON),
        cmd('copy-base', 'Copy with Base Point', 'copy_select', 'COPYBASE', ICON),
      ],
    },
  ],
};

const INSERT: RibbonTab = {
  id: 'insert',
  label: 'Insert',
  panels: [
    {
      id: 'block',
      label: 'Block',
      items: [
        cmd('insert', 'Insert', 'cube_arrow_curve_down', 'INSERT', BIG),
        cmd('create', 'Create Block', 'cube_add', 'BLOCK', SECONDARY),
        cmd('define-attributes', 'Define Attributes', 'tag_add', 'ATTDEF', SECONDARY),
        cmd('manage-attributes', 'Manage Attributes', 'tag_multiple', 'BATTMAN', SECONDARY),
        cmd('block-editor', 'Block Editor', 'cube_tree', 'BEDIT', SECONDARY),
        cmd('edit-attribute', 'Edit Attribute', 'tag_edit', 'EATTEDIT', SECONDARY),
      ],
    },
    {
      id: 'reference',
      label: 'Reference',
      items: [
        split('attach', 'Attach', 'attach', BIG, [
          cmd('xattach', 'Attach DWG', 'attach', 'XATTACH'),
          cmd('imageattach', 'Attach Image', 'image_add', 'IMAGEATTACH'),
          cmd('pdfattach', 'Attach PDF', 'document_pdf', 'PDFATTACH'),
        ]),
        cmd('clip', 'Clip', 'crop', 'XCLIP', SECONDARY),
        split('adjust', 'Adjust', 'image_edit', SECONDARY, [
          cmd('imageadjust', 'Adjust Image', 'image_edit', 'IMAGEADJUST'),
          cmd('pdfadjust', 'Adjust PDF Underlay', 'document_edit', 'PDFADJUST'),
        ]),
        cmd(
          'xref-palette',
          'External References',
          'link_multiple',
          'EXTERNALREFERENCES',
          SECONDARY,
        ),
        cmd('bind', 'Bind', 'merge', 'XBIND', SECONDARY),
        cmd('underlay-layers', 'Underlay Layers', 'layer_diagonal', 'ULAYERS', SECONDARY),
        split('underlay-snap', 'Snap to Underlays', 'target', SECONDARY, [
          toggle(
            'underlay-snap-on',
            'Snap to Underlays ON',
            'target',
            'drafting:underlaySnap',
            true,
          ),
          toggle(
            'underlay-snap-off',
            'Snap to Underlays OFF',
            'target',
            'drafting:underlaySnap',
            false,
          ),
        ]),
      ],
    },
    {
      id: 'import',
      label: 'Import',
      items: [cmd('pdf-import', 'PDF Underlay', 'arrow_import', 'PDFATTACH', BIG)],
    },
    {
      id: 'data',
      label: 'Data',
      items: [cmd('field', 'Field', 'text_field', 'FIELD', BIG)],
    },
  ],
};

export const RIBBON_TABS: readonly RibbonTab[] = [HOME, INSERT];
