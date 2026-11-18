// Layer Filter Properties (M5-07 part 5; AutoCAD 2024 Help, "Layer Filter Properties Dialog
// Box"), opened by the Layer Properties Manager's New Property Filter (Alt+P) and by a property
// filter's Properties...: Filter name, the Filter definition grid (Status, Name, On, Freeze, Lock,
// Color, Linetype, Lineweight, Transparency, Plot Style, Plot, New VP Freeze, Description; a
// layer matches a row when it has every value in it, the filter when it matches any row; a new
// row is offered under the last) and the Filter preview, the layers the definition lists now
// (within the parent of a nested filter). Text cells take wildcards; Color's and Linetype's [...]
// open Select Color and Select Linetype. OK names the filter and saves its definition (one LAYER
// step); a refusal (a name taken, invalid or reserved) stays in the dialog.
import { useMemo, useState } from 'react';
import {
  filteredLayers,
  layerFilterMatches,
  parseLayerFilterExpression,
  type Color,
  type ColorBook,
  type Handle,
  type LayerFilterSource,
  type LinetypeRecord,
} from '@triya/engine';
import { Modal } from './AttributeDialogs';
import { SelectLinetypeDialog } from './LayerDialogs';
import {
  DEFINITION_COLUMNS,
  definitionExpression,
  definitionRows,
  type DefinitionField,
  type DefinitionRow,
} from './layer-filters';
import type { LayerRow } from './layers';
import { SelectColorDialog } from './SelectColorDialog';

/** A colour as the Color cell holds it: an index, a colour book's colour or an RGB triple. */
export function colorFilterText(c: Color): string {
  if (c.kind === 'aci') return String(c.index);
  if (c.kind !== 'rgb') return c.kind;
  return c.bookName && c.colorName ? `${c.bookName}$${c.colorName}` : `${c.r},${c.g},${c.b}`;
}

const isEmpty = (r: DefinitionRow) => Object.values(r).every((v) => !v?.trim());

