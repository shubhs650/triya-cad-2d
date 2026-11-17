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
import {
  Fragment,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { transparencyOf, type EngineEdit, type Handle, type LayerProps } from '@triya/engine';
import { controllerOf } from './canvas/registry';
import type { DocumentStore, OpenDocument } from './documents';
import { engines } from './engine/registry';
import { CustomizeLayerColumnsDialog, LayerColumnsMenu } from './LayerColumns';
import { LayerTransparencyDialog, LineweightDialog, SelectLinetypeDialog } from './LayerDialogs';
import {
  sortAfterClick,
  sortLayerRows,
  visibleLayerColumns,
  type LayerColumn,
  type LayerColumnKey,
  type LayerColumnSettings,
} from './layer-columns';
import {
  currentLayerStateName,
  drawingLayerStates,
  layerStateRows,
  layerStateTables,
  layerStatesManager,
} from './layer-states';
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
    <td>
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
    <td className={cell}>
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
        <td className="status" onDoubleClick={() => act.current.setCurrent(r)}>
          {r.current ? <span aria-label="Current layer">✓</span> : null}
        </td>
      );
    case 'name':
      return (
        <th
          scope="row"
          className="name"
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
        <td className="vp-freeze">
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

/**
 * One layer's row. Memoised: it renders again only when its layer, its columns or its selected,
 * hidden or editing state changes. A row the search leaves out is hidden, not removed, so that
 * typing in the search does not build rows again.
 */
const LayerRowView = memo(function LayerRowView({
  row,
  columns,
  hidden,
  selected,
  tabbable,
  editing,
  act,
}: {
  row: LayerRow;
  columns: readonly LayerColumn[];
  hidden: boolean;
  selected: boolean;
  tabbable: boolean;
  editing: Editing['field'] | undefined;
  act: RefObject<RowActions>;
}) {
  return (
    <tr
      hidden={hidden}
      data-handle={row.handle}
      data-current={row.current}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
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

export function LayersPalette({
  doc,
  store,
  columns,
  onColumns,
  onClose,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  /** The user's columns and sort (kept with the preferences). */
  columns: LayerColumnSettings;
  onColumns: (s: LayerColumnSettings) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | undefined>();
  const [customizing, setCustomizing] = useState(false);
  const paletteRef = useRef<HTMLElement>(null);
  /** When the search last changed, until its rows are on screen. */
  const searchedAt = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>();
  const [last, setLast] = useState<
    { click: number; frame: number; drawn: number | undefined } | undefined
  >();
  const inLayout = doc.block !== doc.opened.modelSpace;
  const rows = useMemo(
    () => layerRows(doc.opened.init, engines.changesOf(doc.id), inLayout ? doc.block : undefined),
    // `revision` changes when the engine applied an edit, which is what the rows read.
    [doc.opened, doc.id, doc.block, doc.revision, inLayout],
  );
  const sorted = useMemo(() => sortLayerRows(rows, columns.sort), [rows, columns.sort]);
  const layerState = useMemo(() => {
    const changes = engines.changesOf(doc.id);
    const init = doc.opened.init;
    return currentLayerStateName(
      layerStateRows(drawingLayerStates(init, changes), layerStateTables(init, changes)),
    );
  }, [doc.opened, doc.id, doc.revision]);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? sorted.filter((r) => r.name.toLowerCase().includes(needle)) : sorted),
    [sorted, needle],
  );
  const listed = useMemo(() => new Set(shown.map((r) => r.handle)), [shown]);
  const visible = useMemo(() => visibleLayerColumns(columns, inLayout), [columns, inLayout]);
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
    }
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
  };

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
        Layer state: <output aria-label="Layer state">{layerState}</output>
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
      <div className="layer-table-wrap">
        <table
          ref={tableRef}
          className="layer-table"
          aria-label="Layers of the drawing"
          aria-multiselectable="true"
        >
          <thead>
            <tr
              onContextMenu={(e) => {
                e.preventDefault();
                setColumnsMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              {visible.map((c) => {
                const sorting = columns.sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      sorting ? (columns.sort.descending ? 'descending' : 'ascending') : undefined
                    }
                  >
                    <button
                      type="button"
                      className="layer-sort"
                      title={`Sort by ${c.title}`}
                      onClick={() =>
                        onColumns({ ...columns, sort: sortAfterClick(columns.sort, c.key) })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                          e.preventDefault();
                          const box = e.currentTarget.getBoundingClientRect();
                          setColumnsMenu({ x: box.left, y: box.bottom });
                        }
                      }}
                    >
                      {c.title}
                      {sorting && (
                        <span className="layer-sort-arrow" aria-hidden>
                          {columns.sort.descending ? '▼' : '▲'}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <LayerRowView
                key={r.handle}
                row={r}
                columns={visible}
                hidden={!listed.has(r.handle)}
                selected={selected.has(r.handle)}
                tabbable={
                  selected.has(r.handle) || (selected.size === 0 && shown[0]?.handle === r.handle)
                }
                editing={editing?.handle === r.handle ? editing.field : undefined}
                act={act}
              />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No layer matches “{search}”.</p>}
      </div>
      {columnsMenu && (
        <LayerColumnsMenu
          at={columnsMenu}
          settings={columns}
          inLayout={inLayout}
          onChange={onColumns}
          onCustomize={() => {
            setColumnsMenu(undefined);
            setCustomizing(true);
          }}
          onClose={() => setColumnsMenu(undefined)}
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
        />
      )}
      {picking?.cell === 'lineweight' && (
        <LineweightDialog
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
