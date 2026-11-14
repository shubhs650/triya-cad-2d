// The View Manager (M2-47 part 2), VIEW's dialog, with AutoCAD 2024's structure and labels
// (UI_SPEC.md §7): the Views tree (Current, Model Views, Layout Views), the selected view's
// properties, Set Current, New... and Delete, and OK, Cancel and Apply. "Current View: <name>"
// names the view Set Current chose, which OK and Apply restore in the space shown; Cancel (and
// Esc) restores nothing. New..., Delete and a changed Name are each a VIEW undo step at once, as
// in AutoCAD, where Cancel does not bring a deleted view back (AutoCAD 2024 Help, "View Manager
// Dialog Box", does not say; the drafter's expectation is that a deleted view stays deleted).
// A view of the other space is listed but cannot be set current from this one: a model view in a
// layout restores into a floating viewport, which waits on MSPACE (M6-02).
//
// New... opens New View / Shot Properties: View name and Boundary, Current display or Define
// window. Define window hides both dialogs and VIEW asks for the corners at the command line, then
// shows them again with that window (as PLOT's Window< does). A name the drawing has asks whether
// to replace that view first.
//
// Edit Boundaries... (part 5) hides the dialog in the same way and VIEW shows the selected view
// and asks for its new boundary at the command line (`editBoundary` in the engine's file.ts); the
// window accepted with Enter becomes the view's, a VIEW undo step at once as New... is. Only a
// view Set Current could restore can be edited: one of the space shown, looking straight down.
// Update Layers waits (layer snapshots are layer states, M5-07); Preset Views are 3D.
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { validViewName, type ChangeSet, type ViewRecord, type ViewState } from '@triya/engine';
import { Modal } from './AttributeDialogs';
import { controllerOf } from './canvas/registry';
import { stateOf } from './canvas/view-host';
import { namedView } from './canvas/views';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { drawingViews } from './saved-views';
import {
  boundaryOf,
  currentRows,
  isPaperView,
  pickedWindow,
  viewManager,
  viewRows,
  viewTree,
  type ManagerState,
  type NewViewState,
  type ViewRow,
} from './view-manager';

const CURRENT = 'current';
const keyOf = (v: ViewRecord) => `${isPaperView(v) ? 'layout' : 'model'}:${v.name.toUpperCase()}`;

export function ViewManager({
  doc,
  changes,
  edited,
}: {
  doc: OpenDocument | undefined;
  /** The drawing's change log: the views saved, renamed and deleted since it opened. */
  changes: readonly ChangeSet[];
  edited: (id: number) => void;
}) {
  const open = useSyncExternalStore(viewManager.subscribe, viewManager.get);
  if (!doc || open !== doc.id) return null;
  return <ManagerBody key={doc.id} doc={doc} changes={changes} edited={edited} />;
}

