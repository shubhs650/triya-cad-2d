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

import type { RibbonSelection } from '@triya/engine';
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
  /**
   * A contextual tab's option of the command running (M7-02 part 4): `keyword` typed at its
   * prompt, as AutoCAD's Hatch Creation and Array Creation buttons answer HATCH's and ARRAY's
   * prompts (and Table Cell's TABLECELL's); empty is Enter, which ends it.
   */
  | { readonly keyword: string }
  /**
   * An app action: a drafting toggle (`drafting:<toggle>`), flipped or set to `on`; a palette
   * of the stack shown (`palette:<name>`); the colour theme (`theme:<light|dark|system>`); or a
   * window of the app's own (`app:<aliases|shortcuts>`, M7-02 part 2). A dropdown's is
   * `control:<control>`: it opens its list instead of running. `escape` is Esc: a contextual
   * tab's Close button deselects what showed it.
   */
  | { readonly action: string; readonly on?: boolean };

/**
 * A Layers or Properties dropdown (M7-02 part 3): the layer, colour, linetype, lineweight or
 * transparency of the selection, or with none the current one, which a pick changes. Or one of
 * Annotate's style dropdowns (part 5): the current text, dimension, multileader or table style.
 */
export type RibbonControl =
  | 'layer'
  | 'color'
  | 'linetype'
  | 'lineweight'
  | 'transparency'
  | 'text-style'
  | 'dim-style'
  | 'mleader-style'
  | 'table-style';

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
  /**
   * Why the item is shown but cannot run (UI_SPEC §2's Annotation Scaling: "Annotative creation
   * is view-only in v1"); its tooltip says so.
   */
  readonly unavailable?: string;
  /**
   * The item is a dropdown, not a button: labelled, it shows the value; as an icon, its icon
   * over the value's swatch. It keeps its size in a compressed panel.
   */
  readonly control?: RibbonControl;
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

/** An app action (a palette, the theme, a window of the app's own). */
function act(
  id: string,
  label: string,
  icon: IconName,
  action: string,
  sizes: ItemSizes = LABELLED,
): RibbonItem {
  return { id, label, icon, sizes, run: { action } };
}

/** A Layers, Properties or style dropdown. */
function control(
  id: string,
  label: string,
  icon: IconName,
  kind: RibbonControl,
  sizes: ItemSizes,
): RibbonItem {
  return { id, label, icon, sizes, control: kind, run: { action: `control:${kind}` } };
}

/** A Properties dropdown: its value shown when full and wide, its swatch on the one-row ribbon. */
const SECONDARY_CONTROL: ItemSizes = { full: 'small-label', wide: 'small-label', laptop: 'icon' };
/** A dropdown that shows its value at every size: the layer list. */
const NAMED: ItemSizes = { full: 'small-label', wide: 'small-label', laptop: 'small-label' };

/** A contextual tab's option of the command running: its keyword, typed. */
function key(
  id: string,
  label: string,
  icon: IconName,
  keyword: string,
  sizes: ItemSizes = LABELLED,
): RibbonItem {
  return { id, label, icon, sizes, run: { keyword } };
}

/** An item AutoCAD has that Triya shows greyed out, saying why (`unavailable`). */
function off(item: RibbonItem, reason: string): RibbonItem {
  return { ...item, unavailable: reason };
}

const protect = (items: readonly RibbonItem[]): RibbonItem[] =>
  items.map((i) => ({
    ...i,
    protected: true as const,
    ...(i.menu && { menu: i.menu.map((e) => ({ ...e, protected: true as const })) }),
  }));

/** Dimension's ▾ list: Home > Annotation and Annotate > Dimensions. */
const DIMENSION_ENTRIES: readonly RibbonItem[] = [
  cmd('dim-linear', 'Linear', 'dim-linear', 'DIMLINEAR'),
  cmd('dim-aligned', 'Aligned', 'dim-aligned', 'DIMALIGNED'),
  cmd('dim-angular', 'Angular', 'dim-angular', 'DIMANGULAR'),
  cmd('dim-arc', 'Arc Length', 'dim-arc', 'DIMARC'),
  cmd('dim-radius', 'Radius', 'dim-radius', 'DIMRADIUS'),
  cmd('dim-diameter', 'Diameter', 'dim-diameter', 'DIMDIAMETER'),
  cmd('dim-jogged', 'Jogged', 'dim-jogged', 'DIMJOGGED'),
  cmd('dim-ordinate', 'Ordinate', 'dim-ordinate', 'DIMORDINATE'),
];

