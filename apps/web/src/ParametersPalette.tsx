// The Parameters Manager (M9-03 part 5, PARAMETERS): AutoCAD's palette of the drawing's
// dimensional constraints' parameters, by Name, Expression, Value, Type and Description.
// AutoCAD 2024 Help, "Parameters Manager": a name, an expression and a description are edited in
// place; the geometry follows a new expression; renaming a parameter renames it in the
// expressions that use it; Delete removes the selected parameter's constraint, and expressions
// that used it keep its value. A reference constraint's parameter shows what it measures, and its
// expression cannot be edited. The search box narrows the list.
//
// User parameters (part 6): New (AutoCAD's "Creates a new user parameter") adds user1 = 1, the
// next free number after it, and puts its name in edit mode, as AutoCAD does. The table shows
// AutoCAD's two groups, Dimensional Constraint Parameters and then User Parameters, each only
// when it has rows.
//
// The rows come from the drawing's engine while the palette shows it; each edit goes back as one
// undo step, and a refused one (a cycle, a name in use) says why on the command line and the
// row shows its value again.
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { ParameterEdit, ParameterInfo } from '@triya/engine';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { parameterRows, parameterValueText, searchParameters } from './parameters';

/** An in-place cell: Enter or leaving it commits a change, Esc puts the value back. */
function EditCell({
  value,
  label,
  readOnly,
  sent,
  onCommit,
}: {
  value: string;
  label: string;
  readOnly?: boolean;
  /** The rows the cell's value came with: each new send shows the value again. */
  sent: unknown;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // The engine's next rows show what the edit made, or put back a refused one (the same value).
  useEffect(() => setDraft(value), [value, sent]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
    }
  };
  return (
    <input
      type="text"
      aria-label={label}
      value={draft}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={key}
      onBlur={commit}
    />
  );
}

/** A group of rows, with AutoCAD's heading for it. */
function ParameterGroup({
  title,
  rows,
  sent,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: readonly ParameterInfo[];
  sent: unknown;
  selected: string | undefined;
  onSelect: (name: string) => void;
  onEdit: (e: ParameterEdit) => void;
  onDelete: (r: ParameterInfo) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <tbody aria-label={title}>
      <tr className="parameters-group">
        <th scope="rowgroup" colSpan={5}>
          {title}
        </th>
      </tr>
      {rows.map((r) => (
        <tr
          key={r.constraint}
          data-name={r.name}
          aria-selected={r.name === selected}
          data-reference={r.reference || undefined}
          onFocus={() => onSelect(r.name)}
          onClick={() => onSelect(r.name)}
          onKeyDown={(e) => {
            // Delete on a row (not while typing in its cells) deletes it.
            if (e.key === 'Delete' && e.target === e.currentTarget) onDelete(r);
          }}
          tabIndex={-1}
        >
          <th scope="row">
            <EditCell
              sent={sent}
              value={r.name}
              label={`Name of ${r.name}`}
              onCommit={(to) => onEdit({ kind: 'rename', name: r.name, to })}
            />
          </th>
          <td>
            <EditCell
              sent={sent}
              value={r.reference ? `(${r.expression})` : r.expression}
              label={`Expression of ${r.name}`}
              readOnly={r.reference}
              onCommit={(expression) => onEdit({ kind: 'expression', name: r.name, expression })}
            />
          </td>
          <td className="value" data-error={r.value === undefined || undefined} title={r.error}>
            {parameterValueText(r)}
          </td>
          <td>{r.type}</td>
          <td>
            <EditCell
              sent={sent}
              value={r.description}
              label={`Description of ${r.name}`}
              onCommit={(description) => onEdit({ kind: 'description', name: r.name, description })}
            />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function ParametersPalette({ doc, onClose }: { doc: OpenDocument; onClose: () => void }) {
  const rows = useSyncExternalStore(parameterRows.subscribe, () => parameterRows.get(doc.id));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  // The user parameters' names when New was pressed: the one the engine adds is put in edit mode.
  const before = useRef<ReadonlySet<string> | undefined>(undefined);
  const table = useRef<HTMLTableElement>(null);

  useEffect(() => {
    // The engine sends rows only while the palette shows its drawing.
    engines.command(doc.id, { kind: 'parameters', open: true });
    return () => engines.command(doc.id, { kind: 'parameters', open: false });
  }, [doc.id]);

  useEffect(() => {
    const was = before.current;
    if (!was || !rows) return;
    const made = rows.find((r) => r.user && !was.has(r.name));
    if (!made) return;
    before.current = undefined;
    setSearch('');
    setSelected(made.name);
    const input = table.current?.querySelector<HTMLInputElement>(
      `tr[data-name="${CSS.escape(made.name)}"] th input`,
    );
    input?.focus();
    input?.select();
  }, [rows]);

  const edit = (e: ParameterEdit) => engines.command(doc.id, { kind: 'parameter', edit: e });
  const shown = searchParameters(rows ?? [], search);
  const picked = rows?.find((r) => r.name === selected);
  const remove = (r: ParameterInfo) => {
    edit({ kind: 'delete', name: r.name });
    setSelected(undefined);
  };
  const create = () => {
    before.current = new Set((rows ?? []).filter((r) => r.user).map((r) => r.name));
    edit({ kind: 'new' });
  };
  const groups = {
    sent: rows,
    selected,
    onSelect: setSelected,
    onEdit: edit,
    onDelete: remove,
  };

  return (
    <aside className="palette parameters-palette" aria-labelledby="parameters-title">
      <header>
        <h2 id="parameters-title">Parameters Manager</h2>
        <button type="button" aria-label="Close Parameters Manager" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="parameters-tools" role="toolbar" aria-label="Parameters">
        <button
          type="button"
          aria-label="New User Parameter"
          title="Creates a new user parameter"
          onClick={create}
        >
          New
        </button>
        <button
          type="button"
          disabled={!picked}
          title={
            picked?.user
              ? 'Deletes the selected user parameter; expressions that use it keep its value'
              : 'Deletes the selected parameter and its dimensional constraint; expressions that use it keep its value'
          }
          onClick={() => picked && remove(picked)}
        >
          Delete
        </button>
        <input
          type="search"
          aria-label="Search for parameter"
          placeholder="Search for parameter"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      {rows === undefined ? (
        <p className="empty">Reading the drawing's parameters…</p>
      ) : rows.length === 0 ? (
        <p className="empty">
          None: the drawing has no dimensional constraints or user parameters.
        </p>
      ) : (
        <div className="parameters-table-wrap">
          <table className="parameters-table" aria-label="Parameters" ref={table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Expression</th>
                <th scope="col">Value</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <ParameterGroup
              title="Dimensional Constraint Parameters"
              rows={shown.filter((r) => !r.user)}
              {...groups}
            />
            <ParameterGroup
              title="User Parameters"
              rows={shown.filter((r) => r.user)}
              {...groups}
            />
          </table>
          {shown.length === 0 && <p className="empty">No parameter matches the search.</p>}
        </div>
      )}
    </aside>
  );
}
