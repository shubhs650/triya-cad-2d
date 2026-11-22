// Edit Layer State (M5-07 part 3), opened by the Layer States Manager's Edit...: the layers the
// selected state names and the settings it restores, with AutoCAD 2024's structure and labels
// (UI_SPEC.md §7; AutoCAD Help, "Edit Layer State Dialog Box"):
//
//   - The list: Name, On, Freeze, Lock, Plot, Color, Linetype, Lineweight, Transparency, Plot
//     Style and New VP Freeze. A click selects a row, Ctrl+click adds or takes one off the
//     selection, Shift+click selects a range; the arrow keys, Home and End move it.
//   - On, Freeze, Lock, Plot and New VP Freeze toggle; Color, Linetype, Lineweight and
//     Transparency open Select Color, Select Linetype, Lineweight and Layer Transparency. On a
//     selected row the change goes to every selected row, as in the Layer Properties Manager.
//     Plot Style is shown as saved: a colour-dependent drawing's is the colour's (`Color_n`).
//   - "Add layers to layer state" opens Select Layers to Add to Layer State: the drawing's layers
//     the state does not name; those picked are added with their settings now. "Remove layers
//     from layer state" (or Delete) takes the selected rows out.
//   - OK saves the layers as one LAYERSTATE step (engine `layer-state-edit` with `layers`);
//     Cancel and Esc leave the state as it was.
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  transparencyOf,
  type Color,
  type ColorBook,
  type Handle,
  type LayerRecord,
  type LayerStateLayer,
  type LayerStateTables,
  type LinetypeRecord,
  type Lineweight,
  type LineweightUnits,
} from '@triya/engine';
import { Modal } from './AttributeDialogs';
import { LayerTransparencyDialog, LineweightDialog, SelectLinetypeDialog } from './LayerDialogs';
import {
  editLayerStateRows,
  layersToAdd,
  withLayersAdded,
  type EditLayerStateRow,
} from './layer-states';
import { SelectColorDialog } from './SelectColorDialog';

type Toggle = 'on' | 'frozen' | 'locked' | 'plot' | 'newVpFrozen';

const TOGGLES: readonly {
  readonly key: Toggle;
  readonly title: string;
  readonly label: (on: boolean) => string;
}[] = [
  { key: 'on', title: 'On', label: (v) => (v ? 'On' : 'Off') },
  { key: 'frozen', title: 'Freeze', label: (v) => (v ? 'Frozen' : 'Thawed') },
  { key: 'locked', title: 'Lock', label: (v) => (v ? 'Locked' : 'Unlocked') },
  { key: 'plot', title: 'Plot', label: (v) => (v ? 'Plot' : 'No plot') },
];

const NEW_VP_FREEZE = {
  key: 'newVpFrozen',
  title: 'New VP Freeze',
  label: (v: boolean) => (v ? 'Frozen' : 'Thawed'),
} as const;

type Cell = 'color' | 'linetype' | 'lineweight' | 'transparency';

