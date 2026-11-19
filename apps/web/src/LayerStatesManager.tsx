// The Layer States Manager (M5-07 part 2), LAYERSTATE's dialog (and the Layer Properties
// Manager's Layer States Manager button), with AutoCAD 2024's structure and labels (UI_SPEC.md
// §7; AutoCAD Help, "Layer States Manager Dialog Box"):
//
//   - Layer states: Name, Space, Same as DWG and Description; a row is selected by a click or the
//     arrow keys, F2 renames it in place, Delete deletes it.
//   - New... opens New Layer State to Save (name and description); a name the drawing has asks
//     whether to overwrite that state. Update saves the layers as they are now into the selected
//     state. Rename, Delete, Import... (a `.las` file; a state of the same name asks to be
//     overwritten) and Export... (the selected state as `<name>.las`).
//   - Restore Options: "Turn off layers not found in layer state"; "Apply properties as viewport
//     overrides" waits for a layout viewport to be made current (MSPACE, M6-02).
//   - More Restore Options shows the Layer Properties to Restore, the selected state's own: a
//     change is saved with it at once, with Select All and Clear All.
//   - Restore restores the selected state and closes the dialog; Close closes it.
//
// Each change is one LAYERSTATE undo step at once, as AutoCAD's: Close does not take them back.
// Edit... opens Edit Layer State (M5-07 part 3, `EditLayerState.tsx`): the selected state's
// layers and their settings, saved by its OK.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import {
  LAYER_STATE_MASK,
  type EngineEdit,
  type Handle,
  type LayerStateLayer,
} from '@triya/engine';
import { LasError, parseLas, writeLas } from '@triya/io';
import { Modal } from './AttributeDialogs';
import type { OpenDocument } from './documents';
import { drafting } from './drafting';
import { EditLayerState } from './EditLayerState';
import { engines } from './engine/registry';
import { alertLayers, layerNotices } from './layer-notice';
import {
  RESTORE_PROPERTIES,
  allRestoreProperties,
  drawingLayerStates,
  lasFileName,
  layerStateRows,
  layerStateTables,
  layerStatesManager,
  withRestoreProperty,
  type LayerStateRow,
} from './layer-states';
import { layerColorBooks, layerLinetypes } from './layers';
import { download } from './PlotDialog';

export function LayerStatesManager({
  doc,
  edited,
}: {
  doc: OpenDocument | undefined;
  edited: (id: number) => void;
}) {
  const open = useSyncExternalStore(layerStatesManager.subscribe, layerStatesManager.get);
  if (!doc || open !== doc.id) return null;
  return <ManagerBody key={doc.id} doc={doc} edited={edited} />;
}

/** Import's question before going on: whether to overwrite a state of the same name. */
type Asking = { readonly name: string; readonly yes: () => void; readonly no: () => void };

