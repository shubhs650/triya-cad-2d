// The Layers palette (M1-23, UI_SPEC.md §4), docked right as AutoCAD's Layer Properties
// Manager: the layers by name with Status, On, Freeze, Lock, Plot, Color, Linetype,
// Lineweight and Description (M1-104) columns, and VP Freeze in a layout. On, Freeze and Lock
// toggle; each toggle is a document edit the drawing's engine applies (M1-67) and every canvas
// of the drawing redraws.
// The Layer Properties Manager (M5-05 part 1): rows are selected as AutoCAD's are (click,
// Ctrl+click, Shift+click, the arrow keys, Ctrl+A), and a toggle clicked in a selected row
// changes every selected layer; New Layer (Alt+N) adds LayerN with the properties of the layer
// selected and names it in place, Delete Layer (Alt+D, Delete) removes the layers AutoCAD lets
// go, Set Current (Alt+C, or a double-click on Status) makes a layer current; a double-click on
// a name (or F2) renames it and on a description edits it. Each is one LAYER undo step. Fully
// keyboard operable: every toggle is a button.
// M5-05 part 2: the Color, Linetype, Lineweight and Transparency cells are buttons opening
// AutoCAD's dialogs for them (Select Color without ByLayer and ByBlock, Select Linetype,
// Lineweight, Layer Transparency); OK sets the value on the row clicked, or on every selected
// layer when the row is one of them, as one LAYER undo step.
// M5-05 part 3: the columns are the user's (layer-columns.ts): a right-click on a header shows
// or hides them and opens Customize Layer Columns to order them; a click on a header sorts the
// layers by it, a second click reversing it. The search's time from typing to the rows filtered
// on screen is kept on the palette (acceptance: under 100 ms on 200 layers).
// M5-07 part 2: Layer States Manager (Alt+S) opens LAYERSTATE's dialog, and the palette names
// the layer state restored last while the layers are as it has them ("Unsaved Layer State"
// otherwise), as AutoCAD's manager does.
// M5-05 part 4: a right-click on a layer (Shift+F10 on a row) shows the layer list menu
// (LayerListMenu.tsx), whose Merge Selected Layer(s) to... opens Merge to Layer; the manager's
// changes one after another are one LAYER undo step while UNDO Control Layer is on (the engine).
// M5-05 part 5: the columns have widths (a fixed table layout, contents cut with an ellipsis),
// sized by dragging a header's edge or by the header menu's Maximize and Optimize items; a header
// dragged sideways moves its column; Freeze Column keeps the columns up to it from scrolling.
// Typing in the search re-creates only the rows it hides or shows (`rowElements`), so the
// filter stays far under 100 ms on 200 layers with React's development build too.
// M5-13: the rows are grid rows on the columns' widths (a table's rows can keep no layout while
// hidden), and a row the search hides keeps its layout, so clearing the search lays out no cell
// again; only the columns whose contents can overflow cut them (`cutLayerColumns`).
// M5-07 part 5: the filter tree (LayerFilterTree.tsx) beside the list: All, All Used Layers and
// the drawing's filters; the list shows the node selected (Invert filter: the other layers), the
// search within it, and the line under the list counts them. New Property Filter (Alt+P) opens
// Layer Filter Properties, New Group Filter (Alt+G) adds Group Filter1 named in place; layers
// dragged onto a group filter join it, and the layer list menu's Remove From Group Filter takes
// them out. Each is one LAYER undo step.
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  isLayerFilter,
  transparencyOf,
  type EditResult,
  type EngineEdit,
  type Handle,
  type LayerFilter,
  type LayerProps,
} from '@triya/engine';
import { controllerOf } from './canvas/registry';
import { inLayout as layoutShown, type DocumentStore, type OpenDocument } from './documents';
import { engines } from './engine/registry';
import {
  CustomizeLayerColumnsDialog,
  LayerColumnHeader,
  LayerColumnsMenu,
  type LayerColumnSizing,
} from './LayerColumns';
import {
  LayerListMenu,
  MergeToLayerDialog,
  mergeTargets,
  type LayerListAction,
} from './LayerListMenu';
import { LayerTransparencyDialog, LineweightDialog, SelectLinetypeDialog } from './LayerDialogs';
import type { LinetypeFiles } from './linetype-files';
import {
  MIN_COLUMN_WIDTH,
  cutLayerColumns,
  frozenLayerColumns,
  layerColumnTracks,
  layerColumnWidth,
  maximizedWidths,
  moveLayerColumnBefore,
  sortAfterClick,
  sortLayerRows,
  visibleLayerColumns,
  withLayerColumnWidths,
  type LayerColumn,
  type LayerColumnKey,
  type LayerColumnSettings,
} from './layer-columns';
import { drafting } from './drafting';
import { LayerFilterDialog } from './LayerFilterDialog';
import {
  EMPTY_DEFINITION,
  drawingLayerFilters,
  filterCountLine,
  layerFilterSource,
  layerFilterTree,
  listedLayers,
  nextFilterName,
  type FilterChoice,
} from './layer-filters';
import {
  LAYER_DRAG_TYPE,
  LayerFilterMenu,
  LayerFilterTree,
  type LayerFilterAction,
} from './LayerFilterTree';
import { currentLayerStateName, layerStatesManager } from './layer-states';
import { layerColorBooks, layerLinetypes, layerRows, type LayerRow } from './layers';
import { SelectColorDialog } from './SelectColorDialog';

type Toggle = 'on' | 'frozen' | 'locked' | 'plot';

interface ToggleColumn {
  readonly key: Toggle;
  readonly title: string;
  readonly label: (r: LayerRow) => string;
}