/** Revision Cloud's ▾ list: Home > Draw and Annotate > Markup. */
const REVCLOUD_ENTRIES: readonly RibbonItem[] = [
  cmd('revcloud-rect', 'Rectangular', 'revcloud-rect', 'REVCLOUD', LABELLED, ['R']),
  cmd('revcloud-poly', 'Polygonal', 'revcloud-poly', 'REVCLOUD', LABELLED, ['P']),
  cmd('revcloud-free', 'Freehand', 'revcloud-free', 'REVCLOUD', LABELLED, ['F']),
  cmd('revcloud-object', 'Object', 'revcloud-object', 'REVCLOUD', LABELLED, ['O']),
];

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
        split('revcloud', 'Revision Cloud', 'revcloud-rect', ICON, REVCLOUD_ENTRIES),
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
        split('dimension', 'Dimension', 'dim-linear', BIG, DIMENSION_ENTRIES),
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
      compress: { order: 6, keep: ['layer-properties', 'layer-control'] },
      items: [
        cmd('layer-properties', 'Layer Properties', 'layer', 'LAYER', BIG),
        control('layer-control', 'Layer', 'layer', 'layer', NAMED),
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
        control('color-control', 'Object Color', 'color', 'color', SECONDARY_CONTROL),
        control('linetype-control', 'Linetype', 'linetype', 'linetype', SECONDARY_CONTROL),
        control('lineweight-control', 'Lineweight', 'lineweight', 'lineweight', SECONDARY_CONTROL),
        control(
          'transparency-control',
          'Transparency',
          'transparency_square',
          'transparency',
          ICON,
        ),
        cmd('properties', 'Properties', 'apps_list_detail', 'PROPERTIES', ICON),
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
        cmd('quick-select', 'Quick Select', 'filter', 'QSELECT', ICON),
        cmd('id-point', 'ID Point', 'location', 'ID', ICON),
        cmd('list', 'List', 'text_bullet_list_square', 'LIST', ICON),
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

/** UI_SPEC §2: the annotative scale tools stay greyed out (DEC-058). */
const ANNOTATIVE_VIEW_ONLY = 'Annotative creation is view-only in v1';

// M7-02 part 2: the other tabs of UI_SPEC §2. None is protected, so every panel has a rule for
// giving up room, the panels AutoCAD drafters reach for least giving it up first. Parametric
// comes with the constraints (M9-05); Compare with COMPARE (M8-06).
const ANNOTATE: RibbonTab = {
  id: 'annotate',
  label: 'Annotate',
  panels: [
    {
      id: 'text',
      label: 'Text',
      compress: { order: 6, keep: ['mtext'] },
      items: [
        cmd('mtext', 'Multiline Text', 'text_t', 'MTEXT', BIG),
        cmd('dtext', 'Single Line', 'text_font', 'TEXT'),
        control('text-style', 'Text Style', 'text_edit_style', 'text-style', SECONDARY_CONTROL),
        cmd('find', 'Find Text', 'search', 'FIND', ICON),
        cmd('spell', 'Check Spelling', 'text_grammar_checkmark', 'SPELL', ICON),
        cmd('justify-text', 'Justify', 'text_align_justify', 'JUSTIFYTEXT', ICON),
        cmd('scale-text', 'Scale', 'text_font_size', 'SCALETEXT', ICON),
        cmd('text-align', 'Text Align', 'text_align_distributed', 'TEXTALIGN', ICON),
      ],
    },
    {
      id: 'dimensions',
      label: 'Dimensions',
      compress: { order: 7, keep: ['dimension'] },
      items: [
        split('dimension', 'Dimension', 'dim-linear', BIG, DIMENSION_ENTRIES),
        cmd('qdim', 'Quick', 'dim-quick', 'QDIM', SECONDARY),
        split('continue', 'Continue', 'dim-continue', SECONDARY, [
          cmd('dim-continue', 'Continue', 'dim-continue', 'DIMCONTINUE'),
          cmd('dim-baseline', 'Baseline', 'dim-baseline', 'DIMBASELINE'),
        ]),
        control('dim-style', 'Dimension Style', 'style_guide', 'dim-style', SECONDARY_CONTROL),
        cmd('dim-space', 'Adjust Space', 'dim-space', 'DIMSPACE', ICON),
        cmd('dim-break', 'Break', 'dim-break', 'DIMBREAK', ICON),
        cmd('dim-jogline', 'Jog Line', 'dim-jogline', 'DIMJOGLINE', ICON),
        cmd('dim-inspect', 'Inspect', 'dim-inspect', 'DIMINSPECT', ICON),
        cmd('dim-oblique', 'Oblique', 'dim-oblique', 'DIMEDIT', ICON, ['O']),
        cmd('dim-text-angle', 'Text Angle', 'dim-text-angle', 'DIMTEDIT', ICON),
        cmd('dim-reassociate', 'Reassociate', 'link', 'DIMREASSOCIATE', ICON),
        cmd('dim-disassociate', 'Disassociate', 'link_dismiss', 'DIMDISASSOCIATE', ICON),
        cmd('dim-override', 'Override', 'dim-override', 'DIMOVERRIDE', ICON),
      ],
    },
    {
      id: 'centerlines',
      label: 'Centerlines',
      compress: { order: 4, keep: [] },
      items: [
        cmd('centermark', 'Center Mark', 'centermark', 'CENTERMARK', BIG),
        cmd('centerline-line', 'Centerline', 'centerline', 'CENTERLINE', BIG),
      ],
    },
    {
      id: 'leaders',
      label: 'Leaders',
      compress: { order: 5, keep: ['mleader'] },
      items: [
        cmd('mleader', 'Multileader', 'mleader', 'MLEADER', BIG),
        cmd('mleader-add', 'Add Leader', 'mleader-add', 'AIMLEADEREDITADD', SECONDARY),
        cmd('mleader-remove', 'Remove Leader', 'mleader-remove', 'AIMLEADEREDITREMOVE', SECONDARY),
        cmd('mleader-align', 'Align', 'mleader-align', 'MLEADERALIGN', SECONDARY),
        cmd('mleader-collect', 'Collect', 'mleader-collect', 'MLEADERCOLLECT', ICON),
        control(
          'mleader-style',
          'Multileader Style',
          'style_guide',
          'mleader-style',
          SECONDARY_CONTROL,
        ),
      ],
    },
    {
      id: 'tables',
      label: 'Tables',
      compress: { order: 3, keep: ['table'] },
      items: [
        cmd('table', 'Table', 'table', 'TABLE', BIG),
        control('table-style', 'Table Style', 'table_settings', 'table-style', SECONDARY_CONTROL),
      ],
    },
    {
      id: 'markup',
      label: 'Markup',
      compress: { order: 2, keep: [] },
      items: [
        cmd('wipeout', 'Wipeout', 'wipeout', 'WIPEOUT', LABELLED),
        split('revcloud', 'Revision Cloud', 'revcloud-rect', LABELLED, REVCLOUD_ENTRIES),
      ],
    },
    {
      id: 'annotation-scaling',
      label: 'Annotation Scaling',
      compress: { order: 1, keep: [] },
      items: [
        cmd('scale-list', 'Scale List', 'scale_fit', 'SCALELISTEDIT', BIG),
        off(
          act('add-scales', 'Add/Delete Scales', 'scale_fill', 'none', SECONDARY),
          ANNOTATIVE_VIEW_ONLY,
        ),
        off(
          act('sync-scales', 'Sync Scale Positions', 'arrow_sync', 'none', SECONDARY),
          ANNOTATIVE_VIEW_ONLY,
        ),
      ],
    },
  ],
};

/**
 * Parametric (M9-05, UI_SPEC §2): the Geometric panel's twelve constraints, in AutoCAD's order
 * (Smooth with M9-02 part 2). The Dimensional panel
 * (M9-03 part 3): Linear (with Horizontal and Vertical), Aligned, Radius, Diameter, Angular;
 * Convert greyed out until DIMCONSTRAINT converts dimensions; Show Dynamic Constraints (M9-03
 * part 4); Show/Hide, DCDISPLAY (M9-03 part 7). The Manage panel: Parameters Manager (M9-03
 * part 5). Auto Constrain, the Geometric panel's Show/Hide and Infer, and Delete Constraints
 * come with their commands.
 */
const PARAMETRIC: RibbonTab = {
  id: 'parametric',
  label: 'Parametric',
  panels: [
    {
      id: 'geometric',
      label: 'Geometric',
      compress: { order: 1, keep: [] },
      items: [
        cmd('gc-coincident', 'Coincident', 'gc-coincident', 'GCCOINCIDENT', ICON),
        cmd('gc-collinear', 'Collinear', 'gc-collinear', 'GCCOLLINEAR', ICON),
        cmd('gc-concentric', 'Concentric', 'gc-concentric', 'GCCONCENTRIC', ICON),
        cmd('gc-fix', 'Fix', 'lock_closed', 'GCFIX', ICON),
        cmd('gc-parallel', 'Parallel', 'gc-parallel', 'GCPARALLEL', ICON),
        cmd('gc-perpendicular', 'Perpendicular', 'gc-perpendicular', 'GCPERPENDICULAR', ICON),
        cmd('gc-horizontal', 'Horizontal', 'gc-horizontal', 'GCHORIZONTAL', ICON),
        cmd('gc-vertical', 'Vertical', 'gc-vertical', 'GCVERTICAL', ICON),
        cmd('gc-tangent', 'Tangent', 'gc-tangent', 'GCTANGENT', ICON),
        cmd('gc-smooth', 'Smooth', 'gc-smooth', 'GCSMOOTH', ICON),
        cmd('gc-symmetric', 'Symmetric', 'gc-symmetric', 'GCSYMMETRIC', ICON),
        cmd('gc-equal', 'Equal', 'gc-equal', 'GCEQUAL', ICON),
      ],
    },
    {
      id: 'dimensional',
      label: 'Dimensional',
      compress: { order: 2, keep: ['dc-linear'] },
      items: [
        split('dc-linear', 'Linear', 'dim-linear', BIG, [
          cmd('dc-linear-linear', 'Linear', 'dim-linear', 'DCLINEAR'),
          cmd('dc-horizontal', 'Horizontal', 'dim-linear', 'DCHORIZONTAL'),
          cmd('dc-vertical', 'Vertical', 'dim-linear', 'DCVERTICAL'),
        ]),
        cmd('dc-aligned', 'Aligned', 'dim-aligned', 'DCALIGNED', SECONDARY),
        cmd('dc-radius', 'Radius', 'dim-radius', 'DCRADIUS', SECONDARY),
        cmd('dc-diameter', 'Diameter', 'dim-diameter', 'DCDIAMETER', SECONDARY),
        cmd('dc-angular', 'Angular', 'dim-angular', 'DCANGULAR', SECONDARY),
        {
          ...toggle(
            'dc-show-dynamic',
            'Show Dynamic Constraints',
            'eye',
            'drafting:dynConstraints',
          ),
          sizes: SECONDARY,
        },
        cmd('dc-show-hide', 'Show/Hide', 'eye_off', 'DCDISPLAY', SECONDARY),
        off(
          cmd('dc-convert', 'Convert', 'dim-linear', 'DIMCONSTRAINT', SECONDARY),
          'Converting a dimension to a constraint comes later',
        ),
      ],
    },
    {
      id: 'manage',
      label: 'Manage',
      compress: { order: 3, keep: ['parameters-manager'] },
      items: [cmd('parameters-manager', 'Parameters Manager', 'table_settings', 'PARAMETERS', BIG)],
    },
  ],
};

const VIEW: RibbonTab = {
  id: 'view',
  label: 'View',
  panels: [
    {
      id: 'navigate',
      label: 'Navigate',
      compress: { order: 5, keep: ['zoom'] },
      items: [
        split('zoom', 'Zoom', 'zoom_fit', BIG, [
          cmd('zoom-extents', 'Extents', 'zoom_fit', 'ZOOM', LABELLED, ['E']),
          cmd('zoom-window', 'Window', 'search_square', 'ZOOM', LABELLED, ['W']),
          cmd('zoom-previous', 'Previous', 'arrow_previous', 'ZOOM', LABELLED, ['P']),
          cmd('zoom-realtime', 'Realtime', 'search', 'ZOOM'),
          cmd('zoom-all', 'All', 'full_screen_maximize', 'ZOOM', LABELLED, ['A']),
          cmd('zoom-center', 'Center', 'location_arrow', 'ZOOM', LABELLED, ['C']),
          cmd('zoom-object', 'Object', 'select_object', 'ZOOM', LABELLED, ['O']),
          cmd('zoom-in', 'In', 'zoom_in', 'ZOOM', LABELLED, ['2X']),
          cmd('zoom-out', 'Out', 'zoom_out', 'ZOOM', LABELLED, ['0.5X']),
        ]),
        cmd('pan', 'Pan', 'hand_left', 'PAN', SECONDARY),
        cmd('named-views', 'Named Views', 'camera', 'VIEW', SECONDARY),
      ],
    },
    {
      id: 'viewport-tools',
      label: 'Viewport Tools',
      compress: { order: 2, keep: [] },
      items: [
        split('ucs-icon', 'UCS Icon', 'ucs-icon', SECONDARY, [
          cmd('ucs-icon-on', 'Show UCS Icon', 'ucs-icon', 'UCSICON', LABELLED, ['ON']),
          cmd('ucs-icon-off', 'Hide UCS Icon', 'ucs-icon', 'UCSICON', LABELLED, ['OFF']),
        ]),
        cmd('ucs', 'UCS', 'ucs', 'UCS', SECONDARY),
        cmd('regen', 'Regen', 'arrow_clockwise', 'REGEN', SECONDARY),
        cmd('regen-all', 'Regen All', 'arrow_sync', 'REGENALL', ICON),
      ],
    },
    {
      id: 'model-viewports',
      label: 'Model Viewports',
      compress: { order: 1, keep: [] },
      items: [cmd('viewport-config', 'Viewport Configuration', 'board_split', 'VPORTS', BIG)],
    },
    {
      id: 'palettes',
      label: 'Palettes',
      compress: { order: 4, keep: ['properties'] },
      items: [
        cmd('properties', 'Properties', 'apps_list_detail', 'PROPERTIES', BIG),
        cmd('layers-palette', 'Layers', 'layer', 'LAYER', SECONDARY),
        cmd('designcenter', 'DesignCenter', 'app_folder', 'ADCENTER', SECONDARY),
        cmd('references', 'External References', 'link_multiple', 'EXTERNALREFERENCES', SECONDARY),
        act('health', 'Health', 'heart_pulse', 'palette:health', SECONDARY),
        act('history', 'Command History', 'history', 'palette:history', SECONDARY),
      ],
    },
    {
      id: 'interface',
      label: 'Interface',
      compress: { order: 3, keep: [] },
      items: [
        split('theme', 'Theme', 'dark_theme', BIG, [
          act('theme-system', 'Use System Setting', 'dark_theme', 'theme:system'),
          act('theme-light', 'Light', 'weather_sunny', 'theme:light'),
          act('theme-dark', 'Dark', 'weather_moon', 'theme:dark'),
        ]),
      ],
    },
  ],
};

const OUTPUT: RibbonTab = {
  id: 'output',
  label: 'Output',
  panels: [
    {
      id: 'plot',
      label: 'Plot',
      compress: { order: 3, keep: ['plot'] },
      items: [
        cmd('plot', 'Plot', 'print', 'PLOT', BIG),
        cmd('preview', 'Preview', 'document_search', 'PREVIEW', SECONDARY),
        cmd('page-setup', 'Page Setup Manager', 'document_landscape', 'PAGESETUP', SECONDARY),
      ],
    },
    {
      id: 'export',
      label: 'Export',
      compress: { order: 2, keep: ['export-pdf'] },
      items: [
        cmd('export-pdf', 'Export to PDF', 'document_pdf', 'EXPORTPDF', BIG),
        cmd('export', 'Export', 'arrow_export_ltr', 'EXPORT', SECONDARY),
      ],
    },
    {
      id: 'publish',
      label: 'Publish',
      compress: { order: 1, keep: [] },
      items: [cmd('publish', 'Publish', 'document_multiple', 'PUBLISH', BIG)],
    },
  ],
};

const LAYOUT: RibbonTab = {
  id: 'layout',
  label: 'Layout',
  panels: [
    {
      id: 'layout',
      label: 'Layout',
      compress: { order: 2, keep: ['new-layout'] },
      items: [
        split('new-layout', 'New', 'tab_add', BIG, [
          cmd('layout-new', 'New Layout', 'tab_add', 'LAYOUT', LABELLED, ['N']),
          cmd('layout-template', 'From Template', 'document_one_page_add', 'LAYOUT', LABELLED, [
            'T',
          ]),
        ]),
        cmd('page-setup', 'Page Setup', 'document_landscape', 'PAGESETUP', SECONDARY),
        cmd('layout-copy', 'Copy Layout', 'document_copy', 'LAYOUT', SECONDARY, ['C']),
        cmd('layout-rename', 'Rename Layout', 'rename', 'LAYOUT', ICON, ['R']),
        cmd('layout-delete', 'Delete Layout', 'document_dismiss', 'LAYOUT', ICON, ['D']),
      ],
    },
    {
      id: 'layout-viewports',
      label: 'Layout Viewports',
      compress: { order: 1, keep: ['viewports'] },
      items: [
        split('viewports', 'Viewport', 'rectangle_landscape', BIG, [
          cmd('mview-rect', 'Rectangular', 'rectangle_landscape', 'MVIEW'),
          cmd('mview-poly', 'Polygonal', 'pentagon', 'MVIEW', LABELLED, ['P']),
          cmd('mview-object', 'Object', 'select_object', 'MVIEW', LABELLED, ['O']),
        ]),
        cmd('vp-clip', 'Clip', 'crop', 'VPCLIP', SECONDARY),
        cmd('vp-lock', 'Lock', 'lock_closed', 'MVIEW', SECONDARY, ['L']),
        cmd('vp-layer', 'Viewport Layers', 'layer_diagonal', 'VPLAYER', ICON),
        cmd('vp-max', 'Maximize Viewport', 'full_screen_maximize', 'VPMAX', ICON),
        cmd('vp-min', 'Minimize Viewport', 'full_screen_minimize', 'VPMIN', ICON),
        cmd('scale-list', 'Scale List', 'scale_fit', 'SCALELISTEDIT', ICON),
      ],
    },
  ],
};

const TOOLS: RibbonTab = {
  id: 'tools',
  label: 'Tools',
  panels: [
    {
      id: 'drawing-utilities',
      label: 'Drawing Utilities',
      compress: { order: 4, keep: ['units'] },
      items: [
        cmd('units', 'Units', 'ruler', 'UNITS', BIG),
        act('health', 'Drawing Health', 'heart_pulse', 'palette:health', SECONDARY),
        act('diagnostics', 'Diagnostics', 'top_speed', 'palette:diagnostics', SECONDARY),
        cmd('purge', 'Purge', 'broom', 'PURGE', SECONDARY),
        cmd('recover', 'Drawing Recovery', 'drafts', 'DRAWINGRECOVERY', SECONDARY),
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      compress: { order: 3, keep: ['options'] },
      items: [
        cmd('options', 'Options', 'settings', 'OPTIONS', BIG),
        cmd('drafting-settings', 'Drafting Settings', 'grid', 'DSETTINGS', SECONDARY),
        cmd('linetype', 'Linetype', 'linetype', 'LINETYPE', SECONDARY),
        cmd('lineweight', 'Lineweight', 'lineweight', 'LWEIGHT', SECONDARY),
        cmd('point-style', 'Point Style', 'point', 'DDPTYPE', ICON),
        cmd('setvar', 'Set Variable', 'options', 'SETVAR', ICON),
      ],
    },
    {
      id: 'customization',
      label: 'Customization',
      compress: { order: 2, keep: [] },
      items: [
        act('aliases', 'Edit Aliases', 'textbox_more', 'app:aliases', LABELLED),
        act('shortcuts', 'Keyboard Shortcuts', 'keyboard', 'app:shortcuts', LABELLED),
      ],
    },
    {
      // UI_SPEC §2's Tools > About (M9-07): AutoCAD keeps About in its InfoCenter's Help menu,
      // which Triya has not; an app action, so it opens with no drawing open too.
      id: 'help',
      label: 'Help',
      compress: { order: 1, keep: [] },
      items: [act('about', 'About', 'info', 'app:about', BIG)],
    },
  ],
};

export const RIBBON_TABS: readonly RibbonTab[] = [
  HOME,
  INSERT,
  ANNOTATE,
  PARAMETRIC,
  VIEW,
  OUTPUT,
  LAYOUT,
  TOOLS,
];

/**
 * When a contextual tab shows (UI_SPEC §2; AutoCAD 2024 Help, "Contextual Ribbon Tabs"): while
 * one of `commands` runs, while everything selected is one `selection` kind, or while the Block
 * Editor is open.
 */
export type RibbonWhen =
  | { readonly commands: readonly string[] }
  | { readonly selection: RibbonSelection }
  | { readonly blockEditor: true }
  | { readonly textEditor: true };

export interface ContextualTab extends RibbonTab {
  readonly when: RibbonWhen;
}

/** What the contextual tabs follow: the command running, the selection's kind, the editor. */
export interface RibbonContext {
  readonly command?: string | undefined;
  readonly selection?: RibbonSelection | undefined;
  readonly blockEditor?: boolean | undefined;
  /** MTEXT's in-place editor is open (part 5). */
  readonly textEditor?: boolean | undefined;
}

/** The last panel of every contextual tab: AutoCAD's Close button, which never compresses. */
const close = (id: string, label: string, run: RibbonRun): RibbonPanel => ({
  id: 'close',
  label: 'Close',
  items: [{ id, label, icon: 'dismiss_circle', sizes: BIG, run }],
});

/** The Close panel of a selection's tab: Esc, which deselects it. */
const closeSelection = (id: string, label: string) => close(id, label, { action: 'escape' });

const HATCH_CREATION: ContextualTab = {
  id: 'hatch-creation',
  label: 'Hatch Creation',
  when: { commands: ['HATCH', 'GRADIENT'] },
  panels: [
    {
      id: 'boundaries',
      label: 'Boundaries',
      compress: { order: 1, keep: ['pick-points'] },
      items: [
        key('pick-points', 'Pick Points', 'cursor_click', 'K', BIG),
        key('select-boundaries', 'Select', 'select_object', 'S'),
        key('remove-boundaries', 'Remove', 'eraser', 'B'),
        key('undo-boundary', 'Undo', 'arrow_undo', 'U'),
      ],
    },
    {
      id: 'options',
      label: 'Options',
      compress: { order: 2, keep: ['hatch-settings'] },
      items: [key('hatch-settings', 'Hatch Settings', 'settings', 'T', BIG)],
    },
    close('close-hatch-creation', 'Close Hatch Creation', { keyword: '' }),
  ],
};

const HATCH_EDITOR: ContextualTab = {
  id: 'hatch-editor',
  label: 'Hatch Editor',
  when: { selection: 'hatch' },
  panels: [
    {
      id: 'boundaries',
      label: 'Boundaries',
      compress: { order: 1, keep: ['add-boundaries'] },
      items: [
        cmd('add-boundaries', 'Add Boundaries', 'hatch', '-HATCHEDIT', BIG, ['AD']),
        cmd('remove-hatch-boundaries', 'Remove', 'eraser', '-HATCHEDIT', LABELLED, ['R']),
        cmd('recreate-boundary', 'Recreate', 'border_outside', '-HATCHEDIT', LABELLED, ['B']),
      ],
    },
    {
      id: 'properties',
      label: 'Properties',
      compress: { order: 2, keep: ['edit-hatch'] },
      items: [
        cmd('edit-hatch', 'Hatch Edit', 'pen', 'HATCHEDIT', BIG),
        cmd('match-hatch', 'Match Properties', 'paint_brush', 'MATCHPROP', LABELLED),
      ],
    },
    {
      id: 'origin',
      label: 'Origin',
      compress: { order: 3, keep: ['set-origin'] },
      items: [cmd('set-origin', 'Set Origin', 'location', '-HATCHEDIT', BIG, ['O'])],
    },
    {
      id: 'options',
      label: 'Options',
      compress: { order: 4, keep: [] },
      items: [
        cmd('separate-hatches', 'Separate Hatches', 'board_split', '-HATCHEDIT', LABELLED, ['H']),
        cmd('hatch-front', 'Bring to Front', 'position_to_front', 'DRAWORDER', LABELLED, ['F']),
        cmd('hatch-back', 'Send to Back', 'position_to_back', 'DRAWORDER', LABELLED, ['B']),
      ],
    },
    closeSelection('close-hatch-editor', 'Close Hatch Editor'),
  ],
};

/** Image's and PDF Underlay's draw order buttons, as AutoCAD's Options panels hold them. */
const drawOrder = (order: number): RibbonPanel => ({
  id: 'draw-order',
  label: 'Options',
  compress: { order, keep: [] },
  items: [
    cmd('bring-front', 'Bring to Front', 'position_to_front', 'DRAWORDER', LABELLED, ['F']),
    cmd('send-back', 'Send to Back', 'position_to_back', 'DRAWORDER', LABELLED, ['B']),
  ],
});

const IMAGE: ContextualTab = {
  id: 'image',
  label: 'Image',
  when: { selection: 'image' },
  panels: [
    {
      id: 'adjust',
      label: 'Adjust',
      compress: { order: 2, keep: ['image-adjust'] },
      items: [cmd('image-adjust', 'Adjust', 'image_edit', 'IMAGEADJUST', BIG)],
    },
    {
      id: 'clipping',
      label: 'Clipping',
      compress: { order: 3, keep: ['image-clip'] },
      items: [cmd('image-clip', 'Create Clipping Boundary', 'crop', 'IMAGECLIP', BIG)],
    },
    drawOrder(1),
    closeSelection('close-image', 'Close Image'),
  ],
};

const PDF_UNDERLAY: ContextualTab = {
  id: 'pdf-underlay',
  label: 'PDF Underlay',
  when: { selection: 'pdf' },
  panels: [
    {
      id: 'adjust',
      label: 'Adjust',
      compress: { order: 3, keep: ['pdf-adjust'] },
      items: [cmd('pdf-adjust', 'Adjust', 'document_edit', 'PDFADJUST', BIG)],
    },
    {
      id: 'clipping',
      label: 'Clipping',
      compress: { order: 4, keep: ['pdf-clip'] },
      items: [cmd('pdf-clip', 'Create Clipping Boundary', 'crop', 'PDFCLIP', BIG)],
    },
    {
      id: 'layers',
      label: 'PDF Layers',
      compress: { order: 2, keep: ['pdf-layers'] },
      items: [cmd('pdf-layers', 'Edit Layers', 'layer_diagonal', 'ULAYERS', BIG)],
    },
    {
      id: 'options',
      label: 'Options',
      compress: { order: 1, keep: [] },
      items: [
        split('pdf-snap', 'Snap to Underlays', 'target', LABELLED, [
          toggle('pdf-snap-on', 'Snap to Underlays ON', 'target', 'drafting:underlaySnap', true),
          toggle('pdf-snap-off', 'Snap to Underlays OFF', 'target', 'drafting:underlaySnap', false),
        ]),
        cmd('pdf-front', 'Bring to Front', 'position_to_front', 'DRAWORDER', LABELLED, ['F']),
        cmd('pdf-back', 'Send to Back', 'position_to_back', 'DRAWORDER', LABELLED, ['B']),
      ],
    },
    closeSelection('close-pdf-underlay', 'Close PDF Underlay'),
  ],
};

const EXTERNAL_REFERENCE: ContextualTab = {
  id: 'external-reference',
  label: 'External Reference',
  when: { selection: 'xref' },
  panels: [
    {
      id: 'edit',
      label: 'Edit',
      compress: { order: 2, keep: ['edit-reference'] },
      items: [cmd('edit-reference', 'Edit Reference In-Place', 'pen', 'REFEDIT', BIG)],
    },
    {
      id: 'clipping',
      label: 'Clipping',
      compress: { order: 3, keep: ['xref-clip'] },
      items: [cmd('xref-clip', 'Create Clipping Boundary', 'crop', 'XCLIP', BIG)],
    },
    {
      id: 'options',
      label: 'Options',
      compress: { order: 1, keep: [] },
      items: [cmd('xref-manager', 'External References', 'link_multiple', 'EXTERNALREFERENCES')],
    },
    closeSelection('close-external-reference', 'Close External Reference'),
  ],
};

const ARRAY: ContextualTab = {
  id: 'array',
  label: 'Array',
  when: { selection: 'array' },
  panels: [
    {
      id: 'options',
      label: 'Options',
      compress: { order: 1, keep: ['edit-source'] },
      items: [
        cmd('edit-source', 'Edit Source', 'pen', 'ARRAYEDIT', BIG, ['S']),
        cmd('replace-item', 'Replace Item', 'arrow_swap', 'ARRAYEDIT', LABELLED, ['REP']),
        cmd('reset-array', 'Reset Array', 'arrow_reset', 'ARRAYEDIT', LABELLED, ['RES']),
        cmd('explode-array', 'Explode', 'explode', 'EXPLODE', LABELLED),
      ],
    },
    closeSelection('close-array', 'Close Array'),
  ],
};

/** Array Creation's Properties panel: ASsociative and Base point, every ARRAY type's. */
const arrayProperties = (order: number): RibbonPanel => ({
  id: 'properties',
  label: 'Properties',
  compress: { order, keep: [] },
  items: [
    key('array-associative', 'Associative', 'link', 'AS'),
    key('array-base-point', 'Base Point', 'location', 'B'),
  ],
});

const closeArray = close('close-array-creation', 'Close Array', { keyword: 'X' });

const ARRAY_CREATION_RECT: ContextualTab = {
  id: 'array-creation-rect',
  label: 'Array Creation',
  when: { commands: ['ARRAYRECT'] },
  panels: [
    {
      id: 'columns',
      label: 'Columns',
      compress: { order: 2, keep: ['array-columns'] },
      items: [
        key('array-columns', 'Columns', 'align_space_evenly_horizontal', 'COL', BIG),
        key('array-count', 'Count', 'number_symbol', 'COU'),
        key('array-spacing', 'Spacing', 'ruler', 'S'),
      ],
    },
    {
      id: 'rows',
      label: 'Rows',
      compress: { order: 3, keep: ['array-rows'] },
      items: [key('array-rows', 'Rows', 'align_space_evenly_vertical', 'R', BIG)],
    },
    arrayProperties(1),
    closeArray,
  ],
};

const ARRAY_CREATION_POLAR: ContextualTab = {
  id: 'array-creation-polar',
  label: 'Array Creation',
  when: { commands: ['ARRAYPOLAR'] },
  panels: [
    {
      id: 'items',
      label: 'Items',
      compress: { order: 2, keep: ['array-items'] },
      items: [
        key('array-items', 'Items', 'number_symbol', 'I', BIG),
        key('array-angle-between', 'Between', 'arrow_rotate_counterclockwise', 'A'),
        key('array-fill-angle', 'Fill', 'array-polar', 'F'),
      ],
    },
    {
      id: 'rows',
      label: 'Rows',
      compress: { order: 3, keep: ['array-rows'] },
      items: [key('array-rows', 'Rows', 'align_space_evenly_vertical', 'ROW', BIG)],
    },
    {
      ...arrayProperties(1),
      items: [
        ...arrayProperties(1).items,
        key('array-rotate-items', 'Rotate Items', 'arrow_rotate_clockwise', 'ROT'),
      ],
    },
    closeArray,
  ],
};

const ARRAY_CREATION_PATH: ContextualTab = {
  id: 'array-creation-path',
  label: 'Array Creation',
  when: { commands: ['ARRAYPATH'] },
  panels: [
    {
      id: 'items',
      label: 'Items',
      compress: { order: 2, keep: ['array-items'] },
      items: [
        key('array-items', 'Items', 'number_symbol', 'I', BIG),
        key('array-method', 'Measure / Divide', 'ruler', 'M'),
      ],
    },
    {
      id: 'rows',
      label: 'Rows',
      compress: { order: 3, keep: ['array-rows'] },
      items: [key('array-rows', 'Rows', 'align_space_evenly_vertical', 'R', BIG)],
    },
    {
      ...arrayProperties(1),
      items: [
        ...arrayProperties(1).items,
        key('array-tangent', 'Tangent Direction', 'arrow_routing', 'T'),
        key('array-align-items', 'Align Items', 'align_space_evenly_horizontal', 'A'),
      ],
    },
    closeArray,
  ],
};

/**
 * Table Cell: TABLECELL (M4-05 part 3) is the cells selected, its prompt's options the tab's
 * actions, each typed as its whole keyword. Esc ends it, deselecting the cells.
 */
const TABLE_CELL: ContextualTab = {
  id: 'table-cell',
  label: 'Table Cell',
  when: { commands: ['TABLECELL'] },
  panels: [
    {
      id: 'rows',
      label: 'Rows',
      compress: { order: 5, keep: ['insert-above', 'insert-below'] },
      items: [
        key('insert-above', 'Insert Above', 'table_move_above', 'Above', BIG),
        key('insert-below', 'Insert Below', 'table_move_below', 'Below', BIG),
        key('delete-rows', 'Delete Row(s)', 'table_delete_row', 'DeleteRows', BIG),
      ],
    },
    {
      id: 'columns',
      label: 'Columns',
      compress: { order: 4, keep: ['insert-left', 'insert-right'] },
      items: [
        key('insert-left', 'Insert Left', 'table_move_left', 'Left', BIG),
        key('insert-right', 'Insert Right', 'table_move_right', 'Right', BIG),
        key('delete-columns', 'Delete Column(s)', 'table_delete_column', 'DeleteColumns', BIG),
      ],
    },
    {
      id: 'merge',
      label: 'Merge',
      compress: { order: 3, keep: ['merge-cells'] },
      items: [
        split('merge-cells', 'Merge Cells', 'table_cells_merge', BIG, [
          key('merge-all', 'Merge All', 'table_cells_merge', 'MergeAll'),
          key('merge-rows', 'Merge By Row', 'table_cells_merge', 'MergeRows'),
          key('merge-columns', 'Merge By Column', 'table_cells_merge', 'MergeColumns'),
        ]),
        key('unmerge-cells', 'Unmerge Cells', 'table_cells_split', 'Unmerge', BIG),
      ],
    },
    {
      id: 'cell-styles',
      label: 'Cell Styles',
      compress: { order: 2, keep: [] },
      items: [
        key('match-cell', 'Match Cell', 'paint_brush', 'Match'),
        key('cell-style', 'Cell Style', 'style_guide', 'CellStyle'),
        key('cell-background', 'Background Fill', 'paint_bucket', 'BAckground'),
        key('cell-borders', 'Cell Borders', 'border_all', 'BOrders'),
        key('cell-alignment', 'Alignment', 'text_align_center', 'ALignment'),
        key('remove-overrides', 'Remove All Property Overrides', 'broom', 'RemoveOverrides'),
      ],
    },
    {
      id: 'cell-format',
      label: 'Cell Format',
      compress: { order: 1, keep: [] },
      items: [
        key('cell-locking', 'Cell Locking', 'table_lock', 'LOcking'),
        key('data-format', 'Data Format', 'table_settings', 'DataFormat'),
        key('row-height', 'Row Height', 'align_space_evenly_vertical', 'Height'),
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      compress: { order: 6, keep: ['cell-block'] },
      items: [
        key('cell-block', 'Block', 'cube_arrow_curve_down', 'BLock', BIG),
        key('cell-text', 'Edit Text', 'table_cell_edit', 'Text', LABELLED),
      ],
    },
    close('close-table-cell', 'Close Table Cell', { action: 'escape' }),
  ],
};

const BLOCK_EDITOR: ContextualTab = {
  id: 'block-editor',
  label: 'Block Editor',
  when: { blockEditor: true },
  panels: [
    {
      id: 'open-save',
      label: 'Open/Save',
      compress: { order: 2, keep: ['save-block'] },
      items: [
        cmd('edit-block', 'Edit Block', 'cube_tree', 'BEDIT', BIG),
        cmd('save-block', 'Save Block', 'save', 'BSAVE', BIG),
      ],
    },
    {
      id: 'attributes',
      label: 'Attributes',
      compress: { order: 1, keep: ['attribute-definition'] },
      items: [
        cmd('attribute-definition', 'Attribute Definition', 'tag_add', 'ATTDEF', BIG),
        cmd('block-attribute-manager', 'Manage Attributes', 'tag_multiple', 'BATTMAN', LABELLED),
      ],
    },
    close('close-block-editor', 'Close Block Editor', { command: 'BCLOSE' }),
  ],
};

/** A button of the Text Editor tab: one of the in-place editor's actions. */
const textTool = (
  id: string,
  label: string,
  icon: IconName,
  action: string,
  sizes: ItemSizes = ICON,
): RibbonItem => ({ id, label, icon, sizes, run: { action: `text:${action}` } });

/**
 * AutoCAD's Text Editor tab, while MTEXT's in-place editor is open: the editor's Text Formatting
 * toolbar on the ribbon (its font, height and colour fields stay on the toolbar).
 */
const TEXT_EDITOR: ContextualTab = {
  id: 'text-editor',
  label: 'Text Editor',
  when: { textEditor: true },
  panels: [
    {
      id: 'formatting',
      label: 'Formatting',
      compress: { order: 4, keep: ['text-bold', 'text-italic', 'text-underline'] },
      items: [
        textTool('text-bold', 'Bold', 'text_bold', 'bold', SECONDARY),
        textTool('text-italic', 'Italic', 'text_italic', 'italic', SECONDARY),
        textTool('text-underline', 'Underline', 'text_underline', 'underline', SECONDARY),
        textTool('text-overline', 'Overline', 'text-overline', 'overline'),
        textTool('text-strike', 'Strikethrough', 'text_strikethrough', 'strike'),
        textTool('text-stack', 'Stack', 'text-stack', 'stack'),
      ],
    },
    {
      id: 'paragraph',
      label: 'Paragraph',
      compress: { order: 3, keep: ['text-paragraph'] },
      items: [textTool('text-paragraph', 'Paragraph', 'text_paragraph', 'paragraph', BIG)],
    },
    {
      id: 'insert',
      label: 'Insert',
      compress: { order: 2, keep: ['text-columns'] },
      items: [
        textTool('text-columns', 'Columns', 'text_column_two', 'columns', BIG),
        textTool('text-field', 'Field', 'text_field', 'field', BIG),
      ],
    },
    {
      id: 'spell-check',
      label: 'Spell Check',
      compress: { order: 1, keep: ['text-spell'] },
      items: [textTool('text-spell', 'Spell Check', 'text_grammar_checkmark', 'spell', LABELLED)],
    },
    close('close-text-editor', 'Close Text Editor', { action: 'text:close' }),
  ],
};

/**
 * The contextual tabs, in the order their rules are tried: the Text Editor's first (it is the
 * toolbar of the text being typed, whatever command runs), then a command's (a command's tab
 * shows over the selection's), then the Block Editor's, then a selection's.
 */
export const CONTEXTUAL_TABS: readonly ContextualTab[] = [
  TEXT_EDITOR,
  HATCH_CREATION,
  ARRAY_CREATION_RECT,
  ARRAY_CREATION_POLAR,
  ARRAY_CREATION_PATH,
  TABLE_CELL,
  BLOCK_EDITOR,
  HATCH_EDITOR,
  IMAGE,
  PDF_UNDERLAY,
  EXTERNAL_REFERENCE,
  ARRAY,
];

/** The contextual tab `context` shows, if any. */
export function contextualTabOf(context: RibbonContext): ContextualTab | undefined {
  return CONTEXTUAL_TABS.find((t) =>
    'commands' in t.when
      ? context.command !== undefined && t.when.commands.includes(context.command)
      : 'blockEditor' in t.when
        ? context.blockEditor === true
        : 'textEditor' in t.when
          ? context.textEditor === true
          : context.selection === t.when.selection,
  );
}
