// MLEADERSTYLE's Multileader Style Manager (M4-04 part 2), with AutoCAD 2024's structure and
// labels (AutoCAD Help, "Multileader Style Manager", "Create New Multileader Style Dialog Box",
// "Modify Multileader Style Dialog Box"; UI_SPEC.md §7):
//
//   Current multileader style: <name>
//   Styles | List: All styles / Styles in use
//   Set Current, New..., Modify..., Delete, Close
//
// The list's shortcut menu (right-click, Shift+F10 or the menu key) has Set current, Rename and
// Delete; F2 renames and Delete deletes, as in a Windows list. Each action is made at once and
// the engine opens the manager again; Close (and Esc) only closes it, everything done being one
// undo step.
//
// New... asks Create New Multileader Style (New style name, Start with; Annotative shown and
// never set, DEC-013) and Continue opens the tabs on the Start with style's settings; Modify...
// opens them on the selected style. Leader Format, Leader Structure and Content hold the engine's
// fields (`MLEADERSTYLE_FIELDS`): a check box and the value it turns on share a line (Maximum
// leader points, First and Second segment angle), the Content tab shows the Text options and
// Leader connection groups for Mtext and Block options for Block, and a colour list ends with
// Select Color..., which opens AutoCAD's Select Color. OK sends the settings; the engine writes
// what changed. The preview image waits for a later part.
import {
  MLEADERSTYLE_FIELDS,
  MLEADERSTYLE_TABS,
  mleaderStyleFieldOptions,
  parseColorValue,
  setMLeaderStyleField,
  colorValue,
  type DialogRequest,
  type MLeaderStyleAction,
  type MLeaderStyleField,
  type MLeaderStyleLists,
  type MLeaderStyleSettings,
  type MLeaderStyleTab,
  type MLeaderStyleValue,
  type PromptAnswer,
} from '@triya/engine';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Modal } from './AttributeDialogs';
import { StylePreview } from './StylePreview';
import { SelectColorDialog } from './SelectColorDialog';
import { engines } from './engine/registry';
import { useLineweightUnits } from './lineweight-units';

type Request = Extract<DialogRequest, { type: 'mleaderstyle' }>;

const answer = (doc: number, a: PromptAnswer) =>
  engines.command(doc, { kind: 'answer', answer: a });

/** The Select Color... entry of a colour list. */
const SELECT_COLOR = '\u0000select';

type Editing =
  | { readonly mode: 'create' }
  | {
      readonly mode: 'new' | 'modify';
      readonly name: string;
      readonly from?: string;
      readonly settings: MLeaderStyleSettings;
    };

