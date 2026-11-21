// The ribbon's content (M7-01, UI_SPEC.md §2–§3, DEC-017): tabs → panels → items, with AutoCAD's
// tab, panel and item names so a drafter's spatial memory transfers. The layout (layout.ts)
// reads only this data: each item's explicit size at each breakpoint, `protected` on the Home
// Draw/Modify/Annotation items (never overflow), and each other panel's compression rule.
//
// Items run a registered command, as typed at the command line (`invoke`, then `keys` typed at
// its first prompts, as AutoCAD's ribbon macros do: `^C^C_circle _2p`), or a drafting toggle.
// Glyphs are text stand-ins until M7-02 brings the Fluent and custom CAD icons. M7-02 also adds
// the remaining tabs, the panels' dropdowns (layer, colour, linetype, lineweight) and tooltips.

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
  /** Up to three characters standing in for the icon (M7-02 replaces them). */
  readonly glyph: string;
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
  glyph: string,
  command: string,
  sizes: ItemSizes = LABELLED,
  keys?: readonly string[],
): RibbonItem {
  return { id, label, glyph, sizes, run: keys ? { command, keys } : { command } };
}

/** A split button; its entries take its sizes. */
function split(
  id: string,
  label: string,
  glyph: string,
  sizes: ItemSizes,
  entries: readonly RibbonItem[],
): RibbonItem {
  return {
    id,
    label,
    glyph,
    sizes,
    run: entries[0]!.run,
    menu: entries.map((e) => ({ ...e, sizes })),
  };
}

