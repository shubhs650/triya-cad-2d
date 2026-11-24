// The Parameters Manager (M9-03 part 5, PARAMETERS): AutoCAD's palette of the drawing's
// dimensional constraints' parameters, by Name, Expression, Value, Type and Description.
// AutoCAD 2024 Help, "Parameters Manager": a name, an expression and a description are edited in
// place; the geometry follows a new expression; renaming a parameter renames it in the
// expressions that use it; Delete removes the selected parameter's constraint, and expressions
// that used it keep its value. A reference constraint's parameter shows what it measures, and its
// expression cannot be edited. The search box narrows the list. User parameters (AutoCAD's
// "Creates a new user parameter") are not made yet: the roadmap keeps them for a later part.
//
// The rows come from the drawing's engine while the palette shows it; each edit goes back as one
// undo step, and a refused one (a cycle, a name in use) says why on the command line and the
// row shows its value again.
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
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

export function ParametersPalette({ doc, onClose }: { doc: OpenDocument; onClose: () => void }) {
  const rows = useSyncExternalStore(parameterRows.subscribe, () => parameterRows.get(doc.id));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | undefined>();

  useEffect(() => {
    // The engine sends rows only while the palette shows its drawing.
    engines.command(doc.id, { kind: 'parameters', open: true });
    return () => engines.command(doc.id, { kind: 'parameters', open: false });
  }, [doc.id]);

  const edit = (e: ParameterEdit) => engines.command(doc.id, { kind: 'parameter', edit: e });
  const shown = searchParameters(rows ?? [], search);
  const picked = rows?.find((r) => r.name === selected);
  const remove = (r: ParameterInfo) => {
    edit({ kind: 'delete', name: r.name });
    setSelected(undefined);
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
          disabled={!picked}
          title="Deletes the selected parameter and its dimensional constraint; expressions that use it keep its value"
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
        <p className="empty">None: the drawing has no dimensional constraints.</p>
      ) : (
        <div className="parameters-table-wrap">
          <table className="parameters-table" aria-label="Dimensional constraint parameters">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Expression</th>
                <th scope="col">Value</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr
                  key={r.constraint}
                  aria-selected={r.name === selected}
                  data-reference={r.reference || undefined}
                  onFocus={() => setSelected(r.name)}
                  onClick={() => setSelected(r.name)}
                  onKeyDown={(e) => {
                    // Delete on a row (not while typing in its cells) deletes it.
                    if (e.key === 'Delete' && e.target === e.currentTarget) remove(r);
                  }}
                  tabIndex={-1}
                >
                  <th scope="row">
                    <EditCell
                      sent={rows}
                      value={r.name}
                      label={`Name of ${r.name}`}
                      onCommit={(to) => edit({ kind: 'rename', name: r.name, to })}
                    />
                  </th>
                  <td>
                    <EditCell
                      sent={rows}
                      value={r.reference ? `(${r.expression})` : r.expression}
                      label={`Expression of ${r.name}`}
                      readOnly={r.reference}
                      onCommit={(expression) =>
                        edit({ kind: 'expression', name: r.name, expression })
                      }
                    />
                  </td>
                  <td
                    className="value"
                    data-error={r.value === undefined || undefined}
                    title={r.error}
                  >
                    {parameterValueText(r)}
                  </td>
                  <td>{r.type}</td>
                  <td>
                    <EditCell
                      sent={rows}
                      value={r.description}
                      label={`Description of ${r.name}`}
                      onCommit={(description) =>
                        edit({ kind: 'description', name: r.name, description })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="empty">No parameter matches the search.</p>}
        </div>
      )}
    </aside>
  );
}
