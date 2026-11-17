// The Table Cell menu's Data Format... (M4-16 part 2): AutoCAD 2024's Table Cell Format dialog
// (AutoCAD Help, "Table Cell Format Dialog Box"; UI_SPEC.md §7). Data type on the left; Preview,
// then what the type offers: Format (Angle, Decimal Number, Point, Text), Precision (Angle,
// Currency, Decimal Number, Percentage, Point), Symbol and Append symbol (Currency), the date
// format with its Examples (Date), the X, Y and Z boxes (Point) and Additional Format... (Angle,
// Currency, Decimal Number, Percentage, Point; part 3), which opens AutoCAD's Additional Format
// dialog over it: Current value, Conversion factor, Additional text, Number separators and Zero
// suppression. OK sends the data format; the engine gives it to the cells. Left out: Negative
// numbers, List separator and the 0 feet and 0 inches boxes (shown greyed), whose format codes
// nothing published gives (`table-data.ts`), and Help, as Triya's other dialogs leave it.
import {
  DATE_EXAMPLES,
  NUMBER_FORMATS,
  TABLE_ADDITIONAL_TYPES,
  TABLE_DECIMAL_SEPARATORS,
  TABLE_THOUSANDS_SEPARATORS,
  TABLE_ANGLE_FORMATS,
  TABLE_CURRENCY_SYMBOLS,
  TABLE_DATA_TYPES,
  TABLE_DATA_TYPE_NAMES,
  TEXT_CASES,
  tableDataPreview,
  type DialogRequest,
  type PromptAnswer,
  type TableAdditionalFormat,
  type TableDataFormat,
  type TableDataType,
} from '@triya/engine';
import { useId, useMemo, useState, type ReactNode } from 'react';
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

/** A separator as the Additional Format dialog lists it. */
const SEPARATOR_NAMES: Readonly<Record<string, string>> = {
  '': 'None',
  '.': '. (period)',
  ',': ', (comma)',
  ' ': '  (space)',
};

/** The Additional Format dialog's fields as it edits them, a cleared one undefined. */
type Draft = { [K in keyof TableAdditionalFormat]?: TableAdditionalFormat[K] | undefined };