export function MLeaderStyleDialog({ doc, request }: { doc: number; request: Request }) {
  const [selected, setSelected] = useState(request.selected);
  const [list, setList] = useState<'all' | 'used'>('all');
  const [editing, setEditing] = useState<Editing>();
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  // The leader's Lineweight list in LWUNITS' units (M5-12).
  const lwUnits = useLineweightUnits();
  const send = (mleaderstyle: MLeaderStyleAction) =>
    answer(doc, { kind: 'dialog', action: 'apply', mleaderstyle });
  const close = () => answer(doc, { kind: 'dialog', action: 'ok' });
  const rows = request.styles
    .filter((s) => list === 'all' || s.used || s.name === request.current)
    .map((s) => s.name);
  const style = request.styles.find((s) => s.name === selected);
  const standard = (name: string) => name.toUpperCase() === 'STANDARD';

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = rows.indexOf(selected);
      const next =
        rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setSelected(next);
    } else if (e.key === 'F2' && style) {
      e.preventDefault();
      setRenaming(style.name);
    } else if (e.key === 'Delete' && style) {
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

  return (
    <Modal
      label="Multileader Style Manager"
      className="dimstyle-manager mleaderstyle-manager"
      onOk={close}
      onCancel={close}
    >
      <p className="dimstyle-current">
        Current multileader style:{' '}
        <strong data-testid="mleaderstyle-current">{request.current}</strong>
      </p>
      <div className="dimstyle-body">
        <div className="dimstyle-left">
          <span id={`${doc}-mleaderstyle-styles`}>Styles:</span>
          <ul
            role="listbox"
            aria-labelledby={`${doc}-mleaderstyle-styles`}
            className="dimstyle-list"
            tabIndex={0}
            onKeyDown={keys}
          >
            {rows.map((r) => (
              <li
                key={r}
                role="option"
                aria-selected={r === selected}
                onClick={() => setSelected(r)}
                onDoubleClick={() => setRenaming(r)}
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
          <span>Preview of: {style?.name ?? ''}</span>
          <StylePreview
            doc={doc}
            preview={style && { kind: 'mleaderstyle', settings: style.settings, from: style.name }}
            size={MANAGER_PREVIEW}
            testId="mleaderstyle-preview"
          />
          <div className="dimstyle-buttons">
            <button
              type="button"
              disabled={!style || style.name === request.current}
              onClick={() => style && void send({ op: 'current', name: style.name })}
            >
              Set Current
            </button>
            <button type="button" disabled={!style} onClick={() => setEditing({ mode: 'create' })}>
              New...
            </button>
            <button
              type="button"
              disabled={!style}
              onClick={() =>
                style && setEditing({ mode: 'modify', name: style.name, settings: style.settings })
              }
            >
              Modify...
            </button>
            <button
              type="button"
              disabled={!style || standard(style.name) || style.name === request.current}
              onClick={() => style && void send({ op: 'delete', name: style.name })}
            >
              Delete
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
      {menu && style && (
        <StyleMenu
          at={menu}
          onClose={() => setMenu(undefined)}
          onCurrent={() => void send({ op: 'current', name: style.name })}
          onRename={() => setRenaming(style.name)}
          onDelete={() => void send({ op: 'delete', name: style.name })}
        />
      )}
      {editing?.mode === 'create' && style && (
        <CreateNewStyle
          styles={request.styles.map((s) => s.name)}
          from={style.name}
          onCancel={() => setEditing(undefined)}
          onContinue={(name, from) => {
            const base = request.styles.find((s) => s.name === from)!;
            setEditing({ mode: 'new', name, from, settings: base.settings });
          }}
        />
      )}
      {editing && editing.mode !== 'create' && (
        <StyleEditor
          // AutoCAD titles New's tabs as Modify's, with the new style's name.
          title={`Modify Multileader Style: ${editing.name}`}
          doc={doc}
          from={editing.mode === 'new' ? editing.from! : editing.name}
          settings={editing.settings}
          lists={{ ...request.lists, lineweightUnits: lwUnits }}
          onCancel={() => setEditing(undefined)}
          onOk={(settings) => {
            if (editing.mode === 'new')
              void send({ op: 'new', name: editing.name, from: editing.from!, settings });
            else void send({ op: 'modify', name: editing.name, settings });
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
  onClose: () => void;
  onCurrent: () => void;
  onRename: () => void;
  onDelete: () => void;
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
      {item('Set current', props.onCurrent)}
      {item('Rename', props.onRename)}
      {item('Delete', props.onDelete)}
    </div>
  );
}

function CreateNewStyle(props: {
  styles: readonly string[];
  from: string;
  onCancel: () => void;
  onContinue: (name: string, from: string) => void;
}) {
  const [name, setName] = useState(`Copy of ${props.from}`);
  const [from, setFrom] = useState(props.from);
  const go = () => {
    if (name.trim() !== '') props.onContinue(name.trim(), from);
  };
  return (
    <Modal
      label="Create New Multileader Style"
      className="dimstyle-create"
      onOk={go}
      onCancel={props.onCancel}
    >
      <label className="cad-dialog-field">
        <span>New style name:</span>
        <input type="text" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="cad-dialog-field">
        <span>Start with:</span>
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

let lastTab: MLeaderStyleTab = 'format';

/** Modify Multileader Style: AutoCAD's three tabs over the style's settings. */
/** The preview pictures' sizes in CSS pixels, as the Dimension Style Manager's. */
const MANAGER_PREVIEW = { width: 240, height: 170 };
const EDITOR_PREVIEW = { width: 300, height: 190 };

function StyleEditor(props: {
  title: string;
  doc: number;
  /** The style the settings come from (Modify's own, New's Start with). */
  from: string;
  settings: MLeaderStyleSettings;
  lists: MLeaderStyleLists;
  onCancel: () => void;
  onOk: (settings: MLeaderStyleSettings) => void;
}) {
  const [tab, setTabState] = useState<MLeaderStyleTab>(lastTab);
  const [settings, setSettings] = useState(props.settings);
  const [picking, setPicking] = useState<MLeaderStyleField>();
  const setTab = (t: MLeaderStyleTab) => {
    lastTab = t;
    setTabState(t);
  };
  const set = (f: MLeaderStyleField, value: MLeaderStyleValue) =>
    setSettings((s) => setMLeaderStyleField(s, f.key, value));
  const fields = MLEADERSTYLE_FIELDS.filter((f) => f.tab === tab && (f.shown?.(settings) ?? true));
  const groups = [...new Set(fields.map((f) => f.group))];
  const label = MLEADERSTYLE_TABS.find((t) => t.id === tab)!.label;
  // AutoCAD's sample image, beside every tab, following each change (M4-14).
  const preview = (
    <div key="preview" className="dimstyle-editor-preview">
      <StylePreview
        doc={props.doc}
        preview={{ kind: 'mleaderstyle', settings, from: props.from }}
        size={EDITOR_PREVIEW}
        testId="mleaderstyle-editor-preview"
      />
    </div>
  );
  return (
    <Modal
      label={props.title}
      className="dimstyle-editor mleaderstyle-editor"
      onOk={() => props.onOk(settings)}
      onCancel={props.onCancel}
    >
      <div role="tablist" className="cad-dialog-tabs">
        {MLEADERSTYLE_TABS.map((t) => (
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
        {groups.map((g, i) => [
          i === 1 && preview,
          <fieldset key={g}>
            <legend>{g}</legend>
            {fields
              .filter((f) => f.group === g && f.checkedBy === undefined)
              .map((f) => {
                const paired = fields.find((x) => x.checkedBy === f.key);
                return (
                  <Field
                    key={f.key}
                    field={f}
                    paired={paired}
                    settings={settings}
                    lists={props.lists}
                    onChange={set}
                    onPickColor={setPicking}
                  />
                );
              })}
            {g === 'Scale' && (
              <label
                className="cad-dialog-check"
                title="Making a style annotative is not supported (DEC-013)"
              >
                <input type="checkbox" checked={false} disabled readOnly /> Annotative
              </label>
            )}
          </fieldset>,
        ])}
        {groups.length < 2 && preview}
      </div>
      {picking && (
        <SelectColorDialog
          initial={parseColorValue(String(settings[picking.key]))}
          books={[]}
          trueColors
          onOk={(c) => {
            set(picking, colorValue(c));
            setPicking(undefined);
          }}
          onCancel={() => setPicking(undefined)}
        />
      )}
      <div className="cad-dialog-buttons">
        <button type="button" onClick={() => props.onOk(settings)}>
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
  paired,
  settings,
  lists,
  onChange,
  onPickColor,
}: {
  field: MLeaderStyleField;
  /** The value a check box turns on, on the same line. */
  paired: MLeaderStyleField | undefined;
  settings: MLeaderStyleSettings;
  lists: MLeaderStyleLists;
  onChange: (f: MLeaderStyleField, value: MLeaderStyleValue) => void;
  onPickColor: (f: MLeaderStyleField) => void;
}) {
  const disabled = f.enabled ? !f.enabled(settings) : false;
  const value = settings[f.key];
  if (f.kind === 'check') {
    const check = (
      <label className="cad-dialog-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(f, e.target.checked)}
        />
        {f.label}
      </label>
    );
    if (!paired) return check;
    return (
      <div className="mleaderstyle-checked">
        {check}
        <Control
          field={paired}
          settings={settings}
          lists={lists}
          onChange={onChange}
          onPickColor={onPickColor}
        />
      </div>
    );
  }
  if (f.kind === 'radio') {
    return (
      <div role="radiogroup" aria-label={f.label} className="dimstyle-radios">
        {mleaderStyleFieldOptions(f, lists, settings).map((o) => (
          <label key={o.value} className="cad-dialog-check">
            <input
              type="radio"
              name={f.key}
              checked={String(value) === o.value}
              disabled={disabled}
              onChange={() => onChange(f, o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <label className="cad-dialog-field">
      <span>{f.label}:</span>
      <Control
        field={f}
        settings={settings}
        lists={lists}
        onChange={onChange}
        onPickColor={onPickColor}
        labelled
      />
    </label>
  );
}

/** A field's list or typed value, without its label. */
function Control({
  field: f,
  settings,
  lists,
  onChange,
  onPickColor,
  labelled = false,
}: {
  field: MLeaderStyleField;
  settings: MLeaderStyleSettings;
  lists: MLeaderStyleLists;
  onChange: (f: MLeaderStyleField, value: MLeaderStyleValue) => void;
  onPickColor: (f: MLeaderStyleField) => void;
  /** Inside the field's own label; otherwise it names itself. */
  labelled?: boolean;
}) {
  const disabled = f.enabled ? !f.enabled(settings) : false;
  const value = settings[f.key];
  const aria = labelled ? undefined : f.label;
  if (f.kind === 'choice') {
    const options = mleaderStyleFieldOptions(f, lists, settings);
    return (
      <select
        aria-label={aria}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === SELECT_COLOR) onPickColor(f);
          else onChange(f, e.target.value);
        }}
      >
        {!options.some((o) => o.value === String(value)) && (
          <option value={String(value)}>{String(value)}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {f.color && <option value={SELECT_COLOR}>Select Color...</option>}
      </select>
    );
  }
  return (
    <TextField
      label={aria}
      value={value}
      disabled={disabled}
      numeric={f.kind === 'number'}
      onChange={(v) => onChange(f, v)}
    />
  );
}

/**
 * A typed number or text: each keystroke the field takes is set at once, and a value it refuses
 * shows until the field loses focus, when it goes back to the style's.
 */
function TextField(props: {
  label: string | undefined;
  value: MLeaderStyleValue;
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
    <input
      type="text"
      aria-label={props.label}
      inputMode={props.numeric ? 'decimal' : undefined}
      value={text ?? shown}
      disabled={props.disabled}
      onChange={(e) => {
        setText(e.target.value);
        props.onChange(e.target.value);
      }}
      onBlur={() => setText(undefined)}
    />
  );
}
