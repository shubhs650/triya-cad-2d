// QSELECT's Quick Select dialog (M3-04 part 2), with AutoCAD 2024's structure and labels
// (AutoCAD Help, "Quick Select Dialog Box"; UI_SPEC.md §7): Apply to with its Select objects
// button, Object type, the Properties list, Operator, Value, How to apply, and Append to current
// selection set. The engine lists the types and their properties (the Properties palette's);
// a choice's Value is a list of its options, any other a typed value the engine reads in the
// drawing's units. Wildcard Match is offered for editable text only, Greater Than and Less Than
// for numbers; Select All greys the Value. OK selects; Cancel (or Esc) ends QSELECT.
import type {
  DialogRequest,
  PromptAnswer,
  QuickSelectCriteria,
  QuickSelectOperator,
  QuickSelectRow,
} from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'qselect' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const OPERATORS: readonly [QuickSelectOperator, string][] = [
  ['=', '= Equals'],
  ['<>', '<> Not Equal'],
  ['>', '> Greater than'],
  ['<', '< Less than'],
  ['*', '* Wildcard Match'],
  ['all', 'Select All'],
];

/** The operators a property offers. */
export function operatorsFor(row: QuickSelectRow | undefined): QuickSelectOperator[] {
  if (!row) return ['all'];
  const numeric = ['distance', 'angle', 'area', 'number'].includes(row.kind);
  const text = row.kind === 'text' && !row.readOnly;
  return OPERATORS.map(([op]) => op).filter((op) => {
    if (op === '>' || op === '<') return numeric;
    return op !== '*' || text;
  });
}

export function QSelectDialog({ doc, request }: { doc: number; request: Request }) {
  const [c, setC] = useState<QuickSelectCriteria>(request.criteria);
  const selection = c.applyTo === 'selection' && !c.append && request.selected > 0;
  const types = selection ? request.selection : request.drawing;
  const type = types.find((t) => t.type === c.type) ?? types[0];
  const rows = type?.rows ?? [];
  const row = rows.find((r) => r.key === c.key) ?? rows[0];
  const operators = operatorsFor(row);
  const operator = operators.includes(c.operator) ? c.operator : operators[0]!;
  const options = row?.options;
  const value =
    options && !options.some((o) => o.value === c.value) ? (options[0]?.value ?? '') : c.value;
  const criteria: QuickSelectCriteria = {
    ...c,
    applyTo: selection ? 'selection' : 'drawing',
    type: type?.type ?? 'MULTIPLE',
    key: row?.key ?? '',
    operator,
    value,
  };
  const ok = () => answer(doc, { kind: 'dialog', action: 'ok', qselect: criteria });
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const select = () => answer(doc, { kind: 'dialog', action: 'select', qselect: criteria });
  return (
    <Modal label="Quick Select" className="qselect-dialog" onOk={ok} onCancel={cancel}>
      <div className="qselect-grid">
        <label htmlFor="qselect-apply">Apply to:</label>
        <div className="qselect-apply">
          <select
            id="qselect-apply"
            value={criteria.applyTo}
            disabled={c.append}
            onChange={(e) => setC({ ...c, applyTo: e.target.value as 'drawing' | 'selection' })}
          >
            <option value="drawing">Entire drawing</option>
            {request.selected > 0 && <option value="selection">Current selection</option>}
          </select>
          <button type="button" onClick={select} disabled={c.append}>
            Select objects
          </button>
        </div>
        <label htmlFor="qselect-type">Object type:</label>
        <select
          id="qselect-type"
          value={criteria.type}
          onChange={(e) =>
            setC({ ...c, type: e.target.value as QuickSelectCriteria['type'], value: '' })
          }
        >
          {types.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <label htmlFor="qselect-properties">Properties:</label>
        <select
          id="qselect-properties"
          size={8}
          value={criteria.key}
          onChange={(e) => setC({ ...c, key: e.target.value, value: '' })}
        >
          {rows.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <label htmlFor="qselect-operator">Operator:</label>
        <select
          id="qselect-operator"
          value={operator}
          onChange={(e) => setC({ ...c, operator: e.target.value as QuickSelectOperator })}
        >
          {OPERATORS.filter(([op]) => operators.includes(op)).map(([op, label]) => (
            <option key={op} value={op}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="qselect-value">Value:</label>
        {options ? (
          <select
            id="qselect-value"
            value={value}
            disabled={operator === 'all'}
            onChange={(e) => setC({ ...c, value: e.target.value })}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="qselect-value"
            type="text"
            value={value}
            disabled={operator === 'all'}
            onChange={(e) => setC({ ...c, value: e.target.value })}
          />
        )}
      </div>
      <fieldset className="qselect-apply-how">
        <legend>How to apply:</legend>
        <label>
          <input
            type="radio"
            name="qselect-how"
            checked={c.include}
            onChange={() => setC({ ...c, include: true })}
          />
          Include in new selection set
        </label>
        <label>
          <input
            type="radio"
            name="qselect-how"
            checked={!c.include}
            onChange={() => setC({ ...c, include: false })}
          />
          Exclude from new selection set
        </label>
      </fieldset>
      <label className="qselect-append">
        <input
          type="checkbox"
          checked={c.append}
          onChange={(e) => setC({ ...c, append: e.target.checked })}
        />
        Append to current selection set
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={ok} disabled={!row && operator !== 'all'}>
          OK
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
