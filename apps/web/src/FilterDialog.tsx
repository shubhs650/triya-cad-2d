// FILTER's Object Selection Filters dialog (M3-04 part 4), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Object Selection Filters Dialog Box"; UI_SPEC.md §7): the filter's
// lines on top; Select Filter (an object type, a property or a logical operator, with its X, Y
// and Z operators and values), Add to List, Substitute, Add Selected Object, Edit Item, Delete,
// Clear List; Named Filters (Current, Save As, Delete Current Filter List); Apply and Cancel.
// A name property's value offers the drawing's names (AutoCAD's Select… list) to type or pick.
import {
  NAME_KEYS,
  NUMBER_KEYS,
  POINT_KEYS,
  filterLine,
  filterProblem,
  type DialogRequest,
  type EntityType,
  type FilterItem,
  type FilterLogic,
  type FilterNameKey,
  type FilterOperator,
  type FilterTest,
} from '@triya/engine';
import { useState } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';
import { UNNAMED, selectionFilters, validName } from './selection-filters';

type Request = Extract<DialogRequest, { type: 'filter' }>;

const OPERATORS: readonly FilterOperator[] = ['=', '!=', '<', '<=', '>', '>=', '*'];
const LOGIC: readonly FilterLogic[] = ['AND', 'OR', 'XOR', 'NOT'];
const has = (keys: readonly string[], k: string) => keys.includes(k);

/** Select Filter's entry: `type:LINE`, a property key, or `Begin AND` / `End NOT`. */
interface Entry {
  readonly entry: string;
  readonly op: FilterOperator;
  readonly value: string;
  readonly xyz: readonly (readonly [FilterOperator, string])[];
}

const FRESH_XYZ: Entry['xyz'] = [
  ['=', '0'],
  ['=', '0'],
  ['=', '0'],
];

/** The list line Select Filter makes, or undefined while a number does not read. */
export function itemOf(e: Entry): FilterItem | undefined {
  const [head, ...rest] = e.entry.split(':');
  const tail = rest.join(':');
  const eqOp = e.op === '!=' ? '!=' : '=';
  if (head === 'type') return { key: 'Object', op: eqOp, value: tail as EntityType };
  const logic = /^(Begin|End) (AND|OR|XOR|NOT)$/.exec(e.entry);
  if (logic) return { key: logic[1] as 'Begin' | 'End', logic: logic[2] as FilterLogic };
  if (has(NAME_KEYS, e.entry)) {
    return { key: e.entry as FilterNameKey, op: eqOp, value: e.value.trim() || '*' };
  }
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  if (has(NUMBER_KEYS, e.entry)) {
    const value = e.op === '*' ? 0 : num(e.value);
    if (!Number.isFinite(value)) return undefined;
    return { key: e.entry as (typeof NUMBER_KEYS)[number], op: e.op, value };
  }
  const tests: FilterTest[] = [];
  for (const [op, v] of e.xyz) {
    const value = op === '*' ? 0 : num(v);
    if (!Number.isFinite(value)) return undefined;
    tests.push({ op, value });
  }
  return { key: e.entry as (typeof POINT_KEYS)[number], x: tests[0]!, y: tests[1]!, z: tests[2]! };
}

/** Edit Item: a list line back in Select Filter. */
export function entryOf(item: FilterItem): Entry {
  if (item.key === 'Begin' || item.key === 'End') {
    return { entry: `${item.key} ${item.logic}`, op: '=', value: '', xyz: FRESH_XYZ };
  }
  if (item.key === 'Object')
    return { entry: `type:${item.value}`, op: item.op, value: '', xyz: FRESH_XYZ };
  if ('op' in item)
    return { entry: item.key, op: item.op, value: String(item.value), xyz: FRESH_XYZ };
  const p = item as { x?: FilterTest; y?: FilterTest; z?: FilterTest };
  const t = (c?: FilterTest) => [c?.op ?? '*', String(c?.value ?? 0)] as const;
  return { entry: item.key, op: '=', value: '', xyz: [t(p.x), t(p.y), t(p.z)] };
}