function ManagerBody({
  doc,
  changes,
  edited,
}: {
  doc: OpenDocument;
  changes: readonly ChangeSet[];
  edited: (id: number) => void;
}) {
  const kept = viewManager.resume(doc.id, doc.block);
  const [state, setState] = useState<ManagerState>(
    () =>
      // Esc at Define window's corners with no window picked before goes back to Current display.
      // Edit Boundaries' window is taken by the effect below, once.
      (kept && {
        ...withoutEditing(kept),
        creating: kept.creating && {
          ...kept.creating,
          boundary: kept.creating.window ? kept.creating.boundary : 'display',
        },
      }) ?? { selected: CURRENT, current: undefined, creating: undefined },
  );
  const [message, setMessage] = useState<string | undefined>();
  // The New View dialog opens over the View Manager: shown again after Define window, both mount
  // at once and a child's effect runs first, so it waits for the View Manager to be shown.
  const [shownOnce, setShownOnce] = useState(false);
  useEffect(() => setShownOnce(true), []);
  // The tree item to move the keyboard focus to once drawn (the arrow keys, after a Delete).
  const [focusKey, setFocusKey] = useState<string | undefined>();
  useEffect(() => {
    if (focusKey === undefined) return;
    document.getElementById(treeId(focusKey))?.focus();
    setFocusKey(undefined);
  }, [focusKey]);
  const set = (p: Partial<ManagerState>) => setState((s) => ({ ...s, ...p }));
  // Shown again after Edit Boundaries: the window accepted becomes the view's boundary.
  const [boundaryEdit] = useState(() => kept?.editing);

  const ctl = controllerOf(doc.id, doc.block);
  const inLayout = doc.block !== doc.opened.modelSpace;
  const views = drawingViews(doc.opened.init, changes);
  const tree = viewTree(views);
  const byKey = new Map(views.map((v) => [keyOf(v), v]));
  const selected = byKey.get(state.selected);
  const order = [CURRENT, ...tree.model.map(keyOf), ...tree.layout.map(keyOf)];

  /** Why the selected view cannot be set current, or undefined when it can. */
  const notCurrent = (v: ViewRecord | undefined): string | undefined => {
    if (!v) return 'Select a named view';
    if (isPaperView(v) !== inLayout) {
      return inLayout
        ? 'A model view is restored on the Model tab'
        : 'A layout view is restored in its layout';
    }
    if (!ctl || !namedView(v, ctl.size)) return 'Not a plan view; 3D and twisted views come later';
    return undefined;
  };

  const restore = () => {
    const v = state.current ? byKey.get(state.current) : undefined;
    const now = controllerOf(doc.id, doc.block);
    const t = v && now && namedView(v, now.size);
    if (now && t) now.show(t);
  };

  const run = async (edit: Parameters<typeof engines.edit>[1]): Promise<boolean> => {
    const r = await engines.edit(doc.id, edit);
    if (!r.ok) {
      setMessage(r.message);
      return false;
    }
    setMessage(undefined);
    edited(doc.id);
    return true;
  };

  const remove = async () => {
    if (!selected) return;
    const at = order.indexOf(state.selected);
    if (!(await run({ kind: 'view-delete', name: selected.name }))) return;
    const next = order.filter((k) => k !== state.selected)[Math.min(at, order.length - 2)];
    set({
      selected: next ?? CURRENT,
      current: state.current === state.selected ? undefined : state.current,
    });
    setFocusKey(next ?? CURRENT);
  };

  const rename = async (to: string) => {
    if (!selected || to === selected.name) return;
    if (await run({ kind: 'view-rename', name: selected.name, newName: to })) {
      const key = `${isPaperView(selected) ? 'layout' : 'model'}:${to.trim().toUpperCase()}`;
      set({
        selected: key,
        current: state.current === state.selected ? key : state.current,
      });
    }
  };

  useEffect(() => {
    const v = boundaryEdit?.window && byKey.get(boundaryEdit.key);
    const view = v && boundaryEdit.window && pickedWindow(boundaryEdit.window, isPaperView(v));
    if (v && view) void run({ kind: 'view', name: v.name, view });
    // Once, as the dialog shows again.
  }, []);

  const editBoundaries = () => {
    if (!selected) return;
    viewManager.pickWindow(
      doc.id,
      doc.block,
      { ...state, editing: { key: state.selected } },
      boundaryOf(selected),
    );
  };

  const ok = () => {
    restore();
    viewManager.close();
  };

  const onTreeKey = (e: KeyboardEvent) => {
    const at = order.indexOf(state.selected);
    const move = (i: number) => {
      e.preventDefault();
      const key = order[Math.max(0, Math.min(order.length - 1, i))]!;
      set({ selected: key });
      setFocusKey(key);
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(order.length - 1);
    else if (e.key === 'Delete' && selected) {
      e.preventDefault();
      void remove();
    }
  };

  const item = (key: string, label: string, level: number) => (
    <div
      key={key}
      id={treeId(key)}
      role="treeitem"
      aria-level={level}
      aria-selected={state.selected === key}
      tabIndex={state.selected === key ? 0 : -1}
      className="view-manager-item"
      onClick={() => set({ selected: key })}
      onDoubleClick={() => {
        // A double click sets a view current, as in AutoCAD's tree.
        const v = byKey.get(key);
        if (v && !notCurrent(v)) set({ selected: key, current: key });
      }}
    >
      {label}
    </div>
  );

  const folder = (label: string, list: readonly ViewRecord[]) => (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded
      aria-selected={false}
      className="view-manager-folder"
    >
      <span>{label}</span>
      <div role="group">
        {list.map((v) => item(keyOf(v), v.name, 2))}
        {list.length === 0 && <div className="view-manager-empty">(none)</div>}
      </div>
    </div>
  );

  const shown: ViewState | undefined = ctl && stateOf(ctl);
  const rows: ViewRow[] = selected ? viewRows(selected) : shown ? currentRows(shown) : [];
  const currentName = state.current ? byKey.get(state.current)?.name : undefined;
  const why = notCurrent(selected);

  return (
    <Modal
      label="View Manager"
      className="view-manager"
      onOk={ok}
      onCancel={() => viewManager.close()}
    >
      <p className="view-manager-current">{`Current View: ${currentName ?? 'Current'}`}</p>
      <div className="view-manager-body">
        <div role="tree" aria-label="Views" className="view-manager-tree" onKeyDown={onTreeKey}>
          {item(CURRENT, 'Current', 1)}
          {folder('Model Views', tree.model)}
          {folder('Layout Views', tree.layout)}
        </div>
        <table className="view-manager-props" aria-label="View properties">
          <tbody>
            {rows.flatMap((r, i) => [
              ...(i === 0 || rows[i - 1]!.group !== r.group
                ? [
                    <tr key={`group:${r.group}`} className="view-manager-group">
                      <th scope="colgroup" colSpan={2}>
                        {r.group}
                      </th>
                    </tr>,
                  ]
                : []),
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>
                  {r.label === 'Name' && selected ? (
                    <NameField
                      key={selected.handle + selected.name}
                      name={selected.name}
                      onRename={rename}
                    />
                  ) : (
                    r.value
                  )}
                </td>
              </tr>,
            ])}
          </tbody>
        </table>
        <div className="view-manager-actions">
          <button
            type="button"
            disabled={why !== undefined}
            title={selected ? why : undefined}
            onClick={() => set({ current: state.selected })}
          >
            Set Current
          </button>
          <button
            type="button"
            onClick={() => set({ creating: { name: '', boundary: 'display' } })}
          >
            New...
          </button>
          <button
            type="button"
            disabled={why !== undefined}
            title={selected ? why : undefined}
            onClick={editBoundaries}
          >
            Edit Boundaries...
          </button>
          <button type="button" disabled={!selected} onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>
      {message && (
        <p role="alert" className="view-manager-message">
          {message}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => viewManager.close()}>
          Cancel
        </button>
        <button type="button" onClick={restore}>
          Apply
        </button>
      </div>
      {shownOnce && state.creating && (
        <NewView
          value={state.creating}
          paper={inLayout}
          existing={views}
          shown={shown}
          onChange={(creating) => set({ creating })}
          onDefineWindow={(creating) =>
            viewManager.pickWindow(doc.id, doc.block, { ...state, creating })
          }
          onSave={async (name, view) => {
            if (!(await run({ kind: 'view', name, view }))) return;
            set({
              creating: undefined,
              selected: `${view.paper ? 'layout' : 'model'}:${name.toUpperCase()}`,
            });
          }}
          onCancel={() => set({ creating: undefined })}
        />
      )}
    </Modal>
  );
}

const withoutEditing = ({ editing: _, ...rest }: ManagerState): ManagerState => rest;

const treeId = (key: string) =>
  `view-manager-${key.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0)}`)}`;

/** The Name row: changed on Enter or when it loses focus; Esc puts the name back. */
function NameField({ name, onRename }: { name: string; onRename: (to: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      aria-label="Name"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => onRename(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          onRename(text);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setText(name);
        }
      }}
    />
  );
}

function NewView({
  value,
  paper,
  existing,
  shown,
  onChange,
  onDefineWindow,
  onSave,
  onCancel,
}: {
  value: NewViewState;
  /** A layout is shown: the view is a layout view. */
  paper: boolean;
  existing: readonly ViewRecord[];
  shown: ViewState | undefined;
  onChange: (v: NewViewState) => void;
  onDefineWindow: (v: NewViewState) => void;
  onSave: (name: string, view: ViewState) => void;
  onCancel: () => void;
}) {
  const [problem, setProblem] = useState<string | undefined>();
  const [replacing, setReplacing] = useState<string | undefined>();
  const set = (p: Partial<NewViewState>) => onChange({ ...value, ...p });
  const view = (): ViewState | undefined =>
    value.boundary === 'window'
      ? value.window && pickedWindow(value.window, paper)
      : shown && { ...shown, paper };
  const ok = () => {
    const name = value.name.trim();
    if (!validViewName(name)) return setProblem('Invalid view name.');
    const v = view();
    if (!v) return setProblem('There is no view to save.');
    const same = existing.find((e) => e.name.toUpperCase() === name.toUpperCase());
    if (same && replacing === undefined) return setReplacing(same.name);
    onSave(name, v);
  };
  const w = value.window && pickedWindow(value.window, paper);
  return (
    <Modal label="New View / Shot Properties" className="new-view" onOk={ok} onCancel={onCancel}>
      <label className="cad-dialog-field">
        <span>View name:</span>
        <input
          aria-label="View name"
          autoFocus
          value={value.name}
          onChange={(e) => {
            setProblem(undefined);
            setReplacing(undefined);
            set({ name: e.currentTarget.value });
          }}
        />
      </label>
      <fieldset className="new-view-boundary">
        <legend>Boundary</legend>
        <div role="radiogroup" aria-label="Boundary">
          <label className="cad-dialog-check">
            <input
              type="radio"
              name="new-view-boundary"
              checked={value.boundary === 'display'}
              onChange={() => set({ boundary: 'display' })}
            />
            Current display
          </label>
          <div className="new-view-window-row">
            <label className="cad-dialog-check">
              <input
                type="radio"
                name="new-view-boundary"
                checked={value.boundary === 'window'}
                onChange={() =>
                  // As in AutoCAD, choosing it asks for the window straight away.
                  value.window
                    ? set({ boundary: 'window' })
                    : onDefineWindow({ ...value, boundary: 'window' })
                }
              />
              Define window
            </label>
            <button
              type="button"
              disabled={value.boundary !== 'window'}
              onClick={() => onDefineWindow(value)}
            >
              Define view window
            </button>
          </div>
        </div>
        {value.boundary === 'window' && w && (
          <p className="new-view-window">{`Window: ${w.width.toFixed(4)} × ${w.height.toFixed(4)}`}</p>
        )}
      </fieldset>
      {problem && (
        <p role="alert" className="view-manager-message">
          {problem}
        </p>
      )}
      {replacing !== undefined && (
        <div role="alertdialog" aria-label="View - Replace" className="new-view-replace">
          <p>{`A view named "${replacing}" already exists. Do you want to replace it?`}</p>
          <button
            type="button"
            autoFocus
            onClick={() => {
              const v = view();
              if (v) onSave(value.name.trim(), v);
            }}
          >
            Yes
          </button>
          <button type="button" onClick={() => setReplacing(undefined)}>
            No
          </button>
        </div>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
