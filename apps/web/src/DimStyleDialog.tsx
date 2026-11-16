// DIMSTYLE's Dimension Style Manager (M4-03), with AutoCAD 2024's structure and labels (AutoCAD
// Help, "Dimension Style Manager", "Create New Dimension Style Dialog Box", "New, Modify, and
// Override Dimension Style Dialog Boxes"; UI_SPEC.md §7):
//
//   Current dimstyle: <name>
//   Styles (the current one's "<style overrides>" under it) | Description
//   List: All styles / Styles in use
//   Set Current, New..., Modify..., Override..., Close
//
// The list's shortcut menu (right-click, Shift+F10 or the menu key) has Set current, Rename and
// Delete, and Save to current style on the overrides; F2 renames and Delete deletes, as in a
// Windows list. Each action is made at once and the engine opens the manager again; Close (and
// Esc) only closes it, everything done being one undo step.
//
// New... asks Create New Dimension Style (New Style Name, Start With, Use for) and Continue opens
// New Dimension Style; Modify... and Override... open the same seven tabs on the selected style
// (Override on the current one, with its overrides). Their fields are the engine's
// (`DIMSTYLE_FIELDS`); OK sends the style's DIMVARs and the engine writes what changed. The
// preview image, Compare... and Use for a single dimension type (child styles) come with part 2.
import {
  DIMSTYLE_FIELDS,
  DIMSTYLE_TABS,
  dialogVars,
  fieldOptions,
  setField,
  type DialogRequest,
  type DimStyleAction,
  type DimStyleField,
  type DimStyleLists,
  type DimStyleTab,
  type DimStyleVars,
  type PromptAnswer,
} from '@triya/engine';
import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { engines } from './engine/registry';