function ManagerBody({ doc, edited }: { doc: OpenDocument; edited: (id: number) => void }) {
  const tables = useMemo(
    () => layerStateTables(doc.opened.init, engines.changesOf(doc.id)),
    // `revision` changes when the engine applied an edit, which is what the list reads.
    [doc.opened, doc.id, doc.revision],
  );
  const rows = useMemo(
    () => layerStateRows(drawingLayerStates(doc.opened.init, engines.changesOf(doc.id)), tables),
    [doc.opened, doc.id, doc.revision, tables],
  );
  const [selectedHandle, setSelectedHandle] = useState<Handle | undefined>(
    () => (rows.find((r) => r.lastRestored) ?? rows[0])?.handle,
  );
  const selected = rows.find((r) => r.handle === selectedHandle);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState<Asking | undefined>();
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editProblem, setEditProblem] = useState<string | undefined>();
  const lwUnits = useSyncExternalStore(drafting.subscribe, () =>
    drafting.get().lwUnits === 0 ? 'in' : 'mm',
  );
  const [turnOffMissing, setTurnOffMissing] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLTableSectionElement>(null);

  const run = async (edit: EngineEdit): Promise<boolean> => {
    const r = await engines.edit(doc.id, edit);
    if (!r.ok) {
      setMessage({ text: r.message, problem: true });
      return false;
    }
    setMessage(undefined);
    edited(doc.id);
    return true;
  };

  const focusRow = (h: Handle) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`tr[data-handle="${h}"]`)?.focus(),
    );

  const save = async (name: string, description: string) => {
    if (!(await run({ kind: 'layer-state-save', name, description }))) return false;
    setCreating(false);
    return true;
  };

  // A state just saved or imported is selected once the list has it.
  const [selectName, setSelectName] = useState<string | undefined>();
  useEffect(() => {
    if (selectName === undefined) return;
    const r = rows.find((x) => x.name.toUpperCase() === selectName.toUpperCase());
    if (r) {
      setSelectedHandle(r.handle);
      setSelectName(undefined);
      focusRow(r.handle);
    }
  }, [rows, selectName]);

  const update = async () => {
    if (!selected) return;
    if (await run({ kind: 'layer-state-save', name: selected.name })) {
      setMessage({ text: `Layer state "${selected.name}" updated.`, problem: false });
    }
  };

  const remove = async () => {
    if (!selected) return;
    const at = rows.indexOf(selected);
    if (!(await run({ kind: 'layer-state-delete', state: selected.handle }))) return;
    const next = rows.filter((r) => r !== selected)[Math.min(at, rows.length - 2)];
    setSelectedHandle(next?.handle);
    if (next) focusRow(next.handle);
  };

  const rename = async (to: string) => {
    setRenaming(false);
    if (!selected || to === selected.name) return;
    await run({ kind: 'layer-state-edit', state: selected.handle, name: to });
    focusRow(selected.handle);
  };

  const saveLayers = async (layers: LayerStateLayer[]) => {
    if (!selected) return;
    const r = await engines.edit(doc.id, {
      kind: 'layer-state-edit',
      state: selected.handle,
      layers,
    });
    if (!r.ok) {
      setEditProblem(r.message);
      return;
    }
    setEditProblem(undefined);
    setEditing(false);
    edited(doc.id);
    setMessage({ text: `Layer state "${selected.name}" edited.`, problem: false });
    focusRow(selected.handle);
  };

  const setMask = (row: LayerStateRow, mask: number) => {
    if (mask !== row.mask) void run({ kind: 'layer-state-edit', state: row.handle, mask });
  };

  const restore = async () => {
    if (!selected) return;
    if (await run({ kind: 'layer-state-restore', state: selected.handle, turnOffMissing })) {
      layerStatesManager.close();
      // A layer state restored alerts for unreconciled new layers (LAYERNOTIFY 8, M5-19 part 4).
      layerNotices.raise(
        doc.id,
        alertLayers(doc.opened.init, engines.changesOf(doc.id), 'layer-state'),
      );
    }
  };

  const exportState = () => {
    if (!selected) return;
    const text = writeLas(tables, selected.state);
    download(lasFileName(selected.name), new TextEncoder().encode(text), 'text/plain');
    setMessage({ text: `Layer state "${selected.name}" exported.`, problem: false });
  };

  const importFile = async (file: File) => {
    let states;
    try {
      states = parseLas(await file.text());
    } catch (e) {
      const why = e instanceof LasError ? e.message : 'The file could not be read.';
      setMessage({ text: `${file.name}: ${why}`, problem: true });
      return;
    }
    const imported: string[] = [];
    // One after another: a name the drawing has asks first, as AutoCAD's Import does.
    const next = async (i: number): Promise<void> => {
      const s = states[i];
      if (!s) {
        setAsking(undefined);
        if (imported.length > 0) {
          setSelectName(imported.at(-1));
          setMessage({
            text: `Layer state${imported.length > 1 ? 's' : ''} imported: ${imported.join(', ')}.`,
            problem: false,
          });
        }
        return;
      }
      const take = async (replace: boolean) => {
        if (await run({ kind: 'layer-state-import', state: s, ...(replace && { replace }) }))
          imported.push(s.name);
        await next(i + 1);
      };
      const clash = rows.find((r) => r.name.toUpperCase() === s.name.toUpperCase());
      if (clash) {
        setAsking({
          name: s.name,
          yes: () => void take(true),
          no: () => void next(i + 1),
        });
      } else await take(false);
    };
    await next(0);
  };

  const onListKey = (e: KeyboardEvent) => {
    if (renaming) return;
    const at = selected ? rows.indexOf(selected) : -1;
    const go = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      e.preventDefault();
      setSelectedHandle(r.handle);
      focusRow(r.handle);
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'F2' && selected) {
      e.preventDefault();
      setRenaming(true);
    } else if (e.key === 'Delete' && selected) {
      e.preventDefault();
      void remove();
    }
  };

  const mask = selected?.mask ?? 0;
  return (
    <Modal
      label="Layer States Manager"
      className="layer-states-manager"
      onOk={() => void restore()}
      onCancel={() => layerStatesManager.close()}
    >
      <div className="layer-states-body">
        <div className="layer-states-list">
          <table aria-label="Layer states">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Space</th>
                <th scope="col">Same as DWG</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody ref={listRef} onKeyDown={onListKey}>
              {rows.map((r) => (
                <tr
                  key={r.handle}
                  data-handle={r.handle}
                  tabIndex={r === selected || (!selected && r === rows[0]) ? 0 : -1}
                  aria-selected={r === selected}
                  onClick={() => setSelectedHandle(r.handle)}
                  onDoubleClick={() => {
                    setSelectedHandle(r.handle);
                    setRenaming(true);
                  }}
                >
                  <th scope="row">
                    {renaming && r === selected ? (
                      <RenameField name={r.name} onDone={(to) => void rename(to)} />
                    ) : (
                      r.name
                    )}
                  </th>
                  <td>{r.space}</td>
                  <td>{r.same ? 'Yes' : 'No'}</td>
                  <td>{r.description}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="layer-states-empty">
                    No layer states saved
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="layer-states-actions">
          <button
            type="button"
            onClick={() => {
              setMessage(undefined);
              setCreating(true);
            }}
          >
            New...
          </button>
          <button type="button" disabled={!selected} onClick={() => void update()}>
            Update
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={!selected}
            onClick={() => {
              setEditProblem(undefined);
              setEditing(true);
            }}
          >
            Edit...
          </button>
          <button type="button" disabled={!selected} onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" disabled={!selected} onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import...
          </button>
          <button type="button" disabled={!selected} onClick={exportState}>
            Export...
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".las"
            hidden
            aria-label="Layer state file to import"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) void importFile(f);
            }}
          />
        </div>
      </div>
      <fieldset className="layer-states-options">
        <legend>Restore options</legend>
        <label>
          <input
            type="checkbox"
            checked={turnOffMissing}
            onChange={(e) => setTurnOffMissing(e.currentTarget.checked)}
          />
          Turn off layers not found in layer state
        </label>
        <label title="Waits for a layout viewport to be made current (MSPACE)">
          <input type="checkbox" disabled checked={false} readOnly />
          Apply properties as viewport overrides
        </label>
      </fieldset>
      <button
        type="button"
        className="layer-states-more"
        aria-expanded={more}
        aria-controls="layer-states-restore"
        onClick={() => setMore((m) => !m)}
      >
        {more ? 'Fewer Restore Options' : 'More Restore Options'}
      </button>
      {more && (
        <fieldset id="layer-states-restore" className="layer-states-restore" disabled={!selected}>
          <legend>Layer properties to restore</legend>
          <div className="layer-states-properties">
            {RESTORE_PROPERTIES.map((p) => (
              <label key={p.bit}>
                <input
                  type="checkbox"
                  checked={(mask & p.bit) !== 0}
                  onChange={(e) =>
                    selected &&
                    setMask(selected, withRestoreProperty(mask, p.bit, e.currentTarget.checked))
                  }
                />
                {p.label}
              </label>
            ))}
          </div>
          <div className="layer-states-select">
            <button
              type="button"
              disabled={(mask & LAYER_STATE_MASK.all) === LAYER_STATE_MASK.all}
              onClick={() => selected && setMask(selected, allRestoreProperties(mask, true))}
            >
              Select All
            </button>
            <button
              type="button"
              disabled={(mask & LAYER_STATE_MASK.all) === 0}
              onClick={() => selected && setMask(selected, allRestoreProperties(mask, false))}
            >
              Clear All
            </button>
          </div>
        </fieldset>
      )}
      {message && (
        <p role={message.problem ? 'alert' : 'status'} className="layer-states-message">
          {message.text}
        </p>
      )}
      {asking && <Overwrite name={asking.name} onYes={asking.yes} onNo={asking.no} />}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!selected} onClick={() => void restore()}>
          Restore
        </button>
        <button type="button" onClick={() => layerStatesManager.close()}>
          Close
        </button>
      </div>
      {editing && selected && (
        <EditLayerState
          stateName={selected.name}
          layers={selected.state.layers}
          tables={tables}
          linetypes={layerLinetypes(doc.opened.init, engines.changesOf(doc.id))}
          books={layerColorBooks(doc.opened.init, engines.changesOf(doc.id))}
          units={lwUnits}
          problem={editProblem}
          onOk={(layers) => void saveLayers(layers)}
          onCancel={() => {
            setEditing(false);
            focusRow(selected.handle);
          }}
        />
      )}
      {creating && (
        <NewLayerState
          existing={(name) => rows.find((r) => r.name.toUpperCase() === name.toUpperCase())?.name}
          onSave={(name, description) =>
            void save(name, description).then((ok) => ok && setSelectName(name))
          }
          problem={message?.problem ? message.text : undefined}
          onCancel={() => {
            setCreating(false);
            setMessage(undefined);
          }}
        />
      )}
    </Modal>
  );
}