const TOGGLES: Record<Toggle, ToggleColumn> = {
  on: { key: 'on', title: 'On', label: (r) => (r.on ? 'On' : 'Off') },
  frozen: { key: 'frozen', title: 'Freeze', label: (r) => (r.frozen ? 'Frozen' : 'Thawed') },
  locked: { key: 'locked', title: 'Lock', label: (r) => (r.locked ? 'Locked' : 'Unlocked') },
  plot: { key: 'plot', title: 'Plot', label: (r) => (r.plot ? 'Plot' : 'No plot') },
};

/** A property cell whose dialog is open, and the row clicked. */
type Picking = {
  readonly cell: 'color' | 'linetype' | 'lineweight' | 'transparency';
  readonly row: LayerRow;
};

/** A name or a description being typed in place. */
type Editing = { readonly handle: Handle; readonly field: 'name' | 'description' };

/** Layer Filter Properties, for a new property filter or the one `filter` names. */
type FilterDialog = {
  readonly filter?: Handle;
  readonly name: string;
  readonly expression: string;
  readonly parent?: Handle | undefined;
};

/** The rows `click` selects among `shown`, given what was selected and the anchor of a Shift range. */
function selectionAfter(
  shown: readonly LayerRow[],
  selected: ReadonlySet<Handle>,
  anchor: Handle | undefined,
  click: Handle,
  mode: 'only' | 'toggle' | 'range',
): Set<Handle> {
  if (mode === 'toggle') {
    const next = new Set(selected);
    if (next.has(click)) next.delete(click);
    else next.add(click);
    return next;
  }
  if (mode === 'range' && anchor !== undefined) {
    const a = shown.findIndex((r) => r.handle === anchor);
    const b = shown.findIndex((r) => r.handle === click);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      return new Set(shown.slice(lo, hi + 1).map((r) => r.handle));
    }
  }
  return new Set([click]);
}

/** What a row's cells do, read when they act, so that they see the palette as it is then. */
interface RowActions {
  rowClick(e: MouseEvent, row: LayerRow): void;
  rowKey(e: KeyboardEvent, row: LayerRow): void;
  toggle(row: LayerRow, key: Toggle): void;
  pick(cell: Picking['cell'], row: LayerRow): void;
  setCurrent(row: LayerRow): void;
  edit(e: Editing): void;
  commit(row: LayerRow, field: Editing['field'], value: string): void;
  cancelEdit(row: LayerRow): void;
  /** A row dragged: the layers it carries (onto a group filter, M5-07 part 5). */
  dragStart(e: DragEvent, row: LayerRow): void;
}

/** A name or a description typed in place: Enter or leaving the field keeps it, Esc does not. */
function InPlace({
  row,
  field,
  label,
  act,
}: {
  row: LayerRow;
  field: Editing['field'];
  label: string;
  act: RefObject<RowActions>;
}) {
  return (
    <input
      className="layer-in-place"
      aria-label={label}
      defaultValue={field === 'name' ? row.name : row.description}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') act.current.commit(row, field, e.currentTarget.value);
        else if (e.key === 'Escape') act.current.cancelEdit(row);
      }}
      onBlur={(e) => act.current.commit(row, field, e.currentTarget.value)}
    />
  );
}

/** Row `r`'s cell in column `key`. */
function cellOf(
  r: LayerRow,
  key: LayerColumnKey,
  editing: Editing['field'] | undefined,
  act: RefObject<RowActions>,
): ReactNode {
  const toggleCell = (t: ToggleColumn) => (
    <td data-col={key}>
      <button
        type="button"
        className={`toggle ${t.key}`}
        aria-pressed={r[t.key]}
        aria-label={`${t.title} ${r.name}`}
        title={t.label(r)}
        onClick={() => act.current.toggle(r, t.key)}
      >
        {t.label(r)}
      </button>
    </td>
  );
  const propertyCell = (cell: Picking['cell'], title: string, text: string) => (
    <td className={cell} data-col={key}>
      <button
        type="button"
        className="layer-cell"
        aria-label={`${title} ${r.name}`}
        aria-haspopup="dialog"
        title={text}
        onClick={() => act.current.pick(cell, r)}
      >
        {cell === 'color' && (
          <span className="swatch" style={{ background: r.color.css }} aria-hidden />
        )}
        {text}
      </button>
    </td>
  );
  switch (key) {
    case 'status':
      return (
        <td className="status" data-col={key} onDoubleClick={() => act.current.setCurrent(r)}>
          {r.current ? <span aria-label="Current layer">✓</span> : null}
        </td>
      );
    case 'name':
      return (
        <th
          scope="row"
          className="name"
          data-col={key}
          onDoubleClick={() => act.current.edit({ handle: r.handle, field: 'name' })}
        >
          {editing === 'name' ? (
            <InPlace row={r} field="name" label={`Name of ${r.name}`} act={act} />
          ) : (
            r.name
          )}
        </th>
      );
    case 'on':
    case 'frozen':
    case 'locked':
    case 'plot':
      return toggleCell(TOGGLES[key]);
    case 'vpFreeze':
      return (
        <td className="vp-freeze" data-col={key}>
          {r.vpFrozen && r.vpFrozen.of > 0 ? `${r.vpFrozen.frozen} of ${r.vpFrozen.of}` : '—'}
        </td>
      );
    case 'color':
      return propertyCell('color', 'Color', r.color.label);
    case 'linetype':
      return propertyCell('linetype', 'Linetype', r.linetype);
    case 'lineweight':
      return propertyCell('lineweight', 'Lineweight', r.lineweight);
    case 'transparency':
      return propertyCell('transparency', 'Transparency', r.transparency);
    case 'description':
      return (
        <td
          className="description"
          data-col={key}
          onDoubleClick={() => act.current.edit({ handle: r.handle, field: 'description' })}
        >
          {editing === 'description' ? (
            <InPlace row={r} field="description" label={`Description of ${r.name}`} act={act} />
          ) : (
            r.description
          )}
        </td>
      );
  }
}