type Request = Extract<DialogRequest, { type: 'dimstyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

const OVERRIDES = '<style overrides>';

type Editing =
  | { readonly mode: 'create' }
  | {
      readonly mode: 'new' | 'modify' | 'override';
      readonly name: string;
      readonly from?: string;
      readonly vars: DimStyleVars;
    };

/** A DIMVAR's label in the dialog, for the overrides' description. */
function varLabel(name: string): string {
  const f = DIMSTYLE_FIELDS.find((x) => x.vars[0] === name && !x.key.includes('.'));
  return f ? f.label : name;
}

function shownValue(v: unknown): string {
  if (typeof v === 'number') return String(Number(v.toPrecision(8)));
  return String(v);
}

export function DimStyleDialog({ doc, request }: { doc: number; request: Request }) {
  const [selected, setSelected] = useState(request.selected);
  const [list, setList] = useState<'all' | 'used'>('all');
  const [editing, setEditing] = useState<Editing>();
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const [confirm, setConfirm] = useState<string>();
  const send = (dimstyle: DimStyleAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', dimstyle });
  const close = () => answer(doc, { kind: 'dialog', action: 'ok' });
  const hasOverrides = Object.keys(request.overrides).length > 0;
  const styles = request.styles.filter(
    (s) => list === 'all' || s.used || s.name === request.current,
  );
  const rows: string[] = styles.flatMap((s) =>
    s.name === request.current && hasOverrides ? [s.name, OVERRIDES] : [s.name],
  );
  const onOverrides = selected === OVERRIDES;
  const style = request.styles.find((s) => s.name === (onOverrides ? request.current : selected));
  const currentStyle = request.styles.find((s) => s.name === request.current);

  const setCurrent = (name: string) => {
    // AutoCAD asks before another style's Set Current discards the overrides.
    if (hasOverrides && name !== request.current) setConfirm(name);
    else void send({ op: 'current', name });
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = rows.indexOf(selected);
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setSelected(next);
    } else if (e.key === 'F2' && style && !onOverrides) {
      e.preventDefault();
      setRenaming(style.name);
    } else if (e.key === 'Delete' && style && !onOverrides) {
      e.preventDefault();
      void send({ op: 'delete', name: style.name });
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setMenu({ x: r.left + 16, y: r.top + 16 });
    }
  };
  const contextMenu = (e: MouseEvent, row: string) => {
    e.preventDefault();
    setSelected(row);
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const description = onOverrides
    ? `${request.current} + ${Object.entries(request.overrides)
        .map(([n, v]) => `${varLabel(n)} = ${shownValue(v)}`)
        .join(', ')}`
    : (style?.name ?? '');

  return (
    <Modal
      label="Dimension Style Manager"
      className="dimstyle-manager"
      onOk={close}
      onCancel={close}
    >
      <p className="dimstyle-current">
        Current dimstyle: <strong data-testid="dimstyle-current">{request.current}</strong>
      </p>
      <div className="dimstyle-body">
        <div className="dimstyle-left">
          <span id={`${doc}-dimstyle-styles`}>Styles:</span>
          <ul
            role="listbox"
            aria-labelledby={`${doc}-dimstyle-styles`}
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={keys}
          >
            {rows.map((r) => (
              <li
                key={r}
                role="option"
                aria-selected={r === selected}
                className={r === OVERRIDES ? 'dimstyle-overrides' : undefined}
                onClick={() => setSelected(r)}
                onDoubleClick={() => r !== OVERRIDES && setRenaming(r)}
                onContextMenu={(e) => contextMenu(e, r)}
              >
                {renaming === r ? (
                  <RenameInput
                    name={r}
                    onDone={(to) => {
                      setRenaming(undefined);
                      if (to !== undefined && to !== r) void send({ op: 'rename', name: r, to });
                    }}
                  />
                ) : (
                  <>
                    {r === request.current && <span aria-label="current">▸ </span>}
                    {r}
                  </>
                )}
              </li>
            ))}
          </ul>
          <label className="cad-dialog-field">
            <span>List:</span>
            <select value={list} onChange={(e) => setList(e.target.value as 'all' | 'used')}>
              <option value="all">All styles</option>
              <option value="used">Styles in use</option>
            </select>
          </label>
        </div>
        <div className="dimstyle-right">
          <span>Description</span>
          <p className="dimstyle-description" data-testid="dimstyle-description">
            {description}
          </p>
          <div className="dimstyle-buttons">
            <button
              type="button"
              disabled={!style || onOverrides || style.name === request.current}
              onClick={() => style && setCurrent(style.name)}
            >
              Set Current
            </button>
            <button type="button" disabled={!style} onClick={() => setEditing({ mode: 'create' })}>
              New...
            </button>
            <button
              type="button"
              disabled={!style || onOverrides}
              onClick={() =>
                style &&
                setEditing({ mode: 'modify', name: style.name, vars: dialogVars(style.vars) })
              }
            >
              Modify...
            </button>
            <button
              type="button"
              disabled={!currentStyle || (style !== undefined && style.name !== request.current)}
              onClick={() =>
                currentStyle &&
                setEditing({
                  mode: 'override',
                  name: currentStyle.name,
                  vars: dialogVars({ ...currentStyle.vars, ...request.overrides }),
                })
              }
            >
              Override...
            </button>
          </div>
        </div>
      </div>
      {request.note !== undefined && (
        <p className="dimstyle-note" role="status">
          {request.note}
        </p>
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={close}>
          Close
        </button>
      </div>
      {menu && (
        <StyleMenu
          at={menu}
          overrides={onOverrides}
          onClose={() => setMenu(undefined)}
          onCurrent={() => style && setCurrent(style.name)}
          onRename={() => style && setRenaming(style.name)}
          onDelete={() => style && void send({ op: 'delete', name: style.name })}
          onSave={() => void send({ op: 'save-overrides' })}
        />
      )}
      {confirm !== undefined && (
        <Modal
          label="Dimension Style - Set Current"
          onOk={() => void send({ op: 'current', name: confirm })}
          onCancel={() => setConfirm(undefined)}
        >
          <p>Making another style current will discard the style overrides. Continue?</p>
          <div className="cad-dialog-buttons">
            <button type="button" onClick={() => void send({ op: 'current', name: confirm })}>
              OK
            </button>
            <button type="button" onClick={() => setConfirm(undefined)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {editing?.mode === 'create' && style && (
        <CreateNewStyle
          styles={request.styles.map((s) => s.name)}
          from={style.name}
          onCancel={() => setEditing(undefined)}
          onContinue={(name, from) => {
            const base = request.styles.find((s) => s.name === from)!;
            setEditing({ mode: 'new', name, from, vars: dialogVars(base.vars) });
          }}
        />
      )}
      {editing && editing.mode !== 'create' && (
        <StyleEditor
          title={
            editing.mode === 'new'
              ? `New Dimension Style: ${editing.name}`
              : editing.mode === 'modify'
                ? `Modify Dimension Style: ${editing.name}`
                : `Override Current Style: ${editing.name}`
          }
          vars={editing.vars}
          lists={request.lists}
          onCancel={() => setEditing(undefined)}
          onOk={(vars) => {
            if (editing.mode === 'new') {
              void send({ op: 'new', name: editing.name, from: editing.from!, vars });
            } else if (editing.mode === 'modify') {
              void send({ op: 'modify', name: editing.name, vars });
            } else {
              void send({ op: 'override', vars });
            }
          }}
        />
      )}
    </Modal>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (to?: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <input
      type="text"
      aria-label="New name"
      autoFocus
      value={text}
      maxLength={255}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text.trim())}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onDone(text.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(undefined);
        }
      }}
    />
  );
}

function StyleMenu(props: {
  at: { x: number; y: number };
  overrides: boolean;
  onClose: () => void;
  onCurrent: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const item = (label: string, act: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        props.onClose();
        act();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      role="menu"
      aria-label="Style"
      className="dimstyle-menu"
      style={{ left: props.at.x, top: props.at.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onClose();
        }
      }}
      onMouseLeave={props.onClose}
    >
      {props.overrides ? (
        item('Save to current style', props.onSave)
      ) : (
        <>
          {item('Set current', props.onCurrent)}
          {item('Rename', props.onRename)}
          {item('Delete', props.onDelete)}
        </>
      )}
    </div>
  );
}

function CreateNewStyle(props: {
  styles: readonly string[];
  from: string;
  onCancel: () => void;
  onContinue: (name: string, from: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState(`Copy of ${props.from}`);
  const [from, setFrom] = useState(props.from);
  const go = () => {
    if (name.trim() !== '') props.onContinue(name.trim(), from);
  };
  return (
    <Modal
      label="Create New Dimension Style"
      className="dimstyle-create"
      onOk={go}
      onCancel={props.onCancel}
    >
      <label className="cad-dialog-field">
        <span>New Style Name:</span>
        <input type="text" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="cad-dialog-field">
        <span>Start With:</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {props.styles.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label
        className="cad-dialog-check"
        title="Making a style annotative is not supported (DEC-013)"
      >
        <input type="checkbox" checked={false} disabled readOnly /> Annotative
      </label>
      <label className="cad-dialog-field" htmlFor={`${id}-use`}>
        <span>Use for:</span>
        <select id={`${id}-use`} value="all" disabled>
          <option value="all">All dimensions</option>
        </select>
      </label>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={go} disabled={name.trim() === ''}>
          Continue
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

let lastTab: DimStyleTab = 'lines';

/** New, Modify or Override Dimension Style: AutoCAD's seven tabs over the style's DIMVARs. */
function StyleEditor(props: {
  title: string;
  vars: DimStyleVars;
  lists: DimStyleLists;
  onCancel: () => void;
  onOk: (vars: DimStyleVars) => void;
}) {
  const [tab, setTabState] = useState<DimStyleTab>(lastTab);
  const [vars, setVars] = useState(props.vars);
  const setTab = (t: DimStyleTab) => {
    lastTab = t;
    setTabState(t);
  };
  const fields = DIMSTYLE_FIELDS.filter((f) => f.tab === tab);
  const groups = [...new Set(fields.map((f) => f.group))];
  const label = DIMSTYLE_TABS.find((t) => t.id === tab)!.label;
  return (
    <Modal
      label={props.title}
      className="dimstyle-editor"
      onOk={() => props.onOk(vars)}
      onCancel={props.onCancel}
    >
      <div role="tablist" className="cad-dialog-tabs">
        {DIMSTYLE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="cad-dialog-panel dimstyle-tab" aria-label={label}>
        {groups.map((g) => (
          <fieldset key={g}>
            <legend>{g}</legend>
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <Field
                  key={f.key}
                  field={f}
                  vars={vars}
                  lists={props.lists}
                  onChange={(value) => setVars((v) => setField(v, f.key, value))}
                />
              ))}
          </fieldset>
        ))}
        {tab === 'fit' && (
          <label
            className="cad-dialog-check"
            title="Making a style annotative is not supported (DEC-013)"
          >
            <input type="checkbox" checked={false} disabled readOnly /> Annotative
          </label>
        )}
      </div>
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => props.onOk(vars)}>
          OK
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function Field({
  field: f,
  vars,
  lists,
  onChange,
}: {
  field: DimStyleField;
  vars: DimStyleVars;
  lists: DimStyleLists;
  onChange: (value: string | number | boolean) => void;
}) {
  const disabled = f.enabled ? !f.enabled(vars) : false;
  const value = f.get(vars);
  if (f.kind === 'check') {
    return (
      <label className="cad-dialog-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {f.label}
      </label>
    );
  }
  if (f.kind === 'radio') {
    return (
      <div role="radiogroup" aria-label={f.label} className="dimstyle-radios">
        {fieldOptions(f, lists, vars).map((o) => (
          <label key={o.value} className="cad-dialog-check">
            <input
              type="radio"
              name={f.key}
              checked={String(value) === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  if (f.kind === 'choice') {
    const options = fieldOptions(f, lists, vars);
    return (
      <label className="cad-dialog-field">
        <span>{f.label}:</span>
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {!options.some((o) => o.value === String(value)) && (
            <option value={String(value)}>{String(value)}</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <TextField
      label={f.label}
      value={value}
      disabled={disabled}
      numeric={f.kind === 'number'}
      onChange={onChange}
    />
  );
}

/**
 * A typed number or text: each keystroke the field takes is set at once, and a value it refuses
 * shows until the field loses focus, when it goes back to the style's.
 */
function TextField(props: {
  label: string;
  value: string | number | boolean;
  disabled: boolean;
  numeric: boolean;
  onChange: (value: string) => void;
}) {
  const shown =
    typeof props.value === 'number'
      ? String(Number(props.value.toPrecision(10)))
      : String(props.value);
  const [text, setText] = useState<string>();
  return (
    <label className="cad-dialog-field">
      <span>{props.label}:</span>
      <input
        type="text"
        inputMode={props.numeric ? 'decimal' : undefined}
        value={text ?? shown}
        disabled={props.disabled}
        onChange={(e) => {
          setText(e.target.value);
          props.onChange(e.target.value);
        }}
        onBlur={() => setText(undefined)}
      />
    </label>
  );
}