/** "Do you want to overwrite it?", asked in the dialog that asks it. */
function Overwrite({ name, onYes, onNo }: { name: string; onYes: () => void; onNo: () => void }) {
  return (
    <div role="alertdialog" aria-label="Layer State - Overwrite" className="new-view-replace">
      <p>{`The layer state "${name}" already exists. Do you want to overwrite it?`}</p>
      <button type="button" autoFocus onClick={onYes}>
        Yes
      </button>
      <button type="button" onClick={onNo}>
        No
      </button>
    </div>
  );
}

/** A state's name typed in place: Enter or leaving the field renames, Esc keeps the name. */
function RenameField({ name, onDone }: { name: string; onDone: (to: string) => void }) {
  const [text, setText] = useState(name);
  const done = useRef(false);
  const finish = (to: string) => {
    if (done.current) return;
    done.current = true;
    onDone(to);
  };
  return (
    <input
      aria-label={`Name of ${name}`}
      autoFocus
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => finish(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(name);
        }
      }}
    />
  );
}

/**
 * New Layer State to Save: the name and description of the state New saves. A name the drawing
 * has asks whether to overwrite that state first.
 */
export function NewLayerState({
  existing,
  problem,
  onSave,
  onCancel,
}: {
  /** Why the name was refused. */
  problem: string | undefined;
  /** The name of the drawing's state so named (case ignored), if any. */
  existing: (name: string) => string | undefined;
  onSave: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [overwriting, setOverwriting] = useState<string | undefined>();
  const ok = () => {
    const n = name.trim();
    if (n === '') return;
    const clash = existing(n);
    if (clash !== undefined) setOverwriting(clash);
    else onSave(n, description);
  };
  return (
    <Modal
      label="New Layer State to Save"
      className="new-layer-state"
      onOk={ok}
      onCancel={onCancel}
    >
      <label className="cad-dialog-field">
        New layer state name:
        <input autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label className="cad-dialog-field">
        Description
        <input value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      </label>
      {problem && (
        <p role="alert" className="layer-states-message">
          {problem}
        </p>
      )}
      {overwriting !== undefined && (
        <Overwrite
          name={overwriting}
          onYes={() => {
            setOverwriting(undefined);
            onSave(name.trim(), description);
          }}
          onNo={() => setOverwriting(undefined)}
        />
      )}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={name.trim() === ''} onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