interface RowProps {
  readonly row: LayerRow;
  readonly columns: readonly LayerColumn[];
  readonly selected: boolean;
  readonly tabbable: boolean;
  readonly editing: Editing['field'] | undefined;
  readonly act: RefObject<RowActions>;
}

/**
 * One layer's row. Memoised: it renders again only when its layer, its columns or its selected
 * or editing state changes. The search hides the rows it leaves out with one style rule on the
 * name each row carries (`searchCss`), so typing in it renders no row again (M5-05 part 5).
 */
const LayerRowView = memo(function LayerRowView({
  row,
  columns,
  selected,
  tabbable,
  editing,
  act,
}: RowProps) {
  return (
    <tr
      data-handle={row.handle}
      data-search={row.name.toLowerCase()}
      data-current={row.current}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      // A field typed in keeps its text selection: the row is not dragged while one is open.
      draggable={editing === undefined}
      onDragStart={(e) => act.current.dragStart(e, row)}
      onClick={(e) => act.current.rowClick(e, row)}
      onKeyDown={(e) => act.current.rowKey(e, row)}
    >
      <RowCells row={row} columns={columns} editing={editing} act={act} />
    </tr>
  );
});

/** A row's cells, apart from its row so that hiding or selecting a row leaves them be. */
const RowCells = memo(function RowCells({
  row,
  columns,
  editing,
  act,
}: {
  row: LayerRow;
  columns: readonly LayerColumn[];
  editing: Editing['field'] | undefined;
  act: RefObject<RowActions>;
}) {
  return columns.map((c) => <Fragment key={c.key}>{cellOf(row, c.key, editing, act)}</Fragment>);
});

/**
 * The search: the rows whose lower-case name does not contain `needle` are not shown, as
 * `shown` leaves them out. One rule, so that typing changes no row (M5-05 part 5).
 * M5-13: a row left out keeps its layout (content-visibility: hidden skips its cells without
 * dropping their boxes) and is hidden from view and from assistive technology. Showing it again
 * then lays out the row, not its cells: display: none made the browser build and lay out all 91
 * rows' cells again, 2,800 layout objects, as the search was cleared.
 */
const searchCss = (needle: string): string => {
  const out = `.layer-table tbody tr:not([data-search*="${CSS.escape(needle)}"])`;
  return (
    `@supports (content-visibility:hidden){${out}{content-visibility:hidden;visibility:hidden;border-bottom-width:0}}` +
    `@supports not (content-visibility:hidden){${out}{display:none}}`
  );
};

/** M5-13: the cells of the columns that may need it cut their contents at the column's edge. */
const cutColumnsCss = (keys: readonly LayerColumnKey[]): string =>
  keys.map((k) => `.layer-table tbody [data-col="${k}"]{overflow:hidden}`).join('\n');

/**
 * Freeze Column: the frozen columns stay at their offsets from the list's left edge while it
 * scrolls sideways, drawn over the cells scrolling under them (a header over both). The keys and
 * offsets come from the column settings, never from the drawing.
 */
function frozenColumnsCss(frozen: ReadonlyMap<LayerColumnKey, number>): string {
  const rules: string[] = [];
  const keys = [...frozen.keys()];
  for (const [k, left] of frozen) {
    rules.push(`.layer-table [data-col="${k}"]{position:sticky;left:${left}px;z-index:1}`);
    rules.push(`.layer-table thead [data-col="${k}"]{z-index:3}`);
    rules.push(`.layer-table tbody [data-col="${k}"]{background:var(--layer-frozen-bg)}`);
  }
  rules.push(
    `.layer-table [data-col="${keys.at(-1)}"]{box-shadow:inset -1px 0 var(--chrome-border)}`,
  );
  return rules.join('\n');
}

