// CLASSICGROUP's Object Grouping dialog (M3-08), the drawing's named groups with AutoCAD 2024's
// structure and labels (AutoCAD Help, "Object Grouping Dialog Box", "Order Group Dialog Box";
// UI_SPEC.md §7):
//
//   Group Name / Selectable list (alphabetical; unnamed groups with Include Unnamed)
//   Group Identification: Group Name, Description, Find Name <, Highlight <, Include Unnamed
//   Create Group: New <, Selectable, Unnamed
//   Change Group: Remove <, Add <, Rename, Re-Order..., Description, Explode, Selectable
//   OK, Cancel
//
// A button that picks in the drawing (the `<` ones) closes the dialog until the pick is made,
// then CLASSICGROUP opens it again on the same group; every change is made at once, as
// AutoCAD's are, so Cancel (or Esc) only closes it. Find Name's Group Member List and a refused
// name show as a line under the list. Re-Order... opens Order Group over it.
import type { DialogRequest, GroupRow, GroupingAction, PromptAnswer } from '@triya/engine';
import { useState, type KeyboardEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'objectgrouping' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

export function ObjectGroupingDialog({ doc, request }: { doc: number; request: Request }) {
  const [includeUnnamed, setIncludeUnnamed] = useState(request.includeUnnamed);
  const rows = request.groups.filter((g) => includeUnnamed || !g.unnamed);
  const initial = rows.find((g) => g.name === request.selected);
  const [selected, setSelected] = useState<GroupRow | undefined>(initial);
  const [name, setName] = useState(initial?.unnamed ? '' : (initial?.name ?? ''));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [newSelectable, setNewSelectable] = useState(true);
  const [unnamed, setUnnamed] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const pick = (g: GroupRow | undefined) => {
    setSelected(g);
    setName(g && !g.unnamed ? g.name : '');
    setDescription(g?.description ?? '');
  };
  const send = (grouping: GroupingAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', grouping, includeUnnamed });
  const ok = () => answer(doc, { kind: 'dialog', action: 'ok', includeUnnamed });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const group = selected?.name ?? '';
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = selected ? rows.indexOf(selected) : -1;
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) pick(next);
  };

  return (
    <Modal label="Object Grouping" className="grouping-dialog" onOk={ok} onCancel={cancel}>
      <table className="eattedit-list grouping-list" aria-label="Groups">
        <thead>
          <tr>
            <th>Group Name</th>
            <th>Selectable</th>
          </tr>
        </thead>
        <tbody tabIndex={0} onKeyDown={keys}>
          {rows.map((g) => (
            <tr
              key={g.name}
              aria-selected={g === selected}
              onClick={() => pick(g)}
              data-testid={`group-${g.name}`}
            >
              <td>{g.name}</td>
              <td>{g.selectable ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(request.note !== undefined || request.memberOf) && (
        <p className="grouping-note" role="status">
          {request.note ??
            (request.memberOf!.length > 0
              ? `Group Member List: ${request.memberOf!.join(', ')}`
              : 'Not a group member.')}
        </p>
      )}
      <fieldset>
        <legend>Group Identification</legend>
        <label className="cad-dialog-field">
          <span>Group Name:</span>
          <input
            type="text"
            value={name}
            maxLength={31}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="cad-dialog-field">
          <span>Description:</span>
          <input
            type="text"
            value={description}
            maxLength={64}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="cad-dialog-buttons grouping-row">
          <button type="button" onClick={() => send({ op: 'find' })}>
            Find Name &lt;
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => send({ op: 'highlight', group })}
          >
            Highlight &lt;
          </button>
          <label className="cad-dialog-check">
            <input
              type="checkbox"
              checked={includeUnnamed}
              onChange={(e) => {
                setIncludeUnnamed(e.target.checked);
                if (!e.target.checked && selected?.unnamed) pick(undefined);
              }}
            />
            Include Unnamed
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Create Group</legend>
        <div className="cad-dialog-buttons grouping-row">
          <button
            type="button"
            onClick={() =>
              send({ op: 'new', name, description, selectable: newSelectable, unnamed })
            }
          >
            New &lt;
          </button>
          <label className="cad-dialog-check">
            <input
              type="checkbox"
              checked={newSelectable}
              onChange={(e) => setNewSelectable(e.target.checked)}
            />
            Selectable
          </label>
          <label className="cad-dialog-check">
            <input
              type="checkbox"
              checked={unnamed}
              onChange={(e) => setUnnamed(e.target.checked)}
            />
            Unnamed
          </label>
        </div>
      </fieldset>
      <fieldset disabled={!selected}>
        <legend>Change Group</legend>
        <div className="cad-dialog-buttons grouping-row">
          <button type="button" onClick={() => send({ op: 'remove', group })}>
            Remove &lt;
          </button>
          <button type="button" onClick={() => send({ op: 'add', group })}>
            Add &lt;
          </button>
          <button type="button" onClick={() => send({ op: 'rename', group, name })}>
            Rename
          </button>
          <button type="button" onClick={() => setOrdering(true)}>
            Re-Order...
          </button>
        </div>
        <div className="cad-dialog-buttons grouping-row">
          <button type="button" onClick={() => send({ op: 'description', group, description })}>
            Description
          </button>
          <button type="button" onClick={() => send({ op: 'explode', group })}>
            Explode
          </button>
          <button
            type="button"
            onClick={() => send({ op: 'selectable', group, selectable: !selected?.selectable })}
          >
            Selectable
          </button>
        </div>
      </fieldset>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
      {ordering && selected && (
        <OrderGroup row={selected} onClose={() => setOrdering(false)} send={send} />
      )}
    </Modal>
  );
}

/**
 * Order Group (AutoCAD Help, "Order Group Dialog Box"): objects are numbered from 0; Re-Order
 * moves "Number of objects" from "Remove from position" to "Enter new position number";
 * Reverse Order reverses the whole group.
 */
function OrderGroup({
  row,
  onClose,
  send,
}: {
  row: GroupRow;
  onClose: () => void;
  send: (g: GroupingAction) => void;
}) {
  const top = Math.max(0, row.members - 1);
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState('0');
  const [count, setCount] = useState('1');
  const whole = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const f = whole(from, 0, top);
  const t = whole(to, 0, top);
  const c = whole(count, 1, row.members - (f ?? 0));
  const valid = f !== undefined && t !== undefined && c !== undefined;
  const reorder = () => {
    if (valid) send({ op: 'reorder', group: row.name, from: f, to: t, count: c });
  };
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="cad-dialog-field">
      <span>{label}</span>
      <input type="text" inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <Modal label="Order Group" className="grouping-dialog" onOk={reorder} onCancel={onClose}>
      <p>
        {row.name}
        {row.description ? `: ${row.description}` : ''}
      </p>
      {field(`Remove from position (0-${top}):`, from, setFrom)}
      {field(`Enter new position number for the object (0-${top}):`, to, setTo)}
      {field(`Number of objects (1-${row.members}):`, count, setCount)}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={!valid} onClick={reorder}>
          Re-Order
        </button>
        <button type="button" onClick={() => send({ op: 'reverse', group: row.name })}>
          Reverse Order
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
