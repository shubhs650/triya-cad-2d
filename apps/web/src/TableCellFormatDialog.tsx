// The Table Cell menu's Data Format... (M4-16 part 2): AutoCAD 2024's Table Cell Format dialog
// (AutoCAD Help, "Table Cell Format Dialog Box"; UI_SPEC.md §7). Data type on the left; Preview,
// then what the type offers: Format (Angle, Decimal Number, Point, Text), Precision (Angle,
// Currency, Decimal Number, Percentage, Point), Symbol and Append symbol (Currency), the date
// format with its Examples (Date). OK sends the data format; the engine gives it to the cells.
// Left out: Additional Format..., Negative numbers, List separator and the X/Y/Z filters, which
// need format codes no corpus table holds (M4-16's roadmap line), and Help, as Triya's other
// dialogs leave it.
import {
  DATE_EXAMPLES,
  NUMBER_FORMATS,
  TABLE_ANGLE_FORMATS,
  TABLE_CURRENCY_SYMBOLS,
  TABLE_DATA_TYPES,
  TABLE_DATA_TYPE_NAMES,
  TEXT_CASES,
  tableDataPreview,
  type DialogRequest,
  type PromptAnswer,
  type TableDataFormat,
  type TableDataType,
} from '@triya/engine';
import { useId, useMemo, useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'tablecellformat' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** The Precision list: 0, 0.0 … 0.00000000. */
const PLACES = Array.from({ length: 9 }, (_, n) => (n === 0 ? '0' : `0.${'0'.repeat(n)}`));

/** Which fields a data type shows. */
const FORMATS: Partial<Record<TableDataType, readonly string[]>> = {
  angle: TABLE_ANGLE_FORMATS,
  decimal: NUMBER_FORMATS,
  point: NUMBER_FORMATS,
  text: TEXT_CASES,
};
const PRECISION = new Set<TableDataType>(['angle', 'currency', 'decimal', 'percentage', 'point']);
/** Types whose Precision may be the drawing's (Current precision); the others state one. */
const CURRENT = new Set<TableDataType>(['angle', 'decimal', 'point']);

/** What a data type opens on when chosen in the list. */
function fresh(type: TableDataType): TableDataFormat {
  if (type === 'currency') return { type, symbol: '$', precision: 2 };
  if (type === 'percentage') return { type, precision: 2 };
  if (type === 'date') return { type, date: DATE_EXAMPLES[0]! };
  if (FORMATS[type]) return { type, format: 0 };
  return { type };
}

function List({
  label,
  items,
  value,
  onChange,
  size = 6,
}: {
  label: string;
  items: readonly string[];
  value: number;
  onChange: (index: number) => void;
  size?: number;
}) {
  return (
    <label className="field-dialog-list">
      {label}
      <select
        size={size}
        value={value < 0 ? '' : String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {items.map((item, n) => (
          <option key={n} value={n}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TableCellFormatDialog({ doc, request }: { doc: number; request: Request }) {
  const [f, setF] = useState<TableDataFormat>(request.settings);
  const now = useMemo(() => Date.now(), []);
  const ids = { precision: useId(), symbol: useId(), date: useId() };
  const set = (patch: Partial<TableDataFormat>) => setF((was) => ({ ...was, ...patch }));
  const preview = tableDataPreview(request.cell, f, request.units, now);
  const formats = FORMATS[f.type];
  const dateValid = f.type !== 'date' || (f.date ?? '').trim() !== '';

  const ok = () => {
    if (!dateValid) return;
    answer(doc, { kind: 'dialog', action: 'ok', tableDataFormat: f });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });

  return (
    <Modal
      label="Table Cell Format"
      className="field-dialog table-cell-format-dialog"
      onOk={ok}
      onCancel={cancel}
    >
      <div className="field-dialog-layout">
        <div className="field-dialog-names">
          <List
            label="Data type:"
            items={TABLE_DATA_TYPES.map((t) => TABLE_DATA_TYPE_NAMES[t])}
            value={TABLE_DATA_TYPES.indexOf(f.type)}
            onChange={(n) => setF(fresh(TABLE_DATA_TYPES[n]!))}
            size={9}
          />
        </div>
        <div className="field-dialog-format">
          <div className="cad-dialog-field">
            <span>Preview:</span>
            <output className="table-cell-format-preview" aria-label="Preview">
              {preview}
            </output>
          </div>
          {formats && (
            <List
              label="Format:"
              items={formats}
              value={f.format ?? 0}
              onChange={(n) => set({ format: n })}
              size={Math.min(formats.length, 6)}
            />
          )}
          {f.type === 'date' && (
            <>
              <label className="cad-dialog-field" htmlFor={ids.date}>
                <span>Date format:</span>
                <input
                  id={ids.date}
                  type="text"
                  value={f.date ?? ''}
                  aria-invalid={!dateValid}
                  onChange={(e) => set({ date: e.currentTarget.value })}
                />
              </label>
              <List
                label="Examples:"
                items={DATE_EXAMPLES}
                value={DATE_EXAMPLES.indexOf(f.date ?? '')}
                onChange={(n) => set({ date: DATE_EXAMPLES[n]! })}
              />
            </>
          )}
          {PRECISION.has(f.type) && (
            <label className="cad-dialog-field" htmlFor={ids.precision}>
              <span>Precision:</span>
              <select
                id={ids.precision}
                value={f.precision === undefined ? '' : String(f.precision)}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  const { precision: _was, ...rest } = f;
                  setF(v === '' ? rest : { ...rest, precision: Number(v) });
                }}
              >
                {CURRENT.has(f.type) && <option value="">Current precision</option>}
                {PLACES.map((p, n) => (
                  <option key={p} value={n}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f.type === 'currency' && (
            <>
              <label className="cad-dialog-field" htmlFor={ids.symbol}>
                <span>Symbol:</span>
                <select
                  id={ids.symbol}
                  value={f.symbol ?? '$'}
                  onChange={(e) => set({ symbol: e.currentTarget.value })}
                >
                  {[...new Set([...TABLE_CURRENCY_SYMBOLS, f.symbol ?? '$'])].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="matchprop-check">
                <input
                  type="checkbox"
                  checked={f.appendSymbol === true}
                  onChange={(e) => {
                    const { appendSymbol: _was, ...rest } = f;
                    setF(e.currentTarget.checked ? { ...rest, appendSymbol: true } : rest);
                  }}
                />
                Append symbol
              </label>
            </>
          )}
        </div>
      </div>
      {!dateValid && (
        <p role="alert" className="cell-block-error">
          Enter a date format, or pick one of the examples.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!dateValid}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