/** `a` without its empty fields; undefined when nothing is left. */
function tidy(a: Draft): TableAdditionalFormat | undefined {
  const out = Object.fromEntries(
    Object.entries(a).filter(([, v]) => v !== undefined && v !== ''),
  ) as TableAdditionalFormat;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `f` with Additional Format `a` (none when `a` states nothing). */
function withAdditional(f: TableDataFormat, a: Draft): TableDataFormat {
  const { additional: _was, ...rest } = f;
  const t = tidy(a);
  return t ? { ...rest, additional: t } : rest;
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="matchprop-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="additional-format-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

/**
 * AutoCAD's Additional Format dialog over the Table Cell Format dialog: what `f`'s Additional
 * Format is, the Current value showing the first cell (or a sample) as OK would leave it.
 */
function AdditionalFormatDialog({
  f,
  request,
  now,
  onOk,
  onCancel,
}: {
  f: TableDataFormat;
  request: Request;
  now: number;
  onOk: (a: Draft) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState<Draft>(f.additional ?? {});
  const [factor, setFactor] = useState(String(f.additional?.factor ?? 1));
  const ids = { factor: useId(), prefix: useId(), suffix: useId(), dec: useId(), th: useId() };
  const n = Number(factor);
  const factorValid = factor.trim() !== '' && Number.isFinite(n) && n !== 0;
  const next: Draft = { ...a, ...(factorValid && { factor: n }) };
  const current = tableDataPreview(request.cell, withAdditional(f, next), request.units, now);
  const symbol = f.type === 'currency' || f.type === 'percentage';
  const set = (patch: Draft) => setA((was) => ({ ...was, ...patch }));
  const ok = () => {
    if (factorValid) onOk(next);
  };
  return (
    <Modal
      label="Additional Format"
      className="field-dialog additional-format-dialog"
      onOk={ok}
      onCancel={onCancel}
    >
      <div className="cad-dialog-field">
        <span>Current value:</span>
        <output className="table-cell-format-preview" aria-label="Current value">
          {current}
        </output>
      </div>
      <label className="cad-dialog-field" htmlFor={ids.factor}>
        <span>Conversion factor:</span>
        <input
          id={ids.factor}
          type="text"
          inputMode="decimal"
          value={factor}
          aria-invalid={!factorValid}
          onChange={(e) => setFactor(e.currentTarget.value)}
        />
      </label>
      <Group legend="Additional text">
        <label className="cad-dialog-field" htmlFor={ids.prefix}>
          <span>Prefix:</span>
          <input
            id={ids.prefix}
            type="text"
            disabled={symbol}
            value={a.prefix ?? ''}
            onChange={(e) => set({ prefix: e.currentTarget.value })}
          />
        </label>
        <label className="cad-dialog-field" htmlFor={ids.suffix}>
          <span>Suffix:</span>
          <input
            id={ids.suffix}
            type="text"
            disabled={symbol}
            value={a.suffix ?? ''}
            onChange={(e) => set({ suffix: e.currentTarget.value })}
          />
        </label>
      </Group>
      <Group legend="Number separators">
        <label className="cad-dialog-field" htmlFor={ids.dec}>
          <span>Decimal:</span>
          <select
            id={ids.dec}
            value={a.decimal ?? '.'}
            onChange={(e) => set({ decimal: e.currentTarget.value })}
          >
            {TABLE_DECIMAL_SEPARATORS.map((s) => (
              <option key={s} value={s}>
                {SEPARATOR_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="cad-dialog-field" htmlFor={ids.th}>
          <span>Thousands:</span>
          <select
            id={ids.th}
            value={a.thousands ?? ''}
            onChange={(e) => set({ thousands: e.currentTarget.value })}
          >
            {TABLE_THOUSANDS_SEPARATORS.map((s) => (
              <option key={s} value={s}>
                {SEPARATOR_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
      </Group>
      <Group legend="Zero suppression">
        <Check
          label="Leading"
          checked={a.leading === true}
          onChange={(c) => set({ leading: c ? true : undefined })}
        />
        <Check
          label="Trailing"
          checked={a.trailing === true}
          onChange={(c) => set({ trailing: c ? true : undefined })}
        />
        <Check label="0 Feet" checked={false} disabled />
        <Check label="0 Inches" checked={false} disabled />
      </Group>
      {!factorValid && (
        <p role="alert" className="cell-block-error">
          Enter a conversion factor other than 0.
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!factorValid}>
          OK
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

export function TableCellFormatDialog({ doc, request }: { doc: number; request: Request }) {
  const [f, setF] = useState<TableDataFormat>(request.settings);
  const [additional, setAdditional] = useState(false);
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
          {f.type === 'point' && (
            <div className="table-cell-format-axes" role="group" aria-label="Coordinates">
              {AXES.map((axis, k) => {
                const shown = f.coordinates ?? 7;
                const on = (shown & (1 << k)) !== 0;
                return (
                  <Check
                    key={axis}
                    label={axis}
                    checked={on}
                    // One coordinate at least stays shown.
                    disabled={on && (shown & ~(1 << k)) === 0}
                    onChange={(c) => {
                      const bits = c ? shown | (1 << k) : shown & ~(1 << k);
                      const { coordinates: _was, ...rest } = f;
                      setF(bits === 7 ? rest : { ...rest, coordinates: bits });
                    }}
                  />
                );
              })}
            </div>
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
      {TABLE_ADDITIONAL_TYPES.has(f.type) && (
        <button
          type="button"
          className="additional-format-open"
          onClick={() => setAdditional(true)}
        >
          Additional Format...
        </button>
      )}
      {additional && (
        <AdditionalFormatDialog
          f={f}
          request={request}
          now={now}
          onOk={(a) => {
            setF((was) => withAdditional(was, a));
            setAdditional(false);
          }}
          onCancel={() => setAdditional(false)}
        />
      )}
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