export function FilterDialog({ doc, request }: { doc: number; request: Request }) {
  const [name, setName] = useState(request.name ?? selectionFilters.current);
  const [list, setList] = useState<readonly FilterItem[]>(
    request.list ?? selectionFilters.list(name),
  );
  const [selected, setSelected] = useState<number | undefined>();
  const [entry, setEntry] = useState<Entry>({
    entry: `type:${request.types[0]?.type ?? 'LINE'}`,
    op: '=',
    value: '',
    xyz: FRESH_XYZ,
  });
  const [saveAs, setSaveAs] = useState('');
  const [named, setNamed] = useState(selectionFilters.named);
  const item = itemOf(entry);
  const problem = filterProblem(list);
  const close = (action: 'apply' | 'select') => {
    if (name === UNNAMED) selectionFilters.unnamed = list;
    selectionFilters.current = name;
    void engines.command(doc, {
      kind: 'answer',
      answer: { kind: 'dialog', action, filter: { list, name } },
    });
  };
  const cancel = () => engines.command(doc, { kind: 'cancel' });
  const point = has(POINT_KEYS, entry.entry);
  const isName = has(NAME_KEYS, entry.entry);
  const isNumber = has(NUMBER_KEYS, entry.entry);
  const isType = entry.entry.startsWith('type:');
  const ops = isName || isType ? OPERATORS.slice(0, 2) : OPERATORS;
  const names = isName ? request.names[entry.entry as FilterNameKey] : [];
  return (
    <Modal
      label="Object Selection Filters"
      className="filter-dialog"
      onOk={() => !problem && close('apply')}
      onCancel={cancel}
    >
      <select
        className="filter-list"
        aria-label="Filter property list"
        size={8}
        value={selected === undefined ? '' : String(selected)}
        onChange={(e) => setSelected(Number(e.target.value))}
      >
        {list.map((i, n) => (
          <option key={n} value={n}>
            {filterLine(i)}
          </option>
        ))}
      </select>
      <div className="filter-panes">
        <fieldset>
          <legend>Select Filter</legend>
          <select
            aria-label="Select Filter"
            value={entry.entry}
            onChange={(e) => setEntry({ ...entry, entry: e.target.value, value: '' })}
          >
            <optgroup label="Object types">
              {request.types.map((t) => (
                <option key={t.type} value={`type:${t.type}`}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Properties">
              {[...NAME_KEYS, ...NUMBER_KEYS, ...POINT_KEYS].sort().map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
            <optgroup label="Logical operators">
              {LOGIC.flatMap((l) => [`Begin ${l}`, `End ${l}`]).map((l) => (
                <option key={l} value={l}>
                  **{l}
                </option>
              ))}
            </optgroup>
          </select>
          {(['X', 'Y', 'Z'] as const).map((c, n) => {
            const shown = point || n === 0;
            const [op, value] = point ? entry.xyz[n]! : [entry.op, entry.value];
            const enabled = point || isName || isNumber || (isType && n === 0);
            const set = (o: FilterOperator, v: string) =>
              point
                ? setEntry({ ...entry, xyz: entry.xyz.map((t, i) => (i === n ? [o, v] : t)) })
                : setEntry({ ...entry, op: o, value: v });
            return (
              <div key={c} className="filter-xyz">
                <span>{c}:</span>
                <select
                  aria-label={`${c} operator`}
                  value={shown ? op : '='}
                  disabled={!enabled || !shown}
                  onChange={(e) => set(e.target.value as FilterOperator, value)}
                >
                  {(point ? OPERATORS : ops).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`${c} value`}
                  list={isName && n === 0 ? 'filter-names' : undefined}
                  value={shown && !isType ? value : ''}
                  disabled={!(point || ((isName || isNumber) && n === 0)) || op === '*'}
                  onChange={(e) => set(op, e.target.value)}
                />
              </div>
            );
          })}
          <datalist id="filter-names">
            {names.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <div className="filter-buttons">
            <button
              type="button"
              disabled={!item}
              onClick={() => {
                // Below the line selected, else at the end.
                const i = selected === undefined ? list.length : selected + 1;
                setList([...list.slice(0, i), item!, ...list.slice(i)]);
                setSelected(i);
              }}
            >
              Add to List
            </button>
            <button
              type="button"
              disabled={!item || selected === undefined}
              onClick={() => setList(list.map((x, i) => (i === selected ? item! : x)))}
            >
              Substitute
            </button>
          </div>
          <button type="button" onClick={() => close('select')}>
            Add Selected Object &lt;
          </button>
        </fieldset>
        <fieldset>
          <legend>Named Filters</legend>
          <label>
            Current:
            <select
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setList(selectionFilters.list(e.target.value));
                setSelected(undefined);
              }}
            >
              <option value={UNNAMED}>{UNNAMED}</option>
              {Object.keys(named).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-save">
            <button
              type="button"
              disabled={!validName(saveAs)}
              onClick={() => {
                selectionFilters.save(saveAs.trim(), list);
                setNamed(selectionFilters.named);
                setName(saveAs.trim());
              }}
            >
              Save As:
            </button>
            <input
              aria-label="Filter name"
              maxLength={18}
              value={saveAs}
              onChange={(e) => setSaveAs(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={name === UNNAMED}
            onClick={() => {
              selectionFilters.remove(name);
              setNamed(selectionFilters.named);
              setName(UNNAMED);
              setList(selectionFilters.unnamed);
            }}
          >
            Delete Current Filter List
          </button>
        </fieldset>
      </div>
      <div className="filter-buttons">
        <button
          type="button"
          disabled={selected === undefined}
          onClick={() => setEntry(entryOf(list[selected!]!))}
        >
          Edit Item
        </button>
        <button
          type="button"
          disabled={selected === undefined}
          onClick={() => {
            setList(list.filter((_, i) => i !== selected));
            setSelected(undefined);
          }}
        >
          Delete
        </button>
        <button type="button" onClick={() => (setList([]), setSelected(undefined))}>
          Clear List
        </button>
      </div>
      {problem && <p className="dsettings-error">{problem}</p>}
      <div className="cad-dialog-buttons">
        <button type="button" disabled={problem !== undefined} onClick={() => close('apply')}>
          Apply
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
