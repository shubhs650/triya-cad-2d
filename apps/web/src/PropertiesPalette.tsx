// The Properties palette (M2-21, UI_SPEC.md §4): AutoCAD's Properties palette for the objects
// selected at `Command:`. The object list ("All (3)", "Line (2)") narrows the sheet to one type;
// General comes first, then the type's sections; a value the objects do not share is *VARIES*.
// A choice applies when picked, a typed value on Enter or when the field loses the focus (Esc
// puts the shown value back), each as one undo step the drawing's engine makes (M2-05). A
// reference to a dynamic block carries the FR-B3 badge "Dynamic — edit in AutoCAD". With nothing
// selected it shows General with the drawing's current settings, which new objects take (M2-35).
// Fully keyboard operable: every value is a native select or text field.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EntityType, PropertyRow, PropertySheet, PropertyUnits } from '@triya/engine';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { VARIES, editText, propertySheets, typeOptions, valueText } from './properties';

export function PropertiesPalette({ doc, onClose }: { doc: OpenDocument; onClose: () => void }) {
  const sheet = useSyncExternalStore(propertySheets.subscribe, () => propertySheets.get(doc.id));

  useEffect(() => {
    // The engine sends sheets only while the palette shows its drawing.
    engines.command(doc.id, { kind: 'properties', open: true });
    return () => engines.command(doc.id, { kind: 'properties', open: false });
  }, [doc.id]);

  const narrow = (type: string) =>
    engines.command(doc.id, {
      kind: 'properties',
      open: true,
      filter: type === '' ? null : (type as EntityType),
    });
  const set = (key: string, value: string) =>
    engines.command(doc.id, { kind: 'property', edit: { key, value } });

  return (
    <aside className="palette properties-palette" aria-labelledby="properties-title">
      <header>
        <h2 id="properties-title">Properties</h2>
        <button type="button" aria-label="Close Properties" onClick={onClose}>
          ×
        </button>
      </header>
      {!sheet || (sheet.count === 0 && !sheet.current) ? (
        <p className="empty">No selection</p>
      ) : (
        <PropertySections sheet={sheet} narrow={narrow} set={set} />
      )}
    </aside>
  );
}

function PropertySections({
  sheet,
  narrow,
  set,
}: {
  sheet: PropertySheet;
  narrow: (type: string) => void;
  set: (key: string, value: string) => void;
}) {
  const types = typeOptions(sheet);
  return (
    <>
      <select
        className="properties-objects"
        aria-label="Objects selected"
        value={sheet.filter ?? ''}
        disabled={types.length < 2}
        onChange={(e) => narrow(e.currentTarget.value)}
      >
        {types.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      {sheet.dynamic && (
        <p className="dynamic-badge" role="note">
          <strong>Dynamic — edit in AutoCAD</strong>
          <span>{sheet.dynamic}</span>
        </p>
      )}
      <div className="properties-wrap">
        {sheet.sections.map((s) => (
          <details key={s.title} open className="properties-section">
            <summary>{s.title}</summary>
            <table aria-label={s.title}>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.key} data-key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td>
                      <PropertyField row={r} units={sheet.units} set={set} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </>
  );
}

function PropertyField({
  row,
  units,
  set,
}: {
  row: PropertyRow;
  units: PropertyUnits;
  set: (key: string, value: string) => void;
}) {
  if (row.readOnly) {
    return (
      <span className="read-only" aria-label={row.label}>
        {valueText(row, units)}
      </span>
    );
  }
  if (row.kind === 'choice' && row.options) {
    const value = row.varies || row.value === undefined ? VARIES : String(row.value);
    return (
      <select
        aria-label={row.label}
        value={value}
        onChange={(e) => {
          if (e.currentTarget.value !== VARIES) set(row.key, e.currentTarget.value);
        }}
      >
        {value === VARIES && (
          <option value={VARIES} disabled>
            {VARIES}
          </option>
        )}
        {row.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return <TypedField row={row} units={units} set={set} />;
}

/** A typed value: applied on Enter or blur when it changed; Esc puts the shown value back. */
function TypedField({
  row,
  units,
  set,
}: {
  row: PropertyRow;
  units: PropertyUnits;
  set: (key: string, value: string) => void;
}) {
  const shown = editText(row, units);
  const [text, setText] = useState(shown);
  // A new sheet (another selection, an edit applied) shows its value.
  useEffect(() => setText(shown), [shown]);
  const list = row.kind === 'transparency' ? `${row.key}-choices` : undefined;
  const commit = () => {
    if (text.trim() === '' || text === shown) return setText(shown);
    set(row.key, text);
  };
  return (
    <>
      <input
        type="text"
        aria-label={row.label}
        value={text}
        placeholder={row.varies ? VARIES : undefined}
        list={list}
        spellCheck={false}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(shown);
          }
        }}
      />
      {list && row.options && (
        <datalist id={list}>
          {row.options.map((o) => (
            <option key={o.value} value={o.value} />
          ))}
        </datalist>
      )}
    </>
  );
}
