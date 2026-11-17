// TABLE's Insert Table dialog (M4-05 part 2), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Insert Table Dialog Box"; UI_SPEC.md §7): Table style, Insert options, Preview,
// Insertion behavior (Specify insertion point or Specify window), Column & row settings
// (Columns, Column width, Data rows, Row height in lines) and Set cell styles (First row cell
// style, Second row cell style, All other row cell styles: Title, Header or Data, M4-16 part 5;
// they open on the rows the table style gives by their place). With Specify
// window, a radio button picks which of Columns and Column width the window sets (shown as
// Auto), and the same for Data rows and Row height. OK sends the settings; the engine then asks
// for the insertion point (dragging the table) or the window's corners.
//
// The button beside Table style launches the Table Style dialog (TABLESTYLE, M4-05 part 5), the
// dialog opening again on the style made current there. Left out or shown greyed, for the reasons
// given: From a data link (data links are passthrough only, FILE_FIDELITY.md)
// and From object data (Data Extraction is not in Triya), cell styles of the drafter's own in
// Set cell styles (M1-99), and Help, as Triya's other dialogs leave it.
import type {
  DialogRequest,
  InsertTableSettings,
  PromptAnswer,
  TableCellStyleName,
  TableRowCellStyles,
} from '@triya/engine';
import { useId, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'inserttable' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** A whole number from 1, or undefined. */
const whole = (t: string, max = 32767): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
};

