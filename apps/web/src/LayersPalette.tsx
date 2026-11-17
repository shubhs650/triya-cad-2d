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
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { transparencyOf, type EngineEdit, type Handle, type LayerProps } from '@triya/engine';
import { controllerOf } from './canvas/registry';
import type { DocumentStore, OpenDocument } from './documents';
import { engines } from './engine/registry';
import { LayerTransparencyDialog, LineweightDialog, SelectLinetypeDialog } from './LayerDialogs';
import { layerColorBooks, layerLinetypes, layerRows, type LayerRow } from './layers';
import { SelectColorDialog } from './SelectColorDialog';

type Toggle = 'on' | 'frozen' | 'locked' | 'plot';

interface ToggleColumn {
  readonly key: Toggle;
  readonly title: string;
  readonly label: (r: LayerRow) => string;
}

const TOGGLES: readonly ToggleColumn[] = [
  { key: 'on', title: 'On', label: (r) => (r.on ? 'On' : 'Off') },
  { key: 'frozen', title: 'Freeze', label: (r) => (r.frozen ? 'Frozen' : 'Thawed') },
  { key: 'locked', title: 'Lock', label: (r) => (r.locked ? 'Locked' : 'Unlocked') },
];

const PLOT: ToggleColumn = {
  key: 'plot',
  title: 'Plot',
  label: (r) => (r.plot ? 'Plot' : 'No plot'),
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

export function LayersPalette({
  doc,
  store,
  onClose,
}: {
  doc: OpenDocument;
  store: DocumentStore;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
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
  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
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

  const onRowKey = (e: KeyboardEvent, row: LayerRow, i: number) => {
    if (e.target !== e.currentTarget) return;
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
    // AutoCAD's manager: Alt+N New Layer, Alt+D Delete Layer, Alt+C Set Current; Ctrl+A all.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const run =
        k === 'n' ? newLayer : k === 'd' ? deleteLayers : k === 'c' ? setCurrent : undefined;
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

  const toggleCell = (r: LayerRow, t: ToggleColumn) => (
    <td key={t.key}>
      <button
        type="button"
        className={`toggle ${t.key}`}
        aria-pressed={r[t.key]}
        aria-label={`${t.title} ${r.name}`}
        title={t.label(r)}
        onClick={() => void toggle(r, t.key)}
      >
        {t.label(r)}
      </button>
    </td>
  );

  const propertyCell = (r: LayerRow, cell: Picking['cell'], title: string, text: string) => (
    <td className={cell}>
      <button
        type="button"
        className="layer-cell"
        aria-label={`${title} ${r.name}`}
        aria-haspopup="dialog"
        title={text}
        onClick={() => setPicking({ cell, row: r })}
      >
        {cell === 'color' && (
          <span className="swatch" style={{ background: r.color.css }} aria-hidden />
        )}
        {text}
      </button>
    </td>
  );

  const inPlace = (r: LayerRow, field: Editing['field'], label: string) => (
    <input
      className="layer-in-place"
      aria-label={label}
      defaultValue={field === 'name' ? r.name : r.description}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void commit(r, field, e.currentTarget.value);
        else if (e.key === 'Escape') {
          ended.current = true;
          setEditing(undefined);
          focusRow(r.handle);
        }
      }}
      onBlur={(e) => void commit(r, field, e.currentTarget.value)}
    />
  );

  const one = selectedRows.length === 1;
  return (
    <aside
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
      </div>
      <input
        type="search"
        className="layer-search"
        placeholder="Search for layer"
        aria-label="Search for layer"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
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
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              {TOGGLES.map((t) => (
                <th key={t.key} scope="col">
                  {t.title}
                </th>
              ))}
              {inLayout && <th scope="col">VP Freeze</th>}
              <th scope="col">Plot</th>
              <th scope="col">Color</th>
              <th scope="col">Linetype</th>
              <th scope="col">Lineweight</th>
              <th scope="col">Transparency</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={r.handle}
                data-handle={r.handle}
                data-current={r.current}
                aria-selected={selected.has(r.handle)}
                tabIndex={selected.has(r.handle) || (selected.size === 0 && i === 0) ? 0 : -1}
                onClick={(e) => onRowClick(e, r)}
                onKeyDown={(e) => onRowKey(e, r, i)}
              >
                <td className="status" onDoubleClick={() => void setCurrent(r)}>
                  {r.current ? <span aria-label="Current layer">✓</span> : null}
                </td>
                <th
                  scope="row"
                  className="name"
                  onDoubleClick={() => startEditing({ handle: r.handle, field: 'name' })}
                >
                  {editing?.handle === r.handle && editing.field === 'name'
                    ? inPlace(r, 'name', `Name of ${r.name}`)
                    : r.name}
                </th>
                {TOGGLES.map((t) => toggleCell(r, t))}
                {inLayout && (
                  <td className="vp-freeze">
                    {r.vpFrozen && r.vpFrozen.of > 0
                      ? `${r.vpFrozen.frozen} of ${r.vpFrozen.of}`
                      : '—'}
                  </td>
                )}
                {toggleCell(r, PLOT)}
                {propertyCell(r, 'color', 'Color', r.color.label)}
                {propertyCell(r, 'linetype', 'Linetype', r.linetype)}
                {propertyCell(r, 'lineweight', 'Lineweight', r.lineweight)}
                {propertyCell(r, 'transparency', 'Transparency', r.transparency)}
                <td
                  className="description"
                  onDoubleClick={() => startEditing({ handle: r.handle, field: 'description' })}
                >
                  {editing?.handle === r.handle && editing.field === 'description'
                    ? inPlace(r, 'description', `Description of ${r.name}`)
                    : r.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No layer matches “{search}”.</p>}
      </div>
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
