// TABLE's Insert Table dialog (M4-05 part 2), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Insert Table Dialog Box"; UI_SPEC.md §7): Table style, Insert options, Preview,
// Insertion behavior (Specify insertion point or Specify window), Column & row settings
// (Columns, Column width, Data rows, Row height in lines) and Set cell styles. With Specify
// window, a radio button picks which of Columns and Column width the window sets (shown as
// Auto), and the same for Data rows and Row height. OK sends the settings; the engine then asks
// for the insertion point (dragging the table) or the window's corners.
//
// Left out or shown greyed, for the reasons given: the table style launcher (TABLESTYLE is a
// later part of M4-05), From a data link (data links are passthrough only, FILE_FIDELITY.md)
// and From object data (Data Extraction is not in Triya), Set cell styles (the rows take their
// table style's title, header and data cell styles in order; choosing others needs per-row cell
// styles the model does not keep yet), and Help, as Triya's other dialogs leave it.
import type { DialogRequest, InsertTableSettings, PromptAnswer } from '@triya/engine';
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

/** The table as the style lays it out: a title row merged across, a header row, data rows. */
function Preview({ title, header, up }: { title: boolean; header: boolean; up: boolean }) {
  const rows = [
    ...(title ? ['title'] : []),
    ...(header ? ['header'] : []),
    'data',
    'data',
    'data',
    'data',
  ];
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
              {r === 'title' ? 'Title' : r === 'header' ? 'Header' : 'Data'}
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
  const styleId = useId();
  const chosen =
    request.styles.find((x) => x.name.toUpperCase() === style.toUpperCase()) ?? request.styles[0];
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
  const ok = () => {
    if (!valid) return;
    const table: InsertTableSettings = {
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
  const firstRows = [
    ...(chosen && !chosen.suppressTitle ? ['Title'] : []),
    ...(chosen && !chosen.suppressHeader ? ['Header'] : []),
  ];
  const cellStyles: [string, string][] = [
    ['First row cell style:', firstRows[0] ?? 'Data'],
    ['Second row cell style:', firstRows[1] ?? 'Data'],
    ['All other row cell styles:', 'Data'],
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
              title={!chosen?.suppressTitle}
              header={!chosen?.suppressHeader}
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
            {cellStyles.map(([label, value]) => (
              <label key={label} className="cad-dialog-field insert-table-field">
                <span>{label}</span>
                <select value={value} disabled>
                  <option value={value}>{value}</option>
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
