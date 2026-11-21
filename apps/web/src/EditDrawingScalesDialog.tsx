// SCALELISTEDIT's Edit Drawing Scales dialog (M6-02 part 22), with AutoCAD 2024's structure and
// labels (UI_SPEC.md §7; AutoCAD 2024 Help, "Edit Drawing Scales Dialog Box", "Add Scale Dialog
// Box", "Edit Scale Dialog Box"): the Scale List, Add..., Edit..., Move Up, Move Down, Delete and
// Reset. Add and Edit open their own dialog: "Name appearing in scale list", then the Scale
// Properties, Paper units and Drawing units. A scale an annotative object uses cannot be deleted
// nor have its units changed ("You cannot change the scale properties of a scale referenced by
// an object in the drawing"), and the current one cannot be deleted; Reset "Deletes all custom
// scales and unused scales and restores the default list". OK answers SCALELISTEDIT, which makes
// the list in one undo step; Cancel and Esc change nothing.
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { ScaleListDialogRequest } from '@triya/engine';
import { Modal } from './AttributeDialogs';
import {
  moved,
  reset,
  scaleListDialog,
  scaleOf,
  unitText,
  type DialogScales,
  type ScaleFields,
} from './scale-list-dialog';

export function EditDrawingScalesDialog({ doc }: { doc: number | undefined }) {
  const open = useSyncExternalStore(scaleListDialog.subscribe, scaleListDialog.get);
  if (doc === undefined || open?.doc !== doc) return null;
  return <Body key={doc} request={open.request} />;
}

const IN_USE = {
  current: 'The current annotation scale cannot be deleted.',
  object: 'A scale an annotative object uses cannot be deleted.',
} as const;

function Body({ request }: { request: ScaleListDialogRequest }) {
  const [list, setList] = useState<DialogScales>(request.scales);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<{ index?: number }>();
  const listRef = useRef<HTMLUListElement>(null);
  const row = list[selected];

  const select = (i: number) => {
    const at = Math.max(0, Math.min(list.length - 1, i));
    setSelected(at);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${at}"]`)?.focus();
  };
  const move = (by: -1 | 1) => {
    const next = moved(list, selected, by);
    if (next === list) return;
    setList(next);
    setSelected(selected + by);
  };
  const remove = () => {
    if (!row || row.use !== undefined || list.length === 1) return;
    setList(list.filter((_, i) => i !== selected));
    setSelected(Math.min(selected, list.length - 2));
  };
  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(selected + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? 0 : list.length - 1);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      remove();
    }
  };

  return (
    <Modal
      label="Edit Drawing Scales"
      className="scale-list-dialog"
      onOk={() => scaleListDialog.close(list)}
      onCancel={() => scaleListDialog.close()}
    >
      <div className="page-setup-rows">
        <div>
          <span id="scale-list-label">Scale List</span>
          <ul ref={listRef} role="listbox" aria-labelledby="scale-list-label" onKeyDown={onListKey}>
            {list.map((s, i) => (
              <li
                key={`${s.handle ?? 'new'}-${i}`}
                data-index={i}
                role="option"
                tabIndex={i === selected ? 0 : -1}
                aria-selected={i === selected}
                onClick={() => setSelected(i)}
                onDoubleClick={() => {
                  setSelected(i);
                  setEditing({ index: i });
                }}
              >
                {s.name}
              </li>
            ))}
          </ul>
          <p className="scale-list-units" aria-live="polite">
            {row
              ? `${unitText(row.paperUnits)} paper units = ${unitText(row.drawingUnits)} drawing units`
              : ''}
          </p>
        </div>
        <div className="page-setup-actions">
          <button type="button" aria-haspopup="dialog" onClick={() => setEditing({})}>
            Add...
          </button>
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={!row}
            onClick={() => setEditing({ index: selected })}
          >
            Edit...
          </button>
          <button type="button" disabled={selected <= 0} onClick={() => move(-1)}>
            Move Up
          </button>
          <button type="button" disabled={selected >= list.length - 1} onClick={() => move(1)}>
            Move Down
          </button>
          <button
            type="button"
            disabled={!row || row.use !== undefined || list.length === 1}
            title={row?.use ? IN_USE[row.use] : undefined}
            onClick={remove}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setList(reset(list, request.defaults));
              setSelected(0);
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => scaleListDialog.close(list)}>
          OK
        </button>
        <button type="button" onClick={() => scaleListDialog.close()}>
          Cancel
        </button>
      </div>
      {editing && (
        <ScaleDialog
          list={list}
          index={editing.index}
          onDone={(scale) => {
            setEditing(undefined);
            if (!scale) return;
            if (editing.index === undefined) {
              setList([...list, scale]);
              setSelected(list.length);
            } else {
              setList(list.map((s, i) => (i === editing.index ? { ...s, ...scale } : s)));
            }
          }}
        />
      )}
    </Modal>
  );
}

/** Add Scale (no `index`) or Edit Scale (the entry at `index`). */
function ScaleDialog({
  list,
  index,
  onDone,
}: {
  list: DialogScales;
  index: number | undefined;
  onDone: (
    scale:
      | { readonly name: string; readonly paperUnits: number; readonly drawingUnits: number }
      | undefined,
  ) => void;
}) {
  const was = index === undefined ? undefined : list[index];
  const [fields, setFields] = useState<ScaleFields>({
    name: was?.name ?? '',
    paperUnits: unitText(was?.paperUnits ?? 1),
    drawingUnits: unitText(was?.drawingUnits ?? 1),
  });
  const [problem, setProblem] = useState<string>();
  // "You cannot change the scale properties of a scale referenced by an object in the drawing."
  const fixed = was?.use === 'object';
  const ok = () => {
    const scale = scaleOf(list, fields, index);
    if (typeof scale === 'string') return setProblem(scale);
    // Units left as shown keep the scale's own (a third shows rounded), so an object's scale
    // and an untouched ratio stay as they are.
    const kept = (key: 'paperUnits' | 'drawingUnits') =>
      was && fields[key].trim() === unitText(was[key]) ? was[key] : scale[key];
    onDone({ ...scale, paperUnits: kept('paperUnits'), drawingUnits: kept('drawingUnits') });
  };
  const field = (key: keyof ScaleFields) => ({
    value: fields[key],
    onChange: (e: { target: { value: string } }) => {
      setProblem(undefined);
      setFields({ ...fields, [key]: e.target.value });
    },
  });
  return (
    <Modal
      label={index === undefined ? 'Add Scale' : 'Edit Scale'}
      className="scale-dialog"
      onOk={ok}
      onCancel={() => onDone(undefined)}
    >
      <fieldset className="block-definition-group">
        <legend>Scale Name</legend>
        <label className="cad-dialog-field">
          Name appearing in scale list
          <input type="text" autoFocus {...field('name')} />
        </label>
      </fieldset>
      <fieldset className="block-definition-group" disabled={fixed}>
        <legend>Scale Properties</legend>
        <label className="cad-dialog-field">
          Paper units
          <input type="text" inputMode="decimal" {...field('paperUnits')} />
        </label>
        <label className="cad-dialog-field">
          Drawing units
          <input type="text" inputMode="decimal" {...field('drawingUnits')} />
        </label>
        {fixed && <p>An annotative object uses this scale: its units cannot change.</p>}
      </fieldset>
      {problem && (
        <p role="alert" className="plot-error">
          {problem}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={() => onDone(undefined)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