/** A positive number, or undefined. */
const positive = (t: string): number | undefined => {
  const n = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

function Field({
  label,
  text,
  onChange,
  auto,
  valid,
}: {
  label: string;
  text: string;
  onChange: (t: string) => void;
  auto: boolean;
  valid: boolean;
}) {
  const id = useId();
  return (
    <label className="cad-dialog-field insert-table-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={auto ? 'Auto' : text}
        disabled={auto}
        aria-invalid={!auto && !valid}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

const CELL_STYLES: readonly [TableCellStyleName, string][] = [
  ['title', 'Title'],
  ['header', 'Header'],
  ['data', 'Data'],
];

/** The cell styles a table's first rows take by their place in its style, and the rest. */
function placedCellStyles(style: Request['styles'][number] | undefined): TableRowCellStyles {
  const first: TableCellStyleName[] = [
    ...(style && !style.suppressTitle ? ['title' as const] : []),
    ...(style && !style.suppressHeader ? ['header' as const] : []),
  ];
  return { first: first[0] ?? 'data', second: first[1] ?? 'data', others: 'data' };
}

/**
 * The table as its rows' cell styles lay it out: `first` rows the style gives (title and header
 * unless suppressed), then four more, a title row merged across.
 */
function Preview({
  first,
  cellStyles,
  names,
  up,
}: {
  first: number;
  cellStyles: TableRowCellStyles;
  /** The names of the cell styles of the drafter's own, by id. */
  names: ReadonlyMap<number, string>;
  up: boolean;
}) {
  const rows = Array.from({ length: first + 4 }, (_, i) =>
    i === 0 ? cellStyles.first : i === 1 ? cellStyles.second : cellStyles.others,
  );
  const shown = up ? [...rows].reverse() : rows;
  const w = 180;
  const h = 18;
  const cols = 3;
  return (
    <svg
      className="insert-table-preview"
      viewBox={`0 0 ${w + 2} ${shown.length * h + 2}`}
      role="img"
      aria-label="Preview"
    >
      <g transform="translate(1 1)" stroke="currentColor" fill="none" strokeWidth="1">
        {shown.map((r, i) => (
          <g key={i}>
            <rect x={0} y={i * h} width={w} height={h} />
            {r !== 'title' &&
              Array.from({ length: cols - 1 }, (_, k) => (
                <line
                  key={k}
                  x1={((k + 1) * w) / cols}
                  x2={((k + 1) * w) / cols}
                  y1={i * h}
                  y2={(i + 1) * h}
                />
              ))}
            <text
              x={r === 'title' ? w / 2 : w / cols / 2}
              y={i * h + h * 0.68}
              textAnchor="middle"
              stroke="none"
              fill="currentColor"
              fontSize={r === 'title' ? 10 : 8}
            >
              {typeof r === 'number'
                ? (names.get(r) ?? 'Data')
                : r === 'title'
                  ? 'Title'
                  : r === 'header'
                    ? 'Header'
                    : 'Data'}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function InsertTableDialog({ doc, request }: { doc: number; request: Request }) {
  const s0 = request.settings;
  const [style, setStyle] = useState(s0.style);
  const [byWindow, setByWindow] = useState(s0.window);
  const [autoColumns, setAutoColumns] = useState(s0.autoColumns);
  const [autoRows, setAutoRows] = useState(s0.autoRows);
  const [columns, setColumns] = useState(String(s0.columns));
  const [width, setWidth] = useState(s0.width.toFixed(4));
  const [rows, setRows] = useState(String(s0.dataRows));
  const [lines, setLines] = useState(String(s0.lines));
  const [chosenStyles, setChosenStyles] = useState(s0.cellStyles);
  const styleId = useId();
  const chosen =
    request.styles.find((x) => x.name.toUpperCase() === style.toUpperCase()) ?? request.styles[0];
  const placed = placedCellStyles(chosen);
  // The style's cell styles of the drafter's own (M4-16 part 9); one chosen with another style
  // that this one does not hold is Data, as the engine makes it.
  const own = chosen?.userCellStyles ?? [];
  const held = (n: TableCellStyleName): TableCellStyleName =>
    typeof n === 'number' && !own.some((u) => u.id === n) ? 'data' : n;
  const cellStyles = chosenStyles
    ? {
        first: held(chosenStyles.first),
        second: held(chosenStyles.second),
        others: held(chosenStyles.others),
      }
    : placed;
  const names = new Map(own.map((u) => [u.id, u.name]));
  // Sent only when not the rows by their place, which a table states by leaving them out.
  const sent =
    cellStyles.first !== placed.first ||
    cellStyles.second !== placed.second ||
    cellStyles.others !== placed.others
      ? { cellStyles }
      : {};
  // What the window sets is not asked: Auto, its value kept for the next table.
  const columnsAuto = byWindow && autoColumns;
  const widthAuto = byWindow && !autoColumns;
  const rowsAuto = byWindow && autoRows;
  const linesAuto = byWindow && !autoRows;
  const n = {
    columns: whole(columns),
    width: positive(width),
    rows: whole(rows),
    lines: whole(lines),
  };
  const valid =
    (columnsAuto || n.columns !== undefined) &&
    (widthAuto || n.width !== undefined) &&
    (rowsAuto || n.rows !== undefined) &&
    (linesAuto || n.lines !== undefined);
  const settings = (): InsertTableSettings => ({
    ...sent,
    style: chosen?.name ?? style,
    window: byWindow,
    columns: n.columns ?? s0.columns,
    width: n.width ?? s0.width,
    dataRows: n.rows ?? s0.dataRows,
    lines: n.lines ?? s0.lines,
    autoColumns,
    autoRows,
  });
  // The table style launcher: the Table Style dialog, then this one again (TABLE).
  const launch = () => void answer(doc, { kind: 'dialog', action: 'select', table: settings() });
  const ok = () => {
    if (!valid) return;
    const table: InsertTableSettings = {
      ...sent,
      style: chosen?.name ?? style,
      window: byWindow,
      columns: n.columns ?? s0.columns,
      width: n.width ?? s0.width,
      dataRows: n.rows ?? s0.dataRows,
      lines: n.lines ?? s0.lines,
      autoColumns,
      autoRows,
    };
    void answer(doc, { kind: 'dialog', action: 'ok', table });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const rowStyleFields: [keyof TableRowCellStyles, string][] = [
    ['first', 'First row cell style:'],
    ['second', 'Second row cell style:'],
    ['others', 'All other row cell styles:'],
  ];
  return (
    <Modal label="Insert Table" className="insert-table-dialog" onOk={ok} onCancel={cancel}>
      <div className="insert-table-columns">
        <div className="insert-table-left">
          <fieldset className="insert-table-group">
            <legend>Table style</legend>
            <select
              id={styleId}
              aria-label="Table style"
              value={chosen?.name ?? style}
              onChange={(e) => setStyle(e.currentTarget.value)}
            >
              {request.styles.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="insert-table-launcher"
              aria-label="Launch the Table Style dialog"
              title="Launch the Table Style dialog"
              onClick={launch}
            >
              …
            </button>
          </fieldset>
          <fieldset className="insert-table-group">
            <legend>Insert options</legend>
            <label className="cad-dialog-check">
              <input type="radio" name="insert-option" checked readOnly />
              Start from empty table
            </label>
            <label className="cad-dialog-check">
              <input type="radio" name="insert-option" disabled />
              From a data link
            </label>
            <label className="cad-dialog-check">
              <input type="radio" name="insert-option" disabled />
              From object data in the drawing (Data Extraction)
            </label>
          </fieldset>
          <fieldset className="insert-table-group">
            <legend>Preview</legend>
            <Preview
              first={(chosen?.suppressTitle ? 0 : 1) + (chosen?.suppressHeader ? 0 : 1)}
              cellStyles={cellStyles}
              names={names}
              up={chosen?.up ?? false}
            />
          </fieldset>
        </div>
        <div className="insert-table-right">
          <fieldset className="insert-table-group">
            <legend>Insertion behavior</legend>
            <label className="cad-dialog-check">
              <input
                type="radio"
                name="insertion"
                checked={!byWindow}
                onChange={() => setByWindow(false)}
              />
              Specify insertion point
            </label>
            <label className="cad-dialog-check">
              <input
                type="radio"
                name="insertion"
                checked={byWindow}
                onChange={() => setByWindow(true)}
              />
              Specify window
            </label>
          </fieldset>
          <fieldset className="insert-table-group insert-table-sizes">
            <legend>Column &amp; row settings</legend>
            <div className="insert-table-pair">
              <div className="insert-table-row">
                {byWindow && (
                  <input
                    type="radio"
                    name="column-auto"
                    aria-label="Set the number of columns"
                    checked={!autoColumns}
                    onChange={() => setAutoColumns(false)}
                  />
                )}
                <Field
                  label="Columns:"
                  text={columns}
                  onChange={setColumns}
                  auto={columnsAuto}
                  valid={n.columns !== undefined}
                />
              </div>
              <div className="insert-table-row">
                {byWindow && (
                  <input
                    type="radio"
                    name="column-auto"
                    aria-label="Set the column width"
                    checked={autoColumns}
                    onChange={() => setAutoColumns(true)}
                  />
                )}
                <Field
                  label="Column width:"
                  text={width}
                  onChange={setWidth}
                  auto={widthAuto}
                  valid={n.width !== undefined}
                />
              </div>
            </div>
            <div className="insert-table-pair">
              <div className="insert-table-row">
                {byWindow && (
                  <input
                    type="radio"
                    name="row-auto"
                    aria-label="Set the number of data rows"
                    checked={!autoRows}
                    onChange={() => setAutoRows(false)}
                  />
                )}
                <Field
                  label="Data rows:"
                  text={rows}
                  onChange={setRows}
                  auto={rowsAuto}
                  valid={n.rows !== undefined}
                />
              </div>
              <div className="insert-table-row">
                {byWindow && (
                  <input
                    type="radio"
                    name="row-auto"
                    aria-label="Set the row height"
                    checked={autoRows}
                    onChange={() => setAutoRows(true)}
                  />
                )}
                <Field
                  label="Row height:"
                  text={lines}
                  onChange={setLines}
                  auto={linesAuto}
                  valid={n.lines !== undefined}
                />
              </div>
              <span className="insert-table-unit">Line(s)</span>
            </div>
          </fieldset>
          <fieldset className="insert-table-group">
            <legend>Set cell styles</legend>
            {rowStyleFields.map(([key, label]) => (
              <label key={key} className="cad-dialog-field insert-table-field">
                <span>{label}</span>
                <select
                  value={String(cellStyles[key])}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setChosenStyles({
                      ...cellStyles,
                      [key]: /^\d+$/.test(v) ? Number(v) : (v as TableCellStyleName),
                    });
                  }}
                >
                  {CELL_STYLES.map(([name, shown]) => (
                    <option key={name} value={name}>
                      {shown}
                    </option>
                  ))}
                  {own.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        </div>
      </div>
      {!valid && (
        <p role="alert" className="insert-table-error">
          Columns, data rows and the row height are whole numbers from 1; the column width is a
          number above zero.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!valid}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
