// The Properties palette (M2-21, UI_SPEC.md §4): AutoCAD's Properties palette for the objects
// selected at `Command:`. The object list ("All (3)", "Line (2)") narrows the sheet to one type;
// General comes first, then the type's sections; a value the objects do not share is *VARIES*.
// A choice applies when picked, a typed value on Enter or when the field loses the focus (Esc
// puts the shown value back), each as one undo step the drawing's engine makes (M2-05). A
// reference to a dynamic block carries the FR-B3 badge "Dynamic — edit in AutoCAD". With nothing
// selected it shows General with the drawing's current settings, which new objects take (M2-35).
// A hatch's Pattern name offers the library's patterns as it is typed (M2-35 part 3), where
// AutoCAD's "..." opens its Hatch Pattern Palette.
// Color's last choice, "Select Color...", opens AutoCAD's Select Color dialog (M2-35 part 4).
// Fully keyboard operable: every value is a native select or text field.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  colorValue,
  parseColorValue,
  type EntityType,
  type PropertyRow,
  type PropertySheet,
  type PropertyUnits,
} from '@triya/engine';
import { SelectColorDialog } from './SelectColorDialog';
import type { OpenDocument } from './documents';
import { engines } from './engine/registry';
import { VARIES, editText, propertySheets, typeOptions, valueText } from './properties';

export function PropertiesPalette({
  doc,
  onClose,
  patternNames = [],
}: {
  doc: OpenDocument;
  onClose: () => void;
  /** The hatch patterns Pattern name offers: SOLID and the app's pattern library. */
  patternNames?: readonly string[];
}) {
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
        <PropertySections sheet={sheet} narrow={narrow} set={set} patternNames={patternNames} />
      )}
    </aside>
  );
}

function PropertySections({
  sheet,
  narrow,
  set,
  patternNames,
}: {
  sheet: PropertySheet;
  narrow: (type: string) => void;
  set: (key: string, value: string) => void;
  patternNames: readonly string[];
}) {
  const types = typeOptions(sheet);
  // The colour row whose "Select Color..." was picked: the dialog shows while it is set. A
  // dimension's colour rows (`colorDialog: 'index'`) offer the Index Color tab only.
  const [picking, setPicking] = useState<PropertyRow | undefined>();
  return (
    <>
      {picking && (
        <SelectColorDialog
          initial={picking.varies ? undefined : parseColorValue(String(picking.value))}
          books={picking.colorDialog === 'index' ? [] : (sheet.colorBooks ?? [])}
          trueColors={!sheet.current && picking.colorDialog !== 'index'}
          {...(picking.colorDialog === 'index' && {
            indexOnly: 'A dimension’s colors take an index color only.',
          })}
          onOk={(c) => {
            setPicking(undefined);
            set(picking.key, colorValue(c));
          }}
          onCancel={() => setPicking(undefined)}
        />
      )}
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
                      <PropertyField
                        row={r}
                        units={sheet.units}
                        set={set}
                        suggestions={r.key === 'patternName' ? patternNames : undefined}
                        selectColor={
                          r.key === 'color' || r.colorDialog ? () => setPicking(r) : undefined
                        }
                      />
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

/** The Color list's last entry, as AutoCAD's: not a colour, it opens the dialog. */
const SELECT_COLOR = 'select-color';

function PropertyField({
  row,
  units,
  set,
  suggestions,
  selectColor,
}: {
  row: PropertyRow;
  units: PropertyUnits;
  set: (key: string, value: string) => void;
  /** Values a typed field offers as it is typed (a datalist). */
  suggestions?: readonly string[] | undefined;
  /** Color's "Select Color..." choice, which opens the Select Color dialog. */
  selectColor?: (() => void) | undefined;
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
          const v = e.currentTarget.value;
          if (v === SELECT_COLOR) selectColor?.();
          else if (v !== VARIES) set(row.key, v);
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
        {selectColor && <option value={SELECT_COLOR}>Select Color...</option>}
      </select>
    );
  }
  return <TypedField row={row} units={units} set={set} suggestions={suggestions} />;
}

/** A typed value: applied on Enter or blur when it changed; Esc puts the shown value back. */
function TypedField({
  row,
  units,
  set,
  suggestions,
}: {
  row: PropertyRow;
  units: PropertyUnits;
  set: (key: string, value: string) => void;
  suggestions?: readonly string[] | undefined;
}) {
  const shown = editText(row, units);
  const [text, setText] = useState(shown);
  // A new sheet (another selection, an edit applied) shows its value.
  useEffect(() => setText(shown), [shown]);
  const choices =
    row.kind === 'transparency' ? (row.options ?? []).map((o) => o.value) : suggestions;
  const list = choices && choices.length > 0 ? `${row.key}-choices` : undefined;
  const commit = () => {
    if ((text.trim() === '' && !row.clearable) || text === shown) return setText(shown);
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
      {list && choices && (
        <datalist id={list}>
          {choices.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      )}
    </>
  );
}