export function LayerFilterDialog({
  name: initialName,
  expression,
  parent,
  source,
  rows: layerRows,
  used,
  books,
  linetypes,
  onOk,
  onCancel,
}: {
  name: string;
  expression: string;
  /** The filter a new or edited one is nested in: the preview lists only its layers. */
  parent: Handle | undefined;
  source: LayerFilterSource;
  /** The manager's rows, in its order, which the preview shows. */
  rows: readonly LayerRow[];
  used: ReadonlySet<Handle> | undefined;
  books: readonly ColorBook[];
  linetypes: readonly LinetypeRecord[];
  /** Saves the filter; a refusal's message, shown in the dialog. */
  onOk: (name: string, expression: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const read = useMemo(() => definitionRows(expression), [expression]);
  const [name, setName] = useState(initialName);
  const [grid, setGrid] = useState<DefinitionRow[]>(() => [...(read ?? []), {}]);
  // A definition the grid cannot show is kept until the grid is changed.
  const [edited, setEdited] = useState(read !== undefined);
  const [message, setMessage] = useState<string | undefined>();
  const [picking, setPicking] = useState<{ row: number; field: 'color' | 'linetype' }>();

  const text = edited ? definitionExpression(grid) : expression;
  const parsed = parseLayerFilterExpression(text);
  const preview = useMemo(() => {
    if (typeof parsed === 'string') return [];
    const within =
      parent === undefined
        ? undefined
        : new Set(filteredLayers(source, parent, used ? { used } : {}).map((l) => l.handle));
    return layerRows.filter((r) => {
      const l = source.tables.layers.get(r.handle);
      return (
        l !== undefined &&
        (within === undefined || within.has(r.handle)) &&
        layerFilterMatches(source, parsed, l, used)
      );
    });
  }, [text, parent, source, layerRows, used]);

  const set = (row: number, field: DefinitionField, value: string) => {
    const next = grid.map((r, i) => (i === row ? { ...r, [field]: value } : r));
    // A row typed into at the end gets an empty one under it.
    if (!isEmpty(next.at(-1)!)) next.push({});
    setGrid(next);
    setEdited(true);
  };
  const deleteRow = (row: number) => {
    const next = grid.filter((_, i) => i !== row);
    if (next.length === 0 || !isEmpty(next.at(-1)!)) next.push({});
    setGrid(next);
    setEdited(true);
  };

  const ok = async () => {
    if (typeof parsed === 'string') {
      setMessage(text.startsWith('A filter value') ? text : parsed);
      return;
    }
    const why = await onOk(name, text);
    setMessage(why);
  };

  return (
    <Modal
      label="Layer Filter Properties"
      className="layer-filter-dialog"
      onOk={() => void ok()}
      onCancel={onCancel}
    >
      <label className="layer-filter-name-field">
        Filter name:
        <input value={name} onChange={(e) => setName(e.currentTarget.value)} autoFocus />
      </label>
      <fieldset>
        <legend>Filter definition:</legend>
        {!edited && (
          <p className="layer-filter-raw">
            This filter is defined as <code>{expression}</code>, which the grid cannot show;
            changing the grid replaces it.
          </p>
        )}
        <div className="layer-filter-grid-wrap">
          <table className="layer-filter-grid" aria-label="Filter definition">
            <thead>
              <tr>
                {DEFINITION_COLUMNS.map((c) => (
                  <th key={c.field} scope="col">
                    {c.title}
                  </th>
                ))}
                <th scope="col">
                  <span className="visually-hidden">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.map((r, i) => (
                <tr key={i}>
                  {DEFINITION_COLUMNS.map((c) => {
                    const label = `${c.title} in row ${i + 1}`;
                    const value = r[c.field] ?? '';
                    return (
                      <td key={c.field}>
                        {c.choices ? (
                          <select
                            aria-label={label}
                            value={value}
                            onChange={(e) => set(i, c.field, e.currentTarget.value)}
                          >
                            <option value="" />
                            <option>{c.choices[0]}</option>
                            <option>{c.choices[1]}</option>
                          </select>
                        ) : (
                          <span className="layer-filter-cell">
                            <input
                              aria-label={label}
                              value={value}
                              onChange={(e) => set(i, c.field, e.currentTarget.value)}
                            />
                            {(c.field === 'color' || c.field === 'linetype') && (
                              <button
                                type="button"
                                aria-label={`Choose ${c.title.toLowerCase()} in row ${i + 1}`}
                                aria-haspopup="dialog"
                                onClick={() => setPicking({ row: i, field: c.field as 'color' })}
                              >
                                …
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      type="button"
                      aria-label={`Delete row ${i + 1}`}
                      disabled={isEmpty(r) && i === grid.length - 1}
                      onClick={() => deleteRow(i)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      <fieldset>
        <legend>Filter preview:</legend>
        <div className="layer-filter-preview-wrap">
          <table className="layer-filter-preview" aria-label="Filter preview">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">On</th>
                <th scope="col">Freeze</th>
                <th scope="col">Lock</th>
                <th scope="col">Color</th>
                <th scope="col">Linetype</th>
                <th scope="col">Lineweight</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.handle}>
                  <th scope="row">{r.name}</th>
                  <td>{r.on ? 'On' : 'Off'}</td>
                  <td>{r.frozen ? 'Frozen' : 'Thawed'}</td>
                  <td>{r.locked ? 'Locked' : 'Unlocked'}</td>
                  <td>{r.color.label}</td>
                  <td>{r.linetype}</td>
                  <td>{r.lineweight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
      {message && (
        <p role="alert" className="layer-states-message">
          {message}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => void ok()}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {picking?.field === 'color' && (
        <SelectColorDialog
          initial={undefined}
          books={books}
          trueColors
          notByLayer="A layer’s color cannot be ByLayer or ByBlock."
          onOk={(c) => {
            setPicking(undefined);
            set(picking.row, 'color', colorFilterText(c));
          }}
          onCancel={() => setPicking(undefined)}
        />
      )}
      {picking?.field === 'linetype' && (
        <SelectLinetypeDialog
          initial={linetypes.find((l) => l.name === grid[picking.row]?.linetype)?.handle ?? ''}
          linetypes={linetypes}
          onOk={(h) => {
            setPicking(undefined);
            set(picking.row, 'linetype', linetypes.find((l) => l.handle === h)?.name ?? '');
          }}
          onCancel={() => setPicking(undefined)}
        />
      )}
    </Modal>
  );
}