export function EditLayerState({
  stateName,
  layers,
  tables,
  linetypes,
  books,
  units,
  problem,
  onOk,
  onCancel,
}: {
  stateName: string;
  /** The layers the state names, as saved. */
  layers: readonly LayerStateLayer[];
  /** The drawing's tables now: the layers Add offers, the settings an added layer takes. */
  tables: LayerStateTables;
  /** The loaded linetypes Select Linetype lists. */
  linetypes: readonly LinetypeRecord[];
  books: readonly ColorBook[];
  /** LWUNITS: the Lineweight column in millimetres or inches. */
  units: LineweightUnits;
  /** Why OK was refused. */
  problem: string | undefined;
  onOk: (layers: LayerStateLayer[]) => void;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState<readonly LayerStateLayer[]>(layers);
  const rows = useMemo(() => editLayerStateRows(entries, tables, units), [entries, tables, units]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(rows[0] ? [rows[0].key] : []),
  );
  const [anchor, setAnchor] = useState<string | undefined>(rows[0]?.key);
  const [picking, setPicking] = useState<{ cell: Cell; row: EditLayerStateRow } | undefined>();
  const [adding, setAdding] = useState(false);
  const listRef = useRef<HTMLTableSectionElement>(null);

  const focusRow = (key: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(key)}"]`)?.focus(),
    );

  /** The rows a change on `row` goes to: the selection when `row` is in it, else `row`. */
  const targets = (row: EditLayerStateRow): ReadonlySet<string> =>
    selected.has(row.key) ? selected : new Set([row.key]);

  const change = (row: EditLayerStateRow, patch: Partial<LayerStateLayer>) => {
    const to = targets(row);
    setEntries((es) => es.map((e, i) => (to.has(rows[i]!.key) ? { ...e, ...patch } : e)));
  };

  const toggle = (row: EditLayerStateRow, key: Toggle) => change(row, { [key]: !row[key] });

  const select = (row: EditLayerStateRow, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      setSelected(next);
      setAnchor(row.key);
    } else if (e.shiftKey && anchor !== undefined) {
      const a = rows.findIndex((r) => r.key === anchor);
      const b = rows.indexOf(row);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(rows.slice(Math.max(0, lo), hi + 1).map((r) => r.key)));
    } else {
      setSelected(new Set([row.key]));
      setAnchor(row.key);
    }
  };

  const remove = () => {
    if (selected.size === 0) return;
    const at = rows.findIndex((r) => selected.has(r.key));
    const kept = rows.filter((r) => !selected.has(r.key));
    setEntries(kept.map((r) => r.entry));
    const next = kept[Math.min(at, kept.length - 1)];
    setSelected(new Set(next ? [next.key] : []));
    setAnchor(next?.key);
    if (next) focusRow(next.key);
  };

  const add = (picked: readonly LayerRecord[]) => {
    setAdding(false);
    if (picked.length === 0) return;
    const next = withLayersAdded(entries, tables, picked);
    setEntries(next);
    const keys = picked.map((l) => l.handle);
    setSelected(new Set(keys));
    setAnchor(keys[0]);
    focusRow(keys[0]!);
  };

  const onListKey = (e: KeyboardEvent) => {
    const at = rows.findIndex((r) => r.key === anchor);
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      e.preventDefault();
      setSelected(new Set([r.key]));
      setAnchor(r.key);
      focusRow(r.key);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'Delete') {
      e.preventDefault();
      remove();
    }
  };

  const toggleCell = (
    r: EditLayerStateRow,
    t: { readonly key: Toggle; readonly title: string; readonly label: (v: boolean) => string },
  ) => (
    <td key={t.key}>
      <button
        type="button"
        className={`toggle ${t.key}`}
        aria-pressed={r[t.key]}
        aria-label={`${t.title} ${r.name}`}
        title={t.label(r[t.key])}
        onClick={() => toggle(r, t.key)}
      >
        {t.label(r[t.key])}
      </button>
    </td>
  );

  const propertyCell = (r: EditLayerStateRow, cell: Cell, title: string, text: string) => (
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

  const closePicker = () => {
    const row = picking?.row;
    setPicking(undefined);
    if (row) focusRow(row.key);
  };
  const pickRow = picking?.row;
  const set = (patch: Partial<LayerStateLayer>) => {
    if (pickRow) change(pickRow, patch);
    closePicker();
  };
  const linetypeOf = (h: Handle) => linetypes.find((l) => l.handle === h)?.name ?? '';

  return (
    <Modal
      label="Edit Layer State"
      className="edit-layer-state"
      onOk={() => onOk([...entries])}
      onCancel={onCancel}
    >
      <p className="edit-layer-state-name">Layer state: {stateName}</p>
      <div className="edit-layer-state-body">
        <div className="layer-states-list edit-layer-state-list">
          <table role="grid" aria-label="Layers in layer state" aria-multiselectable="true">
            <thead>
              <tr>
                <th scope="col">Name</th>
                {TOGGLES.map((t) => (
                  <th key={t.key} scope="col">
                    {t.title}
                  </th>
                ))}
                <th scope="col">Color</th>
                <th scope="col">Linetype</th>
                <th scope="col">Lineweight</th>
                <th scope="col">Transparency</th>
                <th scope="col">Plot Style</th>
                <th scope="col">New VP Freeze</th>
              </tr>
            </thead>
            <tbody ref={listRef} onKeyDown={onListKey}>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  data-key={r.key}
                  tabIndex={r.key === anchor || (anchor === undefined && r === rows[0]) ? 0 : -1}
                  aria-selected={selected.has(r.key)}
                  className={r.inDrawing ? undefined : 'not-in-drawing'}
                  onClick={(e) => select(r, e)}
                >
                  <th scope="row" title={r.inDrawing ? r.name : `${r.name} (not in the drawing)`}>
                    {r.name}
                  </th>
                  {TOGGLES.map((t) => toggleCell(r, t))}
                  {propertyCell(r, 'color', 'Color', r.color.label)}
                  {propertyCell(r, 'linetype', 'Linetype', r.linetype)}
                  {propertyCell(r, 'lineweight', 'Lineweight', r.lineweight)}
                  {propertyCell(r, 'transparency', 'Transparency', String(r.transparency))}
                  <td className="plot-style">{r.plotStyle}</td>
                  {toggleCell(r, NEW_VP_FREEZE)}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="layer-states-empty">
                    No layers in this layer state
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="layer-states-actions">
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={layersToAdd(entries, tables).length === 0}
            onClick={() => setAdding(true)}
          >
            Add layers to layer state
          </button>
          <button type="button" disabled={selected.size === 0} onClick={remove}>
            Remove layers from layer state
          </button>
        </div>
      </div>
      {problem && (
        <p role="alert" className="layer-states-message">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => onOk([...entries])}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {adding && (
        <SelectLayersToAdd
          layers={layersToAdd(entries, tables)}
          onOk={add}
          onCancel={() => setAdding(false)}
        />
      )}
      {picking?.cell === 'color' && (
        <SelectColorDialog
          initial={picking.row.entry.color}
          books={books}
          trueColors
          notByLayer="A layer’s color cannot be ByLayer or ByBlock."
          onOk={(color: Color) => set({ color })}
          onCancel={closePicker}
        />
      )}
      {picking?.cell === 'linetype' && (
        <SelectLinetypeDialog
          initial={
            picking.row.entry.linetype ??
            linetypes.find(
              (l) => l.name.toUpperCase() === picking.row.entry.linetypeName.toUpperCase(),
            )?.handle ??
            ''
          }
          linetypes={linetypes}
          onOk={(linetype) => set({ linetype, linetypeName: linetypeOf(linetype) })}
          onCancel={closePicker}
        />
      )}
      {picking?.cell === 'lineweight' && (
        <LineweightDialog
          units={units}
          initial={picking.row.entry.lineweight}
          onOk={(lineweight: Lineweight) => set({ lineweight })}
          onCancel={closePicker}
        />
      )}
      {picking?.cell === 'transparency' && (
        <LayerTransparencyDialog
          initial={picking.row.transparency}
          onOk={(percent) => set({ transparency: transparencyOf(percent) })}
          onCancel={closePicker}
        />
      )}
    </Modal>
  );
}

/**
 * Select Layers to Add to Layer State: the drawing's layers the state does not name, several
 * picked with Ctrl and Shift (a list box), double-click or OK adds them.
 */
export function SelectLayersToAdd({
  layers,
  onOk,
  onCancel,
}: {
  layers: readonly LayerRecord[];
  onOk: (picked: LayerRecord[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<readonly Handle[]>([]);
  const ok = () => onOk(layers.filter((l) => picked.includes(l.handle)));
  return (
    <Modal
      label="Select Layers to Add to Layer State"
      className="select-layers-to-add"
      onOk={ok}
      onCancel={onCancel}
    >
      <label className="cad-dialog-field select-layers-to-add-list">
        <span>Layers:</span>
        <select
          multiple
          size={Math.min(12, Math.max(4, layers.length))}
          aria-label="Layers"
          autoFocus
          value={[...picked]}
          onChange={(e) =>
            setPicked([...e.currentTarget.selectedOptions].map((o) => o.value as Handle))
          }
          onDoubleClick={ok}
        >
          {layers.map((l) => (
            <option key={l.handle} value={l.handle}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" disabled={picked.length === 0} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