function toggle(
  id: string,
  label: string,
  glyph: string,
  action: string,
  on?: boolean,
): RibbonItem {
  return { id, label, glyph, sizes: ICON, run: on === undefined ? { action } : { action, on } };
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
        cmd('line', 'Line', 'L', 'LINE', BIG),
        cmd('polyline', 'Polyline', 'PL', 'PLINE', BIG),
        split('circle', 'Circle', 'C', BIG, [
          cmd('circle-cr', 'Center, Radius', 'C', 'CIRCLE'),
          cmd('circle-2p', '2-Point', '2P', 'CIRCLE', LABELLED, ['2P']),
          cmd('circle-3p', '3-Point', '3P', 'CIRCLE', LABELLED, ['3P']),
          cmd('circle-ttr', 'Tan, Tan, Radius', 'TTR', 'CIRCLE', LABELLED, ['T']),
        ]),
        split('arc', 'Arc', 'A', BIG, [
          cmd('arc-3p', '3-Point', 'A', 'ARC'),
          cmd('arc-cse', 'Center, Start, End', 'CSE', 'ARC', LABELLED, ['C']),
        ]),
        split('rectangle', 'Rectangle', 'REC', LABELLED, [
          cmd('rectang', 'Rectangle', 'REC', 'RECTANG'),
          cmd('polygon', 'Polygon', 'POL', 'POLYGON'),
        ]),
        split('ellipse', 'Ellipse', 'EL', LABELLED, [
          cmd('ellipse-center', 'Center', 'EL', 'ELLIPSE', LABELLED, ['C']),
          cmd('ellipse-axis', 'Axis, End', 'EL', 'ELLIPSE'),
          cmd('ellipse-arc', 'Elliptical Arc', 'EA', 'ELLIPSE', LABELLED, ['A']),
        ]),
        split('hatch', 'Hatch', 'H', LABELLED, [
          cmd('hatch-hatch', 'Hatch', 'H', 'HATCH'),
          cmd('gradient', 'Gradient', 'GD', 'GRADIENT'),
        ]),
        split('spline', 'Spline', 'SPL', LABELLED, [
          cmd('spline-fit', 'Spline Fit', 'SPL', 'SPLINE', LABELLED, ['M', 'F']),
          cmd('spline-cv', 'Spline CV', 'CV', 'SPLINE', LABELLED, ['M', 'CV']),
        ]),
        split('xline', 'Construction Line', 'XL', ICON, [
          cmd('xline-xline', 'Construction Line', 'XL', 'XLINE'),
          cmd('ray', 'Ray', 'RAY', 'RAY'),
        ]),
        split('point', 'Point', 'PO', ICON, [
          cmd('point-multiple', 'Multiple Points', 'PO', 'POINT'),
          cmd('divide', 'Divide', 'DIV', 'DIVIDE'),
          cmd('measure', 'Measure', 'ME', 'MEASURE'),
        ]),
        split('revcloud', 'Revision Cloud', 'RC', ICON, [
          cmd('revcloud-rect', 'Rectangular', 'RC', 'REVCLOUD', LABELLED, ['R']),
          cmd('revcloud-poly', 'Polygonal', 'RCP', 'REVCLOUD', LABELLED, ['P']),
          cmd('revcloud-free', 'Freehand', 'RCF', 'REVCLOUD', LABELLED, ['F']),
          cmd('revcloud-object', 'Object', 'RCO', 'REVCLOUD', LABELLED, ['O']),
        ]),
        cmd('wipeout', 'Wipeout', 'WO', 'WIPEOUT', ICON),
      ]),
    },
    {
      id: 'modify',
      label: 'Modify',
      items: protect([
        cmd('move', 'Move', 'M', 'MOVE'),
        cmd('copy', 'Copy', 'CO', 'COPY'),
        cmd('stretch', 'Stretch', 'S', 'STRETCH'),
        cmd('rotate', 'Rotate', 'RO', 'ROTATE'),
        cmd('mirror', 'Mirror', 'MI', 'MIRROR'),
        cmd('scale', 'Scale', 'SC', 'SCALE'),
        split('trim', 'Trim', 'TR', LABELLED, [
          cmd('trim-trim', 'Trim', 'TR', 'TRIM'),
          cmd('trim-extend', 'Extend', 'EX', 'EXTEND'),
        ]),
        cmd('extend', 'Extend', 'EX', 'EXTEND', ICON),
        split('fillet', 'Fillet', 'F', LABELLED, [
          cmd('fillet-fillet', 'Fillet', 'F', 'FILLET'),
          cmd('fillet-chamfer', 'Chamfer', 'CHA', 'CHAMFER'),
        ]),
        cmd('chamfer', 'Chamfer', 'CHA', 'CHAMFER', ICON),
        split('array', 'Array', 'AR', LABELLED, [
          cmd('array-rect', 'Rectangular Array', 'AR', 'ARRAYRECT'),
          cmd('array-polar', 'Polar Array', 'ARP', 'ARRAYPOLAR'),
          cmd('array-path', 'Path Array', 'ARA', 'ARRAYPATH'),
        ]),
        cmd('offset', 'Offset', 'O', 'OFFSET', ICON),
        cmd('explode', 'Explode', 'X', 'EXPLODE', ICON),
        cmd('erase', 'Erase', 'E', 'ERASE', ICON),
        split('break', 'Break', 'BR', ICON, [
          cmd('break-break', 'Break', 'BR', 'BREAK'),
          cmd('break-at-point', 'Break at Point', 'BRP', 'BREAKATPOINT'),
        ]),
        cmd('join', 'Join', 'J', 'JOIN', ICON),
        cmd('lengthen', 'Lengthen', 'LEN', 'LENGTHEN', ICON),
        cmd('align', 'Align', 'AL', 'ALIGN', ICON),
        cmd('overkill', 'Overkill', 'OV', 'OVERKILL', ICON),
      ]),
    },
    {
      id: 'annotation',
      label: 'Annotation',
      items: protect([
        split('text', 'Text', 'T', BIG, [
          cmd('mtext', 'Multiline Text', 'T', 'MTEXT'),
          cmd('dtext', 'Single Line', 'DT', 'TEXT'),
        ]),
        split('dimension', 'Dimension', 'DIM', BIG, [
          cmd('dim-linear', 'Linear', 'DLI', 'DIMLINEAR'),
          cmd('dim-aligned', 'Aligned', 'DAL', 'DIMALIGNED'),
          cmd('dim-angular', 'Angular', 'DAN', 'DIMANGULAR'),
          cmd('dim-arc', 'Arc Length', 'DAR', 'DIMARC'),
          cmd('dim-radius', 'Radius', 'DRA', 'DIMRADIUS'),
          cmd('dim-diameter', 'Diameter', 'DDI', 'DIMDIAMETER'),
          cmd('dim-jogged', 'Jogged', 'DJO', 'DIMJOGGED'),
          cmd('dim-ordinate', 'Ordinate', 'DOR', 'DIMORDINATE'),
        ]),
        split('leader', 'Leader', 'MLD', LABELLED, [
          cmd('mleader', 'Multileader', 'MLD', 'MLEADER'),
          cmd('mleader-add', 'Add Leader', 'LA+', 'AIMLEADEREDITADD'),
          cmd('mleader-remove', 'Remove Leader', 'LA-', 'AIMLEADEREDITREMOVE'),
        ]),
        cmd('table', 'Table', 'TB', 'TABLE'),
        split('centerline', 'Centerline', 'CL', LABELLED, [
          cmd('centerline-line', 'Centerline', 'CL', 'CENTERLINE'),
          cmd('centermark', 'Center Mark', 'CM', 'CENTERMARK'),
        ]),
      ]),
    },
    {
      id: 'layers',
      label: 'Layers',
      compress: { order: 6, keep: ['layer-properties'] },
      items: [
        cmd('layer-properties', 'Layer Properties', 'LA', 'LAYER', BIG),
        cmd('layer-off', 'Off', 'OFF', 'LAYOFF', ICON),
        cmd('layer-isolate', 'Isolate', 'ISO', 'LAYISO', ICON),
        cmd('layer-unisolate', 'Unisolate', 'UNI', 'LAYUNISO', ICON),
        cmd('layer-freeze', 'Freeze', 'FRZ', 'LAYFRZ', ICON),
        cmd('layer-lock', 'Lock', 'LCK', 'LAYLCK', ICON),
        cmd('layer-unlock', 'Unlock', 'ULK', 'LAYULK', ICON),
        cmd('layer-on', 'Turn All Layers On', 'ON', 'LAYON', ICON),
        cmd('layer-thaw', 'Thaw All Layers', 'THW', 'LAYTHW', ICON),
        cmd('layer-make-current', 'Make Current', 'MCR', 'LAYMCUR', ICON),
        cmd('layer-match', 'Match Layer', 'MCH', 'LAYMCH', ICON),
        cmd('layer-previous', 'Previous', 'LP', 'LAYERP', ICON),
      ],
    },
    {
      id: 'block',
      label: 'Block',
      compress: { order: 5, keep: ['insert'] },
      items: [
        cmd('insert', 'Insert', 'I', 'INSERT', BIG),
        cmd('create', 'Create', 'B', 'BLOCK', SECONDARY),
        cmd('edit', 'Edit', 'BE', 'BEDIT', SECONDARY),
        split('edit-attributes', 'Edit Attributes', 'EAT', SECONDARY, [
          cmd('eattedit', 'Single', 'EAT', 'EATTEDIT'),
          cmd('battman', 'Block Attribute Manager', 'BAT', 'BATTMAN'),
        ]),
      ],
    },
    {
      id: 'properties',
      label: 'Properties',
      compress: { order: 4, keep: ['match-properties'] },
      items: [
        cmd('match-properties', 'Match Properties', 'MA', 'MATCHPROP', BIG),
        cmd('properties', 'Properties', 'PR', 'PROPERTIES', SECONDARY),
      ],
    },
    {
      id: 'groups',
      label: 'Groups',
      compress: { order: 3, keep: [] },
      items: [
        cmd('group', 'Group', 'G', 'GROUP', BIG),
        cmd('ungroup', 'Ungroup', 'UG', 'UNGROUP', ICON),
        cmd('group-edit', 'Group Edit', 'GE', 'GROUPEDIT', ICON),
        cmd('group-manager', 'Group Manager', 'GM', 'CLASSICGROUP', ICON),
        toggle('group-selection', 'Group Selection On/Off', 'GS', 'drafting:groups'),
        toggle('group-box', 'Group Bounding Box On/Off', 'GB', 'drafting:groupBox'),
      ],
    },
    {
      id: 'utilities',
      label: 'Utilities',
      compress: { order: 2, keep: [] },
      items: [
        split('measure-tools', 'Measure', 'MEA', BIG, [
          cmd('measure-geom', 'Measure', 'MEA', 'MEASUREGEOM'),
          cmd('dist', 'Distance', 'DI', 'DIST'),
          cmd('area', 'Area', 'AA', 'AREA'),
        ]),
        cmd('quick-select', 'Quick Select', 'QS', 'QSELECT', SECONDARY),
        cmd('id-point', 'ID Point', 'ID', 'ID', SECONDARY),
        cmd('list', 'List', 'LI', 'LIST', SECONDARY),
      ],
    },
    {
      id: 'clipboard',
      label: 'Clipboard',
      compress: { order: 1, keep: [] },
      items: [
        split('paste', 'Paste', 'V', BIG, [
          cmd('pasteclip', 'Paste', 'V', 'PASTECLIP'),
          cmd('pasteblock', 'Paste as Block', 'VB', 'PASTEBLOCK'),
          cmd('pasteorig', 'Paste to Original Coordinates', 'VO', 'PASTEORIG'),
        ]),
        cmd('cut', 'Cut', 'X', 'CUTCLIP', ICON),
        cmd('copy-clip', 'Copy Clip', 'C', 'COPYCLIP', ICON),
        cmd('copy-base', 'Copy with Base Point', 'CB', 'COPYBASE', ICON),
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
        cmd('insert', 'Insert', 'I', 'INSERT', BIG),
        cmd('create', 'Create Block', 'B', 'BLOCK', SECONDARY),
        cmd('define-attributes', 'Define Attributes', 'ATT', 'ATTDEF', SECONDARY),
        cmd('manage-attributes', 'Manage Attributes', 'BAT', 'BATTMAN', SECONDARY),
        cmd('block-editor', 'Block Editor', 'BE', 'BEDIT', SECONDARY),
        cmd('edit-attribute', 'Edit Attribute', 'EAT', 'EATTEDIT', SECONDARY),
      ],
    },
    {
      id: 'reference',
      label: 'Reference',
      items: [
        split('attach', 'Attach', 'XA', BIG, [
          cmd('xattach', 'Attach DWG', 'XA', 'XATTACH'),
          cmd('imageattach', 'Attach Image', 'IAT', 'IMAGEATTACH'),
          cmd('pdfattach', 'Attach PDF', 'PDF', 'PDFATTACH'),
        ]),
        cmd('clip', 'Clip', 'XC', 'XCLIP', SECONDARY),
        split('adjust', 'Adjust', 'ADJ', SECONDARY, [
          cmd('imageadjust', 'Adjust Image', 'IAD', 'IMAGEADJUST'),
          cmd('pdfadjust', 'Adjust PDF Underlay', 'PAD', 'PDFADJUST'),
        ]),
        cmd('xref-palette', 'External References', 'XR', 'EXTERNALREFERENCES', SECONDARY),
        cmd('bind', 'Bind', 'XB', 'XBIND', SECONDARY),
        cmd('underlay-layers', 'Underlay Layers', 'UL', 'ULAYERS', SECONDARY),
        split('underlay-snap', 'Snap to Underlays', 'US', SECONDARY, [
          toggle('underlay-snap-on', 'Snap to Underlays ON', 'US', 'drafting:underlaySnap', true),
          toggle(
            'underlay-snap-off',
            'Snap to Underlays OFF',
            'US',
            'drafting:underlaySnap',
            false,
          ),
        ]),
      ],
    },
    {
      id: 'import',
      label: 'Import',
      items: [cmd('pdf-import', 'PDF Underlay', 'PDF', 'PDFATTACH', BIG)],
    },
    {
      id: 'data',
      label: 'Data',
      items: [cmd('field', 'Field', 'FLD', 'FIELD', BIG)],
    },
  ],
};

export const RIBBON_TABS: readonly RibbonTab[] = [HOME, INSERT];