export function LayersPalette({
  doc,
  store,
  columns,
  onColumns,
  onClose,
  linetypeFiles,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  /** The user's columns and sort (kept with the preferences). */
  columns: LayerColumnSettings;
  onColumns: (s: LayerColumnSettings) => void;
  onClose: () => void;
  /** The linetype files Select Linetype's Load... reads (M5-08). */
  linetypeFiles?: LinetypeFiles | undefined;
}) {
  const [search, setSearch] = useState('');
  const [columnsMenu, setColumnsMenu] = useState<
    { x: number; y: number; column: LayerColumnKey } | undefined
  >();
  /** A column's width while its header's edge is dragged (saved when it is let go). */
  const [sizing, setSizing] = useState<{ key: LayerColumnKey; width: number } | undefined>();
  /** The rows' elements as last rendered, re-created only for a row whose props changed. */
  const rowElements = useRef(new Map<Handle, { props: RowProps; element: ReactElement }>());
  const [customizing, setCustomizing] = useState(false);
  const [listMenu, setListMenu] = useState<{ x: number; y: number } | undefined>();
  const [merging, setMerging] = useState<readonly LayerRow[] | undefined>();
  const paletteRef = useRef<HTMLElement>(null);
  /** When the search last changed, until its rows are on screen. */
  const searchedAt = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>();
  const [last, setLast] = useState<
    { click: number; frame: number; drawn: number | undefined } | undefined
  >();
  const inLayout = layoutShown(doc);
  // The Lineweight column in LWUNITS's units (M5-08).
  const lwUnits = useSyncExternalStore(drafting.subscribe, () =>
    drafting.get().lwUnits === 0 ? 'in' : 'mm',
  );
  const rows = useMemo(
    () =>
      layerRows(
        doc.opened.init,
        engines.changesOf(doc.id),
        inLayout ? doc.block : undefined,
        lwUnits,
      ),
    // `revision` changes when the engine applied an edit, which is what the rows read.
    [doc.opened, doc.id, doc.block, doc.revision, inLayout, lwUnits],
  );
  const sorted = useMemo(() => sortLayerRows(rows, columns.sort), [rows, columns.sort]);
  // The filter tree (M5-07 part 5): the node chosen, Invert filter and the layers in use, which
  // the engine is asked for while a node or the dialog may need them.
  const [choice, setChoice] = useState<FilterChoice>('all');
  const [invert, setInvert] = useState(false);
  const [used, setUsed] = useState<ReadonlySet<Handle> | undefined>();
  const [filterMenu, setFilterMenu] = useState<
    { choice: FilterChoice; at: { x: number; y: number } } | undefined
  >();
  const [renamingFilter, setRenamingFilter] = useState<Handle | undefined>();
  const [filterDialog, setFilterDialog] = useState<FilterDialog | undefined>();
  const filterSource = useMemo(
    () => layerFilterSource(doc.opened.init, engines.changesOf(doc.id)),
    [doc.opened, doc.id, doc.revision],
  );
  const filters = useMemo(
    () => drawingLayerFilters(doc.opened.init, engines.changesOf(doc.id)),
    [doc.opened, doc.id, doc.revision],
  );
  const filterOf = (c: FilterChoice): LayerFilter | undefined =>
    filters.find((f) => f.handle === c);
  // A filter deleted (or undone away) leaves All chosen.
  const chosen: FilterChoice =
    choice === 'all' || choice === 'used' || filterOf(choice) ? choice : 'all';
  const chosenFilter = filterOf(chosen);
  const needsUsed = chosen !== 'all' || filterDialog !== undefined;
  useEffect(() => {
    if (!needsUsed) return;
    let live = true;
    void engines.layersInUse(doc.id).then((h) => {
      if (live && h) setUsed(new Set(h));
    });
    return () => {
      live = false;
    };
  }, [needsUsed, doc.id, doc.revision]);
  const listed = useMemo(
    () => listedLayers(filterSource, chosen, { invert, used }),
    [filterSource, chosen, invert, used],
  );
  const inFilter = useMemo(
    () => (listed ? sorted.filter((r) => listed.has(r.handle)) : sorted),
    [sorted, listed],
  );
  const layerState = useMemo(
    () => currentLayerStateName(doc.opened.init, engines.changesOf(doc.id)),
    [doc.opened, doc.id, doc.revision],
  );
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? inFilter.filter((r) => r.name.toLowerCase().includes(needle)) : inFilter),
    [inFilter, needle],
  );
  const visible = useMemo(() => visibleLayerColumns(columns, inLayout), [columns, inLayout]);
  const shownColumns = sizing
    ? withLayerColumnWidths(columns, { [sizing.key]: sizing.width })
    : columns;
  const widthOf = (k: LayerColumnKey) => layerColumnWidth(shownColumns, k);
  const frozen = frozenLayerColumns(shownColumns, visible);
  const tableWidth = visible.reduce((sum, c) => sum + widthOf(c.key), 0);
  const cutColumns = cutLayerColumns(shownColumns, visible);
  // Typing → rows filtered on screen: until the frame showing them has been drawn (a task posted
  // from that frame's animation callback runs once its style, layout and paint are done).
  // Written on the element itself, so measuring it renders nothing more.
  useLayoutEffect(() => {
    const start = searchedAt.current;
    if (start === undefined) return;
    searchedAt.current = undefined;
    requestAnimationFrame(() => {
      const drawn = new MessageChannel();
      drawn.port1.onmessage = () => {
        drawn.port1.close();
        paletteRef.current?.setAttribute(
          'data-last-filter-ms',
          (performance.now() - start).toFixed(1),
        );
      };
      drawn.port2.postMessage(undefined);
    });
  }, [search]);
  const [picked, setPicked] = useState<ReadonlySet<Handle>>(new Set());
  const [anchor, setAnchor] = useState<Handle | undefined>();
  const [editing, setEditing] = useState<Editing | undefined>();
  const [picking, setPicking] = useState<Picking | undefined>();
  const tableRef = useRef<HTMLTableElement>(null);
  // Only layers still listed stay selected (a delete, an undo or the search may take some away).
  const selected = useMemo(
    () => new Set(shown.filter((r) => picked.has(r.handle)).map((r) => r.handle)),
    [shown, picked],
  );
  const selectedRows = shown.filter((r) => selected.has(r.handle));

  const select = (next: ReadonlySet<Handle>, at?: Handle) => {
    setPicked(next);
    if (at !== undefined) setAnchor(at);
  };
  const focusRow = (h: Handle) =>
    requestAnimationFrame(() =>
      tableRef.current?.querySelector<HTMLElement>(`tr[data-handle="${h}"]`)?.focus(),
    );

  /** An edit of the manager's own: the drawing redraws, and a refusal is shown. */
  const apply = async (edit: EngineEdit): Promise<boolean> => {
    const result = await engines.edit(doc.id, edit);
    if (!result.ok) {
      setMessage(result.message);
      return false;
    }
    setMessage(undefined);
    store.edited(doc.id);
    return true;
  };

  const newLayer = async () => {
    const like = selectedRows.length === 1 ? selectedRows[0]!.handle : undefined;
    const result = await engines.edit(doc.id, {
      kind: 'layer-new',
      ...(like !== undefined && { like }),
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(undefined);
    store.edited(doc.id);
    // AutoCAD selects the new layer with its name ready to type over.
    const added = result.change.tables?.layers?.added?.[0];
    if (added) {
      setSearch('');
      select(new Set([added.handle]), added.handle);
      startEditing({ handle: added.handle, field: 'name' });
    }
  };

  const deleteLayers = async () => {
    if (selectedRows.length === 0) return;
    if (await apply({ kind: 'layer-delete', layers: selectedRows.map((r) => r.handle) }))
      select(new Set());
  };

  const mergeLayers = async (target: Handle) => {
    const from = merging;
    setMerging(undefined);
    if (!from) return;
    if (await apply({ kind: 'layer-merge', layers: from.map((r) => r.handle), target })) {
      select(new Set([target]), target);
      focusRow(target);
    }
  };

  /** The layer list menu's items (AutoCAD's shortcut menu on the layers). */
  const onListAction = (a: LayerListAction) => {
    const one = selectedRows.length === 1 ? selectedRows[0] : undefined;
    if (a === 'current') void setCurrent();
    else if (a === 'new') void newLayer();
    else if (a === 'rename' && one) startEditing({ handle: one.handle, field: 'name' });
    else if (a === 'delete') void deleteLayers();
    else if (a === 'description' && one) startEditing({ handle: one.handle, field: 'description' });
    else if (a === 'merge') setMerging(selectedRows);
    else if (a === 'removeFromGroup' && chosenFilter?.filterType === 'group') {
      const out = new Set(selectedRows.map((r) => r.handle));
      void apply({
        kind: 'layer-filter-edit',
        filter: chosenFilter.handle,
        layers: chosenFilter.layers.filter((h) => !out.has(h)),
      });
    } else if (a === 'all') select(new Set(shown.map((r) => r.handle)));
    else if (a === 'clear') select(new Set());
    else if (a === 'allButCurrent')
      select(new Set(shown.filter((r) => !r.current).map((r) => r.handle)));
    else if (a === 'invert')
      select(new Set(shown.filter((r) => !selected.has(r.handle)).map((r) => r.handle)));
  };

  /** The menu on a layer: the layer is selected first unless it is already. */
  const openListMenu = (row: LayerRow, at: { x: number; y: number }) => {
    if (!selected.has(row.handle)) select(new Set([row.handle]), row.handle);
    setListMenu(at);
  };

  const setCurrent = async (row?: LayerRow) => {
    const r = row ?? (selectedRows.length === 1 ? selectedRows[0] : undefined);
    if (r) await apply({ kind: 'layer-current', layer: r.handle });
  };

  // An in-place edit ends once: Enter, Esc or leaving the field, whichever comes first.
  const ended = useRef(false);
  const startEditing = (e: Editing) => {
    ended.current = false;
    setEditing(e);
  };
  const commit = async (row: LayerRow, field: Editing['field'], value: string) => {
    if (ended.current) return;
    ended.current = true;
    setEditing(undefined);
    const before = field === 'name' ? row.name : row.description;
    if (value !== before) await apply({ kind: 'layer', layer: row.handle, [field]: value });
    focusRow(row.handle);
  };

  const onRowClick = (e: MouseEvent, row: LayerRow) => {
    // A toggle or a field in a selected row keeps the selection it acts on.
    const control = (e.target as HTMLElement).closest('button, input');
    if (control && selected.has(row.handle)) return;
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only';
    select(
      selectionAfter(shown, selected, anchor, row.handle, mode),
      mode === 'range' ? undefined : row.handle,
    );
  };

  const onRowKey = (e: KeyboardEvent, row: LayerRow) => {
    if (e.target !== e.currentTarget) return;
    const i = shown.findIndex((r) => r.handle === row.handle);
    const go = (to: number) => {
      const r = shown[to];
      if (!r) return;
      e.preventDefault();
      select(
        e.shiftKey
          ? selectionAfter(shown, selected, anchor, r.handle, 'range')
          : new Set([r.handle]),
        e.shiftKey ? undefined : r.handle,
      );
      focusRow(r.handle);
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(shown.length - 1);
    else if (e.key === ' ' && !e.shiftKey) {
      e.preventDefault();
      select(
        selectionAfter(shown, selected, anchor, row.handle, e.ctrlKey ? 'toggle' : 'only'),
        row.handle,
      );
    } else if (e.key === 'F2') {
      e.preventDefault();
      startEditing({ handle: row.handle, field: 'name' });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      void deleteLayers();
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const box = e.currentTarget.getBoundingClientRect();
      openListMenu(row, { x: box.left + 24, y: box.bottom });
    }
  };

  /** A filter edit; the filter it added, if any, is chosen. */
  const applyFilter = async (edit: EngineEdit): Promise<EditResult> => {
    const result = await engines.edit(doc.id, edit);
    if (!result.ok) return result;
    setMessage(undefined);
    store.edited(doc.id);
    const added = result.change.objects?.added?.find(isLayerFilter);
    if (added) setChoice(added.handle);
    return result;
  };

  /** New Group Filter: Group Filter1 (nested in `parent`), named in place. */
  const newGroupFilter = async (parent?: Handle) => {
    const result = await applyFilter({
      kind: 'layer-filter-new',
      name: nextFilterName(filters, 'group'),
      filterType: 'group',
      ...(parent !== undefined && { parent }),
    });
    if (!result.ok) setMessage(result.message);
    const added = result.ok ? result.change.objects?.added?.find(isLayerFilter) : undefined;
    if (added) setRenamingFilter(added.handle);
  };

  const newPropertyFilter = (parent?: Handle) =>
    setFilterDialog({
      name: nextFilterName(filters, 'property'),
      expression: EMPTY_DEFINITION,
      parent,
    });

  /** The filter menu's items, and F2 and Delete in the tree, on node `c`. */
  const onFilterAction = (a: LayerFilterAction, c: FilterChoice) => {
    const f = filterOf(c);
    if (a === 'newProperty') newPropertyFilter(f?.handle);
    else if (a === 'newGroup' && f?.filterType !== 'property') void newGroupFilter(f?.handle);
    else if (a === 'rename' && f) setRenamingFilter(f.handle);
    else if (a === 'delete' && f) void apply({ kind: 'layer-filter-delete', filter: f.handle });
    else if (a === 'properties' && f?.filterType === 'property')
      setFilterDialog({
        filter: f.handle,
        name: f.name,
        expression: f.expression,
        parent: f.parent,
      });
  };

  const renameFilter = async (filter: Handle, name: string | undefined) => {
    setRenamingFilter(undefined);
    const f = filterOf(filter);
    if (f && name !== undefined && name !== f.name)
      await apply({ kind: 'layer-filter-edit', filter, name });
  };

  /** Layers dropped on a group filter: those not in it yet join it. */
  const dropLayers = async (filter: Handle, layers: Handle[]) => {
    const f = filterOf(filter);
    if (f?.filterType !== 'group') return;
    const add = layers.filter((h) => !f.layers.includes(h));
    if (add.length > 0)
      await apply({ kind: 'layer-filter-edit', filter, layers: [...f.layers, ...add] });
  };

  /** Layer Filter Properties' OK: the filter made or changed, or why not. */
  const saveFilter = async (name: string, expression: string): Promise<string | undefined> => {
    const d = filterDialog;
    if (!d) return undefined;
    const result = await applyFilter(
      d.filter !== undefined
        ? { kind: 'layer-filter-edit', filter: d.filter, name, expression }
        : {
            kind: 'layer-filter-new',
            name,
            expression,
            ...(d.parent !== undefined && { parent: d.parent }),
          },
    );
    if (!result.ok) return result.message;
    setFilterDialog(undefined);
    return undefined;
  };

  const onPaletteKey = (e: KeyboardEvent) => {
    // AutoCAD's manager: Alt+N New Layer, Alt+D Delete Layer, Alt+C Set Current, Alt+S Layer
    // States Manager; Ctrl+A all.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const run =
        k === 'n'
          ? newLayer
          : k === 'd'
            ? deleteLayers
            : k === 'c'
              ? setCurrent
              : k === 's'
                ? () => layerStatesManager.show(doc.id)
                : k === 'p'
                  ? () => newPropertyFilter()
                  : k === 'g'
                    ? () => newGroupFilter()
                    : undefined;
      if (run) {
        e.preventDefault();
        void run();
      }
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'a' &&
      e.target instanceof HTMLTableRowElement
    ) {
      e.preventDefault();
      select(new Set(shown.map((r) => r.handle)));
    }
  };

  /** The layers a cell clicked in `row` changes: every selected one when `row` is. */
  const targets = (row: LayerRow): Handle | Handle[] =>
    selected.has(row.handle) && selected.size > 1 ? [...selected] : row.handle;

  /** A property dialog's OK: the value on the layers of the row it was opened from. */
  const setProps = async (props: LayerProps) => {
    if (!picking) return;
    const row = picking.row;
    setPicking(undefined);
    await apply({ kind: 'layer', layer: targets(row), ...props });
    focusRow(row.handle);
  };
  const closeDialog = () => {
    const row = picking?.row;
    setPicking(undefined);
    if (row) focusRow(row.handle);
  };

  const toggle = async (row: LayerRow, key: Toggle) => {
    const start = performance.now();
    // After a click Chromium runs nothing else on the page, the engine's answer included, until
    // it has drawn its next frame: the toggle's own latency counts from that frame (DEC-054).
    let frame: number | undefined;
    requestAnimationFrame(() => {
      frame ??= performance.now();
    });
    // A click in a selected row changes every selected layer, to the opposite of that row's.
    const edit: EngineEdit = { kind: 'layer', layer: targets(row), [key]: !row[key] };
    const result = await engines.edit(doc.id, edit);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    // The change's number in the drawing's change log, which it has just joined (M2-62).
    const seq = engines.changesOf(doc.id).length;
    // Toggle → canvas: until the space on screen has drawn the change (acceptance < 16 ms).
    // The palette's own re-render comes after, so it is not counted.
    const controller = controllerOf(doc.id, doc.block);
    await controller?.flush();
    const end = performance.now();
    // The render worker drew the change when the engine's own copy reached it, without
    // waiting on this thread (M2-62): click → drawn on the clock both threads share.
    const drawnAt = await controller?.drawnAt(seq);
    setMessage(undefined);
    setLast({
      click: end - start,
      frame: end - (frame ?? start),
      drawn: drawnAt === undefined ? undefined : drawnAt - (performance.timeOrigin + start),
    });
    store.edited(doc.id);
  };

  // The rows' cells act through this, so a row re-renders only when what it shows changes:
  // typing in the search hides and shows rows without rendering the others again (M5-05 part
  // 3: under 100 ms on 200 layers).
  const act = useRef<RowActions>(undefined as unknown as RowActions);
  act.current = {
    rowClick: onRowClick,
    rowKey: onRowKey,
    toggle: (row, key) => void toggle(row, key),
    pick: (cell, row) => setPicking({ cell, row }),
    setCurrent: (row) => void setCurrent(row),
    edit: startEditing,
    commit: (row, field, value) => void commit(row, field, value),
    cancelEdit: (row) => {
      ended.current = true;
      setEditing(undefined);
      focusRow(row.handle);
    },
    dragStart: (e, row) => {
      const layers = selected.has(row.handle) ? [...selected] : [row.handle];
      e.dataTransfer.setData(LAYER_DRAG_TYPE, JSON.stringify(layers));
      e.dataTransfer.effectAllowed = 'copy';
    },
  };

  /**
   * Column `key`'s width fitting its header and the contents of the rows listed (Optimize).
   * A cell's contents are measured as laid out on one line, whatever the cell cuts off.
   */
  const fittedWidth = (key: LayerColumnKey): number => {
    let width = MIN_COLUMN_WIDTH;
    const range = document.createRange();
    for (const cell of tableRef.current?.querySelectorAll<HTMLElement>(`[data-col="${key}"]`) ??
      []) {
      // A row the search hides keeps its boxes (M5-13), but its cells are not shown.
      if (!cell.checkVisibility()) continue;
      // A header's grip sits on its edge: only the header's title counts.
      range.selectNodeContents(cell.querySelector('.layer-sort') ?? cell);
      const style = getComputedStyle(cell);
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      width = Math.max(width, Math.ceil(range.getBoundingClientRect().width + pad) + 2);
    }
    return width;
  };
  const sizeColumns = (how: LayerColumnSizing, column: LayerColumnKey) => {
    const all = how === 'maximize-all' || how === 'optimize-all';
    const keys = all ? visible.map((c) => c.key) : [column];
    const fitted: Partial<Record<LayerColumnKey, number>> = {};
    for (const k of keys) fitted[k] = fittedWidth(k);
    if (how === 'optimize' || how === 'optimize-all') {
      onColumns(withLayerColumnWidths(columns, fitted));
      return;
    }
    // Maximize: fitted, then the list's room left over shared among them.
    const widths: Partial<Record<LayerColumnKey, number>> = {};
    for (const c of visible) widths[c.key] = fitted[c.key] ?? layerColumnWidth(columns, c.key);
    const room = tableRef.current?.parentElement?.clientWidth ?? 0;
    onColumns(
      withLayerColumnWidths(
        columns,
        maximizedWidths(widths as Record<LayerColumnKey, number>, keys, room),
      ),
    );
  };

  // A row's element is made again only when its props change: typing in the search hides and
  // shows rows, and making all 201 elements again took most of the filter's time in React's
  // development build (M5-05 part 5).
  const rowViews = new Map<Handle, { props: RowProps; element: ReactElement }>();
  const firstShown = shown[0]?.handle;
  const rowList = inFilter.map((r) => {
    const props: RowProps = {
      row: r,
      columns: visible,
      selected: selected.has(r.handle),
      tabbable: selected.has(r.handle) || (selected.size === 0 && firstShown === r.handle),
      editing: editing?.handle === r.handle ? editing.field : undefined,
      act,
    };
    const was = rowElements.current.get(r.handle);
    const same =
      was !== undefined &&
      (Object.keys(props) as (keyof RowProps)[]).every((k) => was.props[k] === props[k]);
    const view = same ? was : { props, element: <LayerRowView key={r.handle} {...props} /> };
    rowViews.set(r.handle, view);
    return view.element;
  });
  rowElements.current = rowViews;

  const one = selectedRows.length === 1;
  return (
    <aside
      ref={paletteRef}
      className="palette layers-palette"
      aria-labelledby="layers-title"
      data-last-toggle-ms={last?.click.toFixed(1)}
      data-last-toggle-frame-ms={last?.frame.toFixed(1)}
      data-last-toggle-drawn-ms={last?.drawn?.toFixed(1)}
      onKeyDown={onPaletteKey}
    >
      <header>
        <h2 id="layers-title">Layers</h2>
        <button type="button" aria-label="Close Layers" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="layer-tools" role="toolbar" aria-label="Layer tools">
        <button
          type="button"
          title="New Property Filter (Alt+P)"
          aria-keyshortcuts="Alt+P"
          onClick={() => newPropertyFilter()}
        >
          New Property Filter
        </button>
        <button
          type="button"
          title="New Group Filter (Alt+G)"
          aria-keyshortcuts="Alt+G"
          onClick={() => void newGroupFilter()}
        >
          New Group Filter
        </button>
        <button
          type="button"
          title="New Layer (Alt+N)"
          aria-keyshortcuts="Alt+N"
          onClick={() => void newLayer()}
        >
          New Layer
        </button>
        <button
          type="button"
          title="Delete Layer (Alt+D)"
          aria-keyshortcuts="Alt+D"
          disabled={selectedRows.length === 0}
          onClick={() => void deleteLayers()}
        >
          Delete Layer
        </button>
        <button
          type="button"
          title="Set Current (Alt+C)"
          aria-keyshortcuts="Alt+C"
          disabled={!one}
          onClick={() => void setCurrent()}
        >
          Set Current
        </button>
        <button
          type="button"
          title="Layer States Manager (Alt+S)"
          aria-label="Layer States Manager"
          aria-keyshortcuts="Alt+S"
          onClick={() => void layerStatesManager.show(doc.id)}
        >
          Layer States
        </button>
      </div>
      <p className="layer-state-current">
        Layer state: <span>{layerState}</span>
      </p>
      <input
        type="search"
        className="layer-search"
        placeholder="Search for layer"
        aria-label="Search for layer"
        value={search}
        onChange={(e) => {
          searchedAt.current = performance.now();
          setSearch(e.currentTarget.value);
        }}
      />
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
      <div className="layer-body">
        {columns.treeCollapsed ? (
          <button
            type="button"
            className="layer-filters-expand"
            aria-label="Expand Layer Filter tree"
            title="Expand Layer Filter tree"
            aria-expanded="false"
            onClick={() => {
              const { treeCollapsed: _, ...rest } = columns;
              onColumns(rest);
            }}
          >
            »
          </button>
        ) : (
          <LayerFilterTree
            tree={layerFilterTree(filters)}
            choice={chosen}
            invert={invert}
            renaming={renamingFilter}
            onChoose={(c) => {
              setChoice(c);
              setMessage(undefined);
            }}
            onInvert={setInvert}
            onRename={(f, name) => void renameFilter(f, name)}
            onMenu={(c, at) => {
              setChoice(c);
              setFilterMenu({ choice: c, at });
            }}
            onAction={onFilterAction}
            onDropLayers={(f, layers) => void dropLayers(f, layers)}
            onCollapse={() => onColumns({ ...columns, treeCollapsed: true })}
          />
        )}
        <div className="layer-table-wrap">
          {needle && <style>{searchCss(needle)}</style>}
          {frozen.size > 0 && <style>{frozenColumnsCss(frozen)}</style>}
          {cutColumns.length > 0 && <style>{cutColumnsCss(cutColumns)}</style>}
          <table
            ref={tableRef}
            className="layer-table"
            aria-label="Layers of the drawing"
            aria-multiselectable="true"
            style={
              {
                width: tableWidth,
                '--layer-columns': layerColumnTracks(shownColumns, visible),
              } as CSSProperties
            }
          >
            <thead>
              <tr
                onContextMenu={(e) => {
                  e.preventDefault();
                  const th = (e.target as HTMLElement).closest<HTMLElement>('th[data-col]');
                  const column = (th?.dataset['col'] as LayerColumnKey | undefined) ?? 'name';
                  setColumnsMenu({ x: e.clientX, y: e.clientY, column });
                }}
              >
                {visible.map((c) => {
                  const sorting = columns.sort.key === c.key;
                  return (
                    <LayerColumnHeader
                      key={c.key}
                      columnKey={c.key}
                      title={c.title}
                      sort={
                        sorting ? (columns.sort.descending ? 'descending' : 'ascending') : undefined
                      }
                      onSort={() =>
                        onColumns({ ...columns, sort: sortAfterClick(columns.sort, c.key) })
                      }
                      onMenu={(at) => setColumnsMenu({ ...at, column: c.key })}
                      onMove={(before) =>
                        onColumns({
                          ...columns,
                          order: moveLayerColumnBefore(columns.order, c.key, before),
                        })
                      }
                      onResize={(width, done) => {
                        if (!done) {
                          setSizing({ key: c.key, width });
                          return;
                        }
                        setSizing(undefined);
                        onColumns(withLayerColumnWidths(columns, { [c.key]: width }));
                      }}
                      onOptimize={() => sizeColumns('optimize', c.key)}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody
              onContextMenu={(e) => {
                const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-handle]');
                const row = tr && shown.find((r) => r.handle === tr.dataset.handle);
                if (!row) return;
                e.preventDefault();
                openListMenu(row, { x: e.clientX, y: e.clientY });
              }}
            >
              {rowList}
            </tbody>
          </table>
          {shown.length === 0 && needle && <p className="empty">No layer matches “{search}”.</p>}
        </div>
      </div>
      <p className="layer-filter-count" aria-live="polite">
        {filterCountLine(
          chosen === 'all'
            ? 'All'
            : chosen === 'used'
              ? 'All Used Layers'
              : (chosenFilter?.name ?? ''),
          shown.length,
          rows.length,
        )}
      </p>
      {columnsMenu && (
        <LayerColumnsMenu
          at={columnsMenu}
          settings={columns}
          inLayout={inLayout}
          onChange={onColumns}
          onSize={sizeColumns}
          onCustomize={() => {
            setColumnsMenu(undefined);
            setCustomizing(true);
          }}
          onClose={() => setColumnsMenu(undefined)}
        />
      )}
      {listMenu && (
        <LayerListMenu
          at={listMenu}
          selected={selectedRows.length}
          group={chosenFilter?.filterType === 'group'}
          onAction={onListAction}
          onClose={() => setListMenu(undefined)}
        />
      )}
      {filterMenu && (
        <LayerFilterMenu
          at={filterMenu.at}
          filter={filterOf(filterMenu.choice)}
          onAction={(a) => onFilterAction(a, filterMenu.choice)}
          onClose={() => setFilterMenu(undefined)}
        />
      )}
      {filterDialog && (
        <LayerFilterDialog
          name={filterDialog.name}
          expression={filterDialog.expression}
          parent={filterDialog.parent}
          source={filterSource}
          rows={sorted}
          used={used}
          books={layerColorBooks(doc.opened.init, engines.changesOf(doc.id))}
          linetypes={layerLinetypes(doc.opened.init, engines.changesOf(doc.id))}
          onOk={saveFilter}
          onCancel={() => setFilterDialog(undefined)}
        />
      )}
      {merging && (
        <MergeToLayerDialog
          layers={merging.map((r) => r.name)}
          targets={mergeTargets(sorted, new Set(merging.map((r) => r.handle)))}
          onMerge={(target) => void mergeLayers(target)}
          onCancel={() => {
            setMerging(undefined);
            const first = merging[0];
            if (first) focusRow(first.handle);
          }}
        />
      )}
      {customizing && (
        <CustomizeLayerColumnsDialog
          settings={columns}
          onOk={(s) => {
            setCustomizing(false);
            onColumns(s);
          }}
          onCancel={() => setCustomizing(false)}
        />
      )}
      {picking?.cell === 'color' && (
        <SelectColorDialog
          initial={picking.row.value.color}
          books={layerColorBooks(doc.opened.init, engines.changesOf(doc.id))}
          trueColors
          notByLayer="A layer’s color cannot be ByLayer or ByBlock."
          onOk={(color) => void setProps({ color })}
          onCancel={closeDialog}
        />
      )}
      {picking?.cell === 'linetype' && (
        <SelectLinetypeDialog
          initial={picking.row.value.linetype}
          linetypes={layerLinetypes(doc.opened.init, engines.changesOf(doc.id))}
          onOk={(linetype) => void setProps({ linetype })}
          onCancel={closeDialog}
          files={linetypeFiles}
          onLoad={async (linetypes, reload) => {
            const result = await engines.edit(doc.id, { kind: 'linetype-load', linetypes, reload });
            if (!result.ok) {
              setMessage(result.message);
              return undefined;
            }
            setMessage(undefined);
            store.edited(doc.id);
            return (result.change.tables?.linetypes?.added ?? []).map((l) => l.handle);
          }}
        />
      )}
      {picking?.cell === 'lineweight' && (
        <LineweightDialog
          units={lwUnits}
          initial={picking.row.value.lineweight}
          onOk={(lineweight) => void setProps({ lineweight })}
          onCancel={closeDialog}
        />
      )}
      {picking?.cell === 'transparency' && (
        <LayerTransparencyDialog
          initial={Number(picking.row.transparency)}
          onOk={(percent) => void setProps({ transparency: transparencyOf(percent) })}
          onCancel={closeDialog}
        />
      )}
    </aside>
  );
}
